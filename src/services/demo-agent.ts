import { randomUUID } from 'node:crypto';
import type { RecruitmentTools, ToolPolicy } from './agent-tools.js';
import { RecruitmentError } from '../shared/errors.js';

export interface AgentConfig {
  baseUrl: string;
  model: string;
  apiKey: string;
}
export interface AgentMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  reasoning_content?: string;
  tool_call_id?: string;
  tool_calls?: { id: string; type: 'function'; function: { name: string; arguments: string } }[];
}
export async function runDemoAgent(options: {
  config: AgentConfig;
  messages: AgentMessage[];
  tools: RecruitmentTools;
  policy: ToolPolicy;
  signal: AbortSignal;
  onMessage(content: string): void;
  onDelta?(id: string, delta: string): void;
  onStatus?(phase: 'thinking' | 'composing'): void;
}): Promise<void> {
  const { config, messages, tools, signal } = options;
  const endpoint = new URL(config.baseUrl.replace(/\/$/, '') + '/chat/completions');
  for (let step = 0; step < 8; step++) {
    signal.throwIfAborted();
    options.onStatus?.('thinking');
    const response = await fetch(endpoint, {
      method: 'POST',
      signal: AbortSignal.any([signal, AbortSignal.timeout(60_000)]),
      headers: {
        'Content-Type': 'application/json',
        ...(config.apiKey ? { Authorization: 'Bearer ' + config.apiKey } : {}),
      },
      body: JSON.stringify({
        model: config.model,
        messages,
        tools: tools.functions(),
        stream: true,
      }),
    });
    if (!response.ok)
      throw new RecruitmentError(
        'NETWORK',
        `模型服务返回 HTTP ${response.status}，请检查模型名称与连接设置。`,
      );
    let reply: AgentMessage;
    if (response.headers.get('content-type')?.includes('text/event-stream')) {
      const id = randomUUID();
      reply = await readCompletionStream(response, (delta) => {
        options.onStatus?.('composing');
        options.onDelta?.(id, delta);
      });
      if (reply.content && !options.onDelta) options.onMessage(reply.content);
    } else {
      const completion = (await response.json()) as { choices: { message: AgentMessage }[] };
      if (!completion.choices.length)
        throw new RecruitmentError('PLATFORM', '模型服务没有返回可用回复。');
      reply = completion.choices[0].message;
      if (reply.content) {
        options.onStatus?.('composing');
        options.onMessage(reply.content);
      }
    }
    messages.push(reply);
    if (!reply.tool_calls?.length) return;
    for (const call of reply.tool_calls) {
      signal.throwIfAborted();
      let result: unknown;
      try {
        result = await tools.execute(
          call.function.name,
          JSON.parse(call.function.arguments),
          options.policy,
        );
      } catch (error) {
        result = {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
          ...(error instanceof RecruitmentError
            ? { code: error.code, details: error.details }
            : {}),
        };
      }
      messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result) });
    }
  }
  throw new RecruitmentError('PLATFORM', '本轮已达到 8 次模型调用，请继续对话来完成下一步。');
}

interface StreamDelta {
  content?: string | null;
  reasoning_content?: string;
  tool_calls?: { index: number; id?: string; function?: { name?: string; arguments?: string } }[];
}
async function readCompletionStream(
  response: Response,
  onDelta: (delta: string) => void,
): Promise<AgentMessage> {
  if (!response.body) throw new RecruitmentError('NETWORK', '模型没有返回响应流。');
  const reply: AgentMessage = { role: 'assistant', content: null };
  const calls: NonNullable<AgentMessage['tool_calls']> = [];
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let finished = false;
  const line = (value: string) => {
    if (!value.startsWith('data:')) return;
    const data = value.slice(5).trim();
    if (!data) return;
    if (data === '[DONE]') {
      finished = true;
      return;
    }
    const event = JSON.parse(data) as {
      choices?: { delta?: StreamDelta; finish_reason?: string | null }[];
      error?: unknown;
    };
    if (event.error) throw new RecruitmentError('NETWORK', '模型输出中断，请检查服务状态。');
    const choice = event.choices?.[0];
    if (!choice) return;
    if (choice.finish_reason === 'length' || choice.finish_reason === 'content_filter')
      throw new RecruitmentError('PLATFORM', '模型输出未完整结束，本轮不执行未完成的工具调用。');
    const delta = choice.delta;
    if (delta?.content) {
      reply.content = (reply.content ?? '') + delta.content;
      onDelta(delta.content);
    }
    // Some providers require this field for subsequent tool rounds; it is never displayed or logged.
    if (delta?.reasoning_content)
      reply.reasoning_content = (reply.reasoning_content ?? '') + delta.reasoning_content;
    for (const part of delta?.tool_calls ?? []) {
      const call = (calls[part.index] ??= {
        id: '',
        type: 'function',
        function: { name: '', arguments: '' },
      });
      if (part.id) call.id += part.id;
      if (part.function?.name) call.function.name += part.function.name;
      if (part.function?.arguments) call.function.arguments += part.function.arguments;
    }
  };
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let end;
      while ((end = buffer.indexOf('\n')) !== -1) {
        line(buffer.slice(0, end).trimEnd());
        buffer = buffer.slice(end + 1);
      }
    }
    buffer += decoder.decode();
    if (buffer.trim()) line(buffer.trimEnd());
  } finally {
    reader.releaseLock();
  }
  if (!finished)
    throw new RecruitmentError('NETWORK', '模型连接中断，未执行未完整接收的工具调用。');
  if (calls.length) reply.tool_calls = calls;
  return reply;
}
