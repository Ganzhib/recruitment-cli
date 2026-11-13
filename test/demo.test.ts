import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createDemoServer } from '../demo/demo.js';
import { createRecruitmentClient } from '../src/index.js';
import { fakePlatform, temporaryHome } from './helpers.js';

async function serve(server: Server): Promise<string> {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return 'http://127.0.0.1:' + (server.address() as AddressInfo).port;
}
async function close(server: Server) {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
}

test('demo serves assets, exposes tools, rejects cross-origin access and keeps keys out of config reads', async () =>
  temporaryHome(async (home) => {
    const { platform } = fakePlatform();
    const server = createDemoServer({
      client: createRecruitmentClient({ home, platforms: [platform] }),
    });
    const base = await serve(server);
    try {
      assert.equal((await fetch(base + '/demo.html')).status, 200);
      assert.equal((await fetch(base + '/api/tools')).status, 200);
      assert.equal(
        (await fetch(base + '/api/config', { headers: { Origin: 'https://attacker.example' } }))
          .status,
        403,
      );
      assert.equal(
        (
          await fetch(base + '/api/chat', {
            method: 'POST',
            body: JSON.stringify({ message: 'hello' }),
          })
        ).status,
        400,
      );
      await fetch(base + '/api/config', {
        method: 'POST',
        body: JSON.stringify({
          baseUrl: 'https://model.example/v1',
          model: 'fixture-model',
          apiKey: 'fabricated-test-key',
        }),
      });
      const config = (await (await fetch(base + '/api/config')).json()) as Record<string, unknown>;
      assert.equal(config.configured, true);
      assert.equal('apiKey' in config, false);
      const tools = (await (
        await fetch(base + '/api/tools/execute', {
          method: 'POST',
          body: JSON.stringify({ name: 'recruit_platforms', input: {} }),
        })
      ).json()) as { result: unknown[] };
      assert.equal(tools.result.length, 1);
    } finally {
      await close(server);
    }
  }));

test('real chat completion tool loop emits actual tool events and returns the result to the model', async () =>
  temporaryHome(async (home) => {
    const requests: { messages: { role: string; content: string }[] }[] = [];
    const model = createServer(async (request, response) => {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      requests.push(JSON.parse(Buffer.concat(chunks).toString()));
      response.setHeader('Content-Type', 'application/json');
      response.end(
        JSON.stringify({
          choices: [
            {
              message:
                requests.length === 1
                  ? {
                      role: 'assistant',
                      content: null,
                      tool_calls: [
                        {
                          id: 'fixture-call',
                          type: 'function',
                          function: { name: 'recruit_platforms', arguments: '{}' },
                        },
                      ],
                    }
                  : { role: 'assistant', content: '已取得真实工具返回的平台列表。' },
            },
          ],
        }),
      );
    });
    const endpoint = await serve(model);
    const { platform } = fakePlatform();
    const demo = createDemoServer({
      client: createRecruitmentClient({ home, platforms: [platform] }),
      config: { baseUrl: endpoint + '/v1', model: 'fixture-model', apiKey: '' },
    });
    const base = await serve(demo);
    try {
      const response = await fetch(base + '/api/chat', {
        method: 'POST',
        body: JSON.stringify({ message: '列出可用平台' }),
      });
      const events = await response.text();
      assert.match(events, /tool.start/);
      assert.match(events, /tool.result/);
      assert.match(events, /真实工具/);
      assert.match(events, /"type":"done"/);
      assert.equal(requests.length, 2);
      assert.ok(
        requests[1].messages.some(
          (message) => message.role === 'tool' && message.content.includes('测试平台'),
        ),
      );
    } finally {
      await close(demo);
      await close(model);
    }
  }));
