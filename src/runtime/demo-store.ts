import { mkdir, open, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import type { AgentConfig, AgentMessage } from '../services/demo-agent.js';
import { RecruitmentError } from '../shared/errors.js';
import { readJson, withLock, writeJson } from './storage.js';

export const agentConfigSchema = z.object({
  baseUrl: z.url().refine((value) => {
    const url = new URL(value);
    return (
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      (url.protocol === 'https:' ||
        (url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname)))
    );
  }, '远程模型使用 HTTPS，本机模型可使用 HTTP'),
  model: z.string().trim().min(1),
  apiKey: z.string().default(''),
});
const settingsSchema = agentConfigSchema.omit({ apiKey: true }).extend({ v: z.literal(1) });
const secretsSchema = z.object({ v: z.literal(1), keys: z.record(z.string(), z.string()) });
export const demoUiSchema = z.object({
  conversationId: z.uuid().nullable().default(null),
  role: z.enum(['seeker', 'recruiter']).default('seeker'),
  platform: z.string().min(1).default('boss'),
});
const messageSchema = z.object({
  role: z.enum(['assistant', 'tool']),
  content: z.string().nullable(),
  tool_call_id: z.string().optional(),
  tool_calls: z
    .array(
      z.object({
        id: z.string(),
        type: z.literal('function'),
        function: z.object({ name: z.string(), arguments: z.string() }),
      }),
    )
    .optional(),
});
const toolEventSchema = z.object({
  type: z.enum(['tool.start', 'tool.result', 'tool.error']),
  id: z.string(),
  name: z.string(),
  command: z.string(),
  input: z.unknown().optional(),
  result: z.unknown().optional(),
  error: z.string().optional(),
  errorCode: z.string().optional(),
  errorDetails: z.record(z.string(), z.unknown()).optional(),
  durationMs: z.number().optional(),
});
const payloadSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('turn.started'),
    message: z.string(),
    platform: z.string(),
    allowContact: z.boolean(),
  }),
  z.object({ type: z.literal('message'), message: messageSchema }),
  z.object({ type: z.literal('tool'), event: toolEventSchema }),
  z.object({ type: z.literal('turn.completed') }),
  z.object({ type: z.literal('turn.interrupted'), reason: z.string() }),
]);
const recordSchema = z.object({
  v: z.literal(1),
  seq: z.number().int().positive(),
  at: z.iso.datetime(),
  turnId: z.uuid(),
  payload: payloadSchema,
});
export type ConversationEvent = z.infer<typeof recordSchema>;
export type ConversationPayload = z.infer<typeof payloadSchema>;

export class DemoStore {
  constructor(readonly home: string) {}
  private directory(id: string) {
    return join(this.home, 'conversations', z.uuid().parse(id));
  }
  async loadConfig(): Promise<AgentConfig | undefined> {
    await mkdir(this.home, { recursive: true, mode: 0o700 });
    const saved = await readJson(join(this.home, 'config.json'));
    if (!saved) return undefined;
    const config = settingsSchema.parse(saved);
    const secrets = secretsSchema.parse(
      (await readJson(join(this.home, 'secrets.json'))) ?? { v: 1, keys: {} },
    );
    return {
      baseUrl: config.baseUrl,
      model: config.model,
      apiKey: secrets.keys[config.baseUrl] ?? '',
    };
  }
  async saveConfig(config: AgentConfig): Promise<void> {
    await withLock(join(this.home, 'config-write'), async () => {
      const secrets = secretsSchema.parse(
        (await readJson(join(this.home, 'secrets.json'))) ?? { v: 1, keys: {} },
      );
      secrets.keys[config.baseUrl] = config.apiKey;
      await writeJson(join(this.home, 'secrets.json'), secrets);
      await writeJson(join(this.home, 'config.json'), {
        v: 1,
        baseUrl: config.baseUrl,
        model: config.model,
      });
    });
  }
  async loadUi() {
    return demoUiSchema.parse((await readJson(join(this.home, 'ui.json'))) ?? {});
  }
  async saveUi(value: z.infer<typeof demoUiSchema>) {
    await writeJson(join(this.home, 'ui.json'), value);
  }
  async read(id: string): Promise<{ events: ConversationEvent[]; bytes: number }> {
    let data: Buffer;
    try {
      data = await readFile(join(this.directory(id), 'events.jsonl'));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT')
        throw new RecruitmentError('NOT_FOUND', '对话不存在。');
      throw error;
    }
    // Only newline-terminated records are committed. An interrupted final write is ignored.
    const bytes = data.lastIndexOf(10) + 1;
    const lines = data.subarray(0, bytes).toString('utf8').split('\n').slice(0, -1);
    const events = lines.map((line, index) => {
      const event = recordSchema.parse(JSON.parse(line));
      if (event.seq !== index + 1) throw new RecruitmentError('INPUT', '对话日志序号损坏。');
      return event;
    });
    return { events, bytes };
  }
  async list() {
    const root = join(this.home, 'conversations');
    await mkdir(root, { recursive: true, mode: 0o700 });
    const entries = await readdir(root, { withFileTypes: true });
    const conversations = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || !z.uuid().safeParse(entry.name).success) continue;
      try {
        const { events } = await this.read(entry.name);
        const first = events.find((event) => event.payload.type === 'turn.started');
        if (!first || first.payload.type !== 'turn.started') continue;
        conversations.push({
          id: entry.name,
          title: first.payload.message.slice(0, 60),
          updatedAt: events.at(-1)!.at,
          interrupted: events.at(-1)!.payload.type !== 'turn.completed',
        });
      } catch (error) {
        if (error instanceof RecruitmentError && error.code === 'NOT_FOUND') continue;
        throw error;
      }
    }
    return conversations.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  async use<T>(
    id: string,
    existing: boolean,
    action: (
      events: ConversationEvent[],
      append: (turnId: string, payload: ConversationPayload) => Promise<void>,
    ) => Promise<T>,
  ): Promise<T> {
    return withLock(this.directory(id), async () => {
      const saved = existing ? await this.read(id) : { events: [], bytes: 0 };
      const file = await open(
        join(this.directory(id), 'events.jsonl'),
        existing ? 'r+' : 'wx',
        0o600,
      );
      try {
        await file.truncate(saved.bytes);
        let position = saved.bytes;
        const append = async (turnId: string, payload: ConversationPayload) => {
          const event: ConversationEvent = {
            v: 1,
            seq: saved.events.length + 1,
            at: new Date().toISOString(),
            turnId,
            payload,
          };
          const data = Buffer.from(JSON.stringify(event) + '\n');
          let written = 0;
          while (written < data.length) {
            const result = await file.write(
              data,
              written,
              data.length - written,
              position + written,
            );
            written += result.bytesWritten;
          }
          await file.sync();
          position += data.length;
          saved.events.push(event);
        };
        return await action(saved.events, append);
      } finally {
        await file.close();
      }
    });
  }
}

export function conversationMessages(events: ConversationEvent[]): AgentMessage[] {
  const messages: AgentMessage[] = [];
  const pending = new Set<string>();
  const closePending = () => {
    for (const id of pending)
      messages.push({
        role: 'tool',
        tool_call_id: id,
        content: JSON.stringify({
          ok: false,
          interrupted: true,
          error: '上次执行中断，结果未知。不得自动重跑；请先核对已有计划和操作回执。',
        }),
      });
    pending.clear();
  };
  for (const { payload } of events) {
    if (payload.type === 'turn.started') {
      closePending();
      messages.push({
        role: 'user',
        content: `当前平台：${payload.platform}。本轮发起沟通权限：${payload.allowContact}。\n${payload.message}`,
      });
    }
    if (payload.type === 'message') {
      messages.push(payload.message);
      for (const call of payload.message.tool_calls ?? []) pending.add(call.id);
      if (payload.message.tool_call_id) pending.delete(payload.message.tool_call_id);
    }
    if (payload.type === 'turn.interrupted') {
      closePending();
      messages.push({
        role: 'system',
        content:
          '上一轮已中断。已有记录仅供参考，不要自动继续或重跑上次操作。只有用户的新请求可以开始新一轮；发送结果以操作回执为准。',
      });
    }
  }
  closePending();
  return messages;
}

export function savedAgentMessage(message: AgentMessage): z.infer<typeof messageSchema> {
  // Explicit allowlist: provider reasoning stays in memory and never reaches disk or history APIs.
  return {
    role: message.role as 'assistant' | 'tool',
    content: message.content,
    ...(message.tool_calls ? { tool_calls: message.tool_calls } : {}),
    ...(message.tool_call_id ? { tool_call_id: message.tool_call_id } : {}),
  };
}
