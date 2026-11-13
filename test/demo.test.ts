import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createDemoServer } from '../src/runtime/demo-server.js';
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
      root: process.cwd() + '/site',
      client: createRecruitmentClient({ home, platforms: [platform] }),
    });
    const base = await serve(server);
    try {
      assert.equal((await fetch(base + '/demo/')).status, 200);
      assert.equal((await fetch(base + '/')).url, base + '/demo/');
      assert.equal((await fetch(base + '/demo/demo.ts')).status, 404);
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

for (const scenario of ['allowed', 'denied', 'uncertain'] as const) {
  test(`AI plans and greets through the shared client: ${scenario}`, async () =>
    temporaryHome(async (home) => {
      const { platform, state } = fakePlatform();
      state.fail = scenario === 'uncertain';
      const client = createRecruitmentClient({ home, platforms: [platform] });
      await client.login({ platform: 'test', account: 'main' });
      let requests = 0;
      const model = createServer(async (request, response) => {
        assert.equal(request.headers.authorization, 'Bearer fabricated-test-key');
        const chunks = [];
        for await (const chunk of request) chunks.push(chunk);
        const input = JSON.parse(Buffer.concat(chunks).toString());
        const toolResults = input.messages.filter((item: { role: string }) => item.role === 'tool');
        const previous = toolResults.length ? JSON.parse(toolResults.at(-1).content) : undefined;
        const step = requests++ % 3;
        const call =
          step === 0
            ? {
                name: 'recruit_plan',
                arguments: JSON.stringify({ platform: 'test', query: 'TypeScript', limit: 1 }),
              }
            : { name: 'recruit_run_plan', arguments: JSON.stringify({ planId: previous?.id }) };
        response.setHeader('Content-Type', 'application/json');
        response.end(
          JSON.stringify({
            choices: [
              {
                message:
                  step === 2
                    ? { role: 'assistant', content: JSON.stringify(previous) }
                    : {
                        role: 'assistant',
                        content: null,
                        tool_calls: [{ id: 'call-' + requests, type: 'function', function: call }],
                      },
              },
            ],
          }),
        );
      });
      const endpoint = await serve(model);
      const demo = createDemoServer({
        client,
        config: { baseUrl: endpoint, model: 'fixture-model', apiKey: 'fabricated-test-key' },
      });
      const base = await serve(demo);
      try {
        for (let attempt = 0; attempt < 2; attempt++) {
          const response = await fetch(base + '/api/chat', {
            method: 'POST',
            body: JSON.stringify({
              message: '筛选并自动打招呼',
              platform: 'test',
              allowContact: scenario !== 'denied',
            }),
          });
          const events = await response.text();
          assert.match(events, /"type":"done"/);
          assert.match(
            events,
            scenario === 'denied' ? /未开启/ : scenario === 'uncertain' ? /indeterminate/ : /sent/,
          );
          assert.equal(events.includes('fabricated-test-key'), false);
        }
        assert.equal(state.sends.length, scenario === 'denied' ? 0 : 1);
        const history = await client.history({ platform: 'test', account: 'main' });
        assert.equal(history.length, scenario === 'denied' ? 0 : 1);
        if (history.length)
          assert.equal(history[0].state, scenario === 'uncertain' ? 'indeterminate' : 'sent');
      } finally {
        await close(demo);
        await close(model);
      }
    }));
}

test('streamed tool arguments are assembled before execution and text deltas reach the UI', async () =>
  temporaryHome(async (home) => {
    let round = 0;
    const model = createServer(async (request, response) => {
      for await (const _chunk of request) {
        /* drain request */
      }
      response.setHeader('Content-Type', 'text/event-stream');
      const deltas =
        round++ === 0
          ? [
              { reasoning_content: 'fixture-private-reasoning' },
              {
                tool_calls: [
                  {
                    index: 0,
                    id: 'call-stream',
                    function: { name: 'recruit_platforms', arguments: '{' },
                  },
                ],
              },
              { tool_calls: [{ index: 0, function: { arguments: '}' } }] },
            ]
          : [{ content: '## 平台' }, { content: '\n\n测试平台' }];
      for (const delta of deltas)
        response.write('data: ' + JSON.stringify({ choices: [{ delta }] }) + '\r\n\r\n');
      response.end('data: [DONE]\n\n');
    });
    const endpoint = await serve(model);
    const { platform } = fakePlatform();
    const demo = createDemoServer({
      client: createRecruitmentClient({ home, platforms: [platform] }),
      config: { baseUrl: endpoint, model: 'fixture-model', apiKey: '' },
    });
    const base = await serve(demo);
    try {
      const response = await fetch(base + '/api/chat', {
        method: 'POST',
        body: JSON.stringify({ message: '列出平台' }),
      });
      const events = await response.text();
      assert.match(events, /"phase":"thinking"/);
      assert.match(events, /tool.result/);
      assert.match(events, /message.delta/);
      assert.match(events, /"type":"done"/);
      assert.equal(events.includes('fixture-private-reasoning'), false);
      assert.equal(round, 2);
    } finally {
      await close(demo);
      await close(model);
    }
  }));
