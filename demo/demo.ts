import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { resolve, extname } from 'node:path';
import { z } from 'zod';
import {
  createRecruitmentClient,
  createRecruitmentTools,
  RecruitmentError,
  type RecruitmentClient,
} from '../src/index.js';
import { runDemoAgent, type AgentConfig, type AgentMessage } from './demo-agent.js';

const root = fileURLToPath(new URL('../site/', import.meta.url));
const configSchema = z.object({
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
export function createDemoServer(
  options: { client?: RecruitmentClient; config?: AgentConfig } = {},
) {
  const client = options.client ?? createRecruitmentClient();
  let config = options.config;
  if (!config && process.env.RECRUIT_AGENT_BASE_URL && process.env.RECRUIT_AGENT_MODEL) {
    config = configSchema.parse({
      baseUrl: process.env.RECRUIT_AGENT_BASE_URL,
      model: process.env.RECRUIT_AGENT_MODEL,
      apiKey: process.env.RECRUIT_AGENT_API_KEY,
    });
  }
  const conversations = new Map<string, AgentMessage[]>();
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
      if (request.method === 'GET' && path === '/api/config') {
        json(response, 200, {
          configured: Boolean(config),
          model: config?.model ?? '',
          baseUrl: config?.baseUrl ?? '',
          toolsEndpoint: expectedOrigin + '/api/tools',
        });
        return;
      }
      if (request.method === 'POST' && path === '/api/config') {
        config = configSchema.parse(await body(request));
        json(response, 200, { configured: true, model: config.model });
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
        const input = chatSchema.parse(await body(request));
        const id = input.conversationId ?? randomUUID();
        if (running.has(id)) throw new RecruitmentError('BUSY', '本轮对话仍在执行。');
        if (input.conversationId && !conversations.has(id))
          throw new RecruitmentError('NOT_FOUND', '对话已失效，请开始新对话。');
        const messages = conversations.get(id) ?? [
          {
            role: 'system' as const,
            content:
              '你是 recruitment-cli 的招聘工作助手。使用提供的工具发现能力、确认账号、搜索与准备联系计划。平台由当前用户指定。筛选只依据岗位相关要求，不依据年龄、性别等个人特征。先搜索和展示计划，再按用户指令执行；未开启 allowContact 时不能发起沟通。工具失败或结果不明时如实说明，不声称已完成未执行的动作。招聘端先列出岗位再选择 options.job。示例说明与真实操作结果必须区分。不要让用户提供 Cookie。',
          },
        ];
        messages.push({
          role: 'user',
          content: `当前平台：${input.platform}。本轮发起沟通权限：${input.allowContact}。\n${input.message}`,
        });
        conversations.set(id, messages);
        running.add(id);
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
            config,
            messages,
            tools: createRecruitmentTools(client, emit),
            policy: { allowContact: input.allowContact },
            signal: abort.signal,
            onMessage: (content) => emit({ type: 'message', content }),
          });
          emit({ type: 'done' });
        } catch (error) {
          emit({ type: 'error', message: error instanceof Error ? error.message : String(error) });
        } finally {
          running.delete(id);
          response.end();
        }
        return;
      }
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        json(response, 404, { error: '接口不存在。' });
        return;
      }
      const filename = path === '/' ? 'demo.html' : decodeURIComponent(path).replace(/^\//, '');
      const file = resolve(root, filename);
      if (!file.startsWith(root)) {
        json(response, 403, { error: '路径不可访问。' });
        return;
      }
      const content = await readFile(file);
      response.writeHead(200, {
        'Content-Type':
          (
            {
              '.html': 'text/html; charset=utf-8',
              '.css': 'text/css; charset=utf-8',
              '.js': 'text/javascript; charset=utf-8',
              '.svg': 'image/svg+xml',
              '.png': 'image/png',
            } as Record<string, string>
          )[extname(file)] ?? 'application/octet-stream',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      });
      response.end(content);
    } catch (error) {
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
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = z.coerce
    .number()
    .int()
    .min(1024)
    .max(65535)
    .parse(process.env.RECRUIT_DEMO_PORT ?? 4318);
  createDemoServer().listen(port, '127.0.0.1', () =>
    console.log(`Recruitment Demo: http://127.0.0.1:${port}`),
  );
}
