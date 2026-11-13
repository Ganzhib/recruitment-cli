import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { resolve, extname, sep } from 'node:path';
import { z } from 'zod';
import { createRecruitmentTools } from '../services/agent-tools.js';
import { RecruitmentError } from '../shared/errors.js';
import type { RecruitmentClient } from '../services/client.js';
import { runDemoAgent, type AgentConfig } from '../services/demo-agent.js';
import {
  agentConfigSchema,
  conversationMessages,
  DemoStore,
  demoUiSchema,
  savedAgentMessage,
} from './demo-store.js';

const contentTypes: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};
const chatSchema = z.object({
  conversationId: z.uuid().optional(),
  message: z.string().trim().min(1).max(12000),
  allowContact: z.boolean().default(false),
  platform: z.string().default('boss'),
});
const executeSchema = z.object({
  name: z.string(),
  input: z.unknown(),
  allowContact: z.boolean().default(false),
});
async function body(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 128 * 1024) throw new RecruitmentError('INPUT', '请求内容过大。');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
function json(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  response.end(JSON.stringify(value));
}
export function createDemoServer(options: {
  client: RecruitmentClient;
  config?: AgentConfig;
  root?: string;
}) {
  const client = options.client;
  const root = resolve(options.root ?? fileURLToPath(new URL('../site/', import.meta.url)));
  const store = new DemoStore(client.home);
  let config = options.config && agentConfigSchema.parse(options.config);
  if (!config && process.env.RECRUIT_AGENT_BASE_URL && process.env.RECRUIT_AGENT_MODEL) {
    config = agentConfigSchema.parse({
      baseUrl: process.env.RECRUIT_AGENT_BASE_URL,
      model: process.env.RECRUIT_AGENT_MODEL,
      apiKey: process.env.RECRUIT_AGENT_API_KEY,
    });
  }
  let initialized: Promise<void> | undefined;
  const running = new Set<string>();
  return createServer(async (request, response) => {
    const expectedOrigin = `http://127.0.0.1:${request.socket.localPort}`;
    const origin = request.headers.origin;
    if (
      request.headers.host !== new URL(expectedOrigin).host ||
      (origin && origin !== expectedOrigin)
    ) {
      json(response, 403, { error: '此 Demo 仅允许本机同源访问。' });
      return;
    }
    const path = new URL(request.url!, expectedOrigin).pathname;
    try {
      await (initialized ??= (async () => {
        config ??= await store.loadConfig();
      })());
      if (request.method === 'GET' && path === '/api/config') {
        json(response, 200, {
          configured: Boolean(config),
          model: config?.model ?? '',
          baseUrl: config?.baseUrl ?? '',
          hasApiKey: Boolean(config?.apiKey),
          toolsEndpoint: expectedOrigin + '/api/tools',
        });
        return;
      }
      if (request.method === 'POST' && path === '/api/config') {
        const input = agentConfigSchema
          .extend({ clearApiKey: z.boolean().default(false) })
          .parse(await body(request));
        const next = {
          baseUrl: input.baseUrl,
          model: input.model,
          apiKey: input.clearApiKey
            ? ''
            : input.apiKey || (input.baseUrl === config?.baseUrl ? config.apiKey : ''),
        };
        await store.saveConfig(next);
        config = next;
        json(response, 200, { configured: true, model: config.model });
        return;
      }
      if (request.method === 'GET' && path === '/api/conversations') {
        json(response, 200, {
          conversations: (await store.list()).map((item) => ({
            ...item,
            running: running.has(item.id),
          })),
        });
        return;
      }
      if (request.method === 'GET' && path.startsWith('/api/conversations/')) {
        const id = z.uuid().parse(path.slice('/api/conversations/'.length));
        const { events } = await store.read(id);
        json(response, 200, { id, events, running: running.has(id) });
        return;
      }
      if (path === '/api/ui' && request.method === 'GET') {
        json(response, 200, await store.loadUi());
        return;
      }
      if (path === '/api/ui' && request.method === 'POST') {
        const input = demoUiSchema.parse(await body(request));
        if (input.conversationId) await store.read(input.conversationId);
        await store.saveUi(input);
        json(response, 200, { ok: true });
        return;
      }
      if (request.method === 'GET' && path === '/api/tools') {
        json(response, 200, { tools: createRecruitmentTools(client).describe() });
        return;
      }
      if (request.method === 'POST' && path === '/api/tools/execute') {
        const input = executeSchema.parse(await body(request));
        json(response, 200, {
          result: await createRecruitmentTools(client).execute(input.name, input.input, {
            allowContact: input.allowContact,
          }),
        });
        return;
      }
      if (request.method === 'POST' && path === '/api/chat') {
        if (!config) throw new RecruitmentError('INPUT', '请先连接模型服务。');
        const turnConfig = config;
        const input = chatSchema.parse(await body(request));
        const id = input.conversationId ?? randomUUID();
        if (running.has(id)) throw new RecruitmentError('BUSY', '本轮对话仍在执行。');
        running.add(id);
        try {
          await store.use(id, Boolean(input.conversationId), async (events, append) => {
            const previous = events.at(-1);
            if (previous && !['turn.completed', 'turn.interrupted'].includes(previous.payload.type))
              await append(previous.turnId, {
                type: 'turn.interrupted',
                reason: '上次执行中断，未自动重跑。',
              });
            const turnId = randomUUID();
            await append(turnId, {
              type: 'turn.started',
              message: input.message,
              platform: input.platform,
              allowContact: input.allowContact,
            });
            const messages = [
              {
                role: 'system' as const,
                content:
                  '你是 recruitment-cli 的招聘工作助手。回答使用简短中文和 Markdown，先给结论，再给关键结果或下一步；避免重复免责声明、权限说明、工具名和冗长的操作复述，技术参数在执行过程面板里查看。使用提供的工具发现能力、确认账号、搜索与准备联系计划。平台由当前用户指定。筛选只依据岗位相关要求，不依据年龄、性别等个人特征。先搜索并生成计划；用户已明确要求自动打招呼且本轮 allowContact 为 true 时，展示计划后在同一轮执行并核对回执，不必再次询问；否则只准备计划。未开启 allowContact 时不能发起沟通。工具失败或结果不明时如实说明，不声称已完成未执行的动作。招聘端先列出岗位再选择 options.job。示例说明与真实操作结果必须区分。不要让用户提供 Cookie。',
              },
              ...conversationMessages(events),
            ];
            response.writeHead(200, {
              'Content-Type': 'text/event-stream; charset=utf-8',
              'Cache-Control': 'no-cache',
              Connection: 'keep-alive',
              'X-Accel-Buffering': 'no',
            });
            const emit = (event: unknown) => {
              if (!response.destroyed) response.write('data: ' + JSON.stringify(event) + '\n\n');
            };
            emit({ type: 'session', conversationId: id });
            const abort = new AbortController();
            response.on('close', () => abort.abort());
            try {
              await runDemoAgent({
                config: turnConfig,
                messages,
                tools: createRecruitmentTools(client, async (event) => {
                  try {
                    await append(turnId, { type: 'tool', event });
                  } catch (error) {
                    abort.abort(error);
                    throw error;
                  }
                  emit(event);
                }),
                policy: { allowContact: input.allowContact },
                signal: abort.signal,
                onRecord: (message) =>
                  append(turnId, { type: 'message', message: savedAgentMessage(message) }),
                onMessage: (content) => emit({ type: 'message', content }),
                onDelta: (id, delta) => emit({ type: 'message.delta', id, delta }),
                onStatus: (phase) => emit({ type: 'status', phase }),
              });
              abort.signal.throwIfAborted();
              await append(turnId, { type: 'turn.completed' });
              emit({ type: 'done' });
            } catch (error) {
              const reason = error instanceof Error ? error.message : String(error);
              await append(turnId, { type: 'turn.interrupted', reason });
              emit({ type: 'error', message: reason });
            }
          });
        } finally {
          running.delete(id);
          if (response.headersSent) response.end();
        }
        return;
      }
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        json(response, 404, { error: '接口不存在。' });
        return;
      }
      const filename = decodeURIComponent(path).replace(/^\//, '');
      if (path === '/') {
        response.writeHead(302, { Location: '/demo/' });
        response.end();
        return;
      }
      const file = resolve(root, filename.endsWith('/') ? filename + 'index.html' : filename);
      if (!file.startsWith(root + sep)) {
        json(response, 403, { error: '路径不可访问。' });
        return;
      }
      const contentType = contentTypes[extname(file)];
      if (!contentType) {
        json(response, 404, { error: '此文件不是可公开访问的网页资源。' });
        return;
      }
      const content = await readFile(file);
      response.writeHead(200, {
        'Content-Type': contentType,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      });
      response.end(content);
    } catch (error) {
      if (response.headersSent) {
        if (!response.writableEnded) response.end();
        return;
      }
      json(response, 400, {
        error:
          error instanceof z.ZodError
            ? z.prettifyError(error)
            : error instanceof Error
              ? error.message
              : String(error),
      });
    }
  });
}
