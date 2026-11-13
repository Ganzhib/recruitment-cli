import type { RecruitmentTools, ToolPolicy } from '../src/services/agent-tools.js';
import { RecruitmentError } from '../src/shared/errors.js';

export interface AgentConfig {
  baseUrl: string;
  model: string;
  apiKey: string;
}
export interface AgentMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
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
}): Promise<void> {
  const { config, messages, tools, signal } = options;
  const endpoint = new URL(config.baseUrl.replace(/\/$/, '') + '/chat/completions');
  for (let step = 0; step < 8; step++) {
    signal.throwIfAborted();
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
        stream: false,
      }),
    });
    if (!response.ok)
      throw new RecruitmentError(
        'NETWORK',
        `模型服务返回 HTTP ${response.status}，请检查模型名称与连接设置。`,
      );
    const completion = (await response.json()) as { choices: { message: AgentMessage }[] };
    if (!completion.choices.length)
      throw new RecruitmentError('PLATFORM', '模型服务没有返回可用回复。');
    const reply = completion.choices[0].message;
    messages.push(reply);
    if (reply.content) options.onMessage(reply.content);
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
        result = { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
      messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result) });
    }
  }
  throw new RecruitmentError('PLATFORM', '本轮已达到 8 次模型调用，请继续对话来完成下一步。');
}
