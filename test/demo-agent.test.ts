import test from 'node:test';
import assert from 'node:assert/strict';
import { createDemoServer } from '../src/runtime/demo-server.js';
import { createRecruitmentClient } from '../src/index.js';
import { fakePlatform, temporaryHome } from './helpers.js';
import { chat, modelFixture, serve, toolReply } from './fixtures/demo.js';

test('model tool loop emits actual tool events and returns the result to the model', async (t) =>
  temporaryHome(async (home) => {
    const model = await modelFixture(t, (_request, round) =>
      round === 0
        ? toolReply('fixture-call', 'recruit_platforms', {})
        : { role: 'assistant', content: '已取得工具返回的平台列表。' },
    );
    const { platform } = fakePlatform();
    const base = await serve(
      t,
      createDemoServer({
        client: createRecruitmentClient({ home, platforms: [platform] }),
        config: { baseUrl: model.url + '/v1', model: 'fixture-model', apiKey: '' },
      }),
    );
    const events = await chat(base, { message: '列出可用平台' });
    assert.match(events, /tool.start/);
    assert.match(events, /tool.result/);
    assert.match(events, /已取得工具/);
    assert.match(events, /"type":"done"/);
    assert.equal(model.requests.length, 2);
    assert.ok(
      model.requests[1].messages.some(
        (message) => message.role === 'tool' && message.content?.includes('测试平台'),
      ),
    );
  }));

for (const scenario of ['allowed', 'denied', 'uncertain'] as const) {
  test(`AI plans and greets through the shared client: ${scenario}`, async (t) =>
    temporaryHome(async (home) => {
      const { platform, state } = fakePlatform();
      state.fail = scenario === 'uncertain';
      const client = createRecruitmentClient({ home, platforms: [platform] });
      await client.login({ platform: 'test', account: 'main' });
      const model = await modelFixture(t, (request, round) => {
        const previousMessage = request.messages.filter((item) => item.role === 'tool').at(-1);
        const previous = previousMessage ? JSON.parse(previousMessage.content!) : undefined;
        switch (round % 3) {
          case 0:
            return toolReply('call-' + round, 'recruit_plan', {
              platform: 'test',
              query: 'TypeScript',
              limit: 1,
            });
          case 1:
            return toolReply('call-' + round, 'recruit_run_plan', { planId: previous.id });
          default:
            return { role: 'assistant', content: JSON.stringify(previous) };
        }
      });
      const base = await serve(
        t,
        createDemoServer({
          client,
          config: { baseUrl: model.url, model: 'fixture-model', apiKey: 'fabricated-test-key' },
        }),
      );
      for (let attempt = 0; attempt < 2; attempt++) {
        const events = await chat(base, {
          message: '筛选并自动打招呼',
          platform: 'test',
          allowContact: scenario !== 'denied',
        });
        assert.match(events, /"type":"done"/);
        assert.match(
          events,
          scenario === 'denied' ? /未开启/ : scenario === 'uncertain' ? /indeterminate/ : /sent/,
        );
        assert.equal(events.includes('fabricated-test-key'), false);
      }
      assert.ok(
        model.requests.every((request) => request.authorization === 'Bearer fabricated-test-key'),
      );
      assert.equal(state.sends.length, scenario === 'denied' ? 0 : 1);
      const history = await client.history({ platform: 'test', account: 'main' });
      assert.equal(history.length, scenario === 'denied' ? 0 : 1);
      if (history.length)
        assert.equal(history[0].state, scenario === 'uncertain' ? 'indeterminate' : 'sent');
    }));
}

test('streamed tool arguments are assembled before execution and text deltas reach the UI', async (t) =>
  temporaryHome(async (home) => {
    const model = await modelFixture(t, (_request, round) => ({
      deltas:
        round === 0
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
          : [{ content: '## 平台' }, { content: '\n\n测试平台' }],
    }));
    const { platform } = fakePlatform();
    const base = await serve(
      t,
      createDemoServer({
        client: createRecruitmentClient({ home, platforms: [platform] }),
        config: { baseUrl: model.url, model: 'fixture-model', apiKey: '' },
      }),
    );
    const events = await chat(base, { message: '列出平台' });
    assert.match(events, /"phase":"thinking"/);
    assert.match(events, /tool.result/);
    assert.match(events, /message.delta/);
    assert.match(events, /"type":"done"/);
    assert.equal(events.includes('fixture-private-reasoning'), false);
    assert.equal(model.requests.length, 2);
  }));
