import test from 'node:test';
import assert from 'node:assert/strict';
import { appendFile, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createRecruitmentClient, createDemoServer } from '../src/index.js';
import { DemoStore, savedAgentMessage } from '../src/runtime/demo-store.js';
import { fakePlatform, temporaryHome } from './helpers.js';
import { chat, modelFixture, serve, toolReply } from './fixtures/demo.js';

async function post(base: string, path: string, value: unknown) {
  const response = await fetch(base + path, { method: 'POST', body: JSON.stringify(value) });
  assert.equal(response.status, 200, await response.clone().text());
  return response.json();
}

test('restart restores settings, credentials, tool history and conversation context', async (t) =>
  temporaryHome(async (home) => {
    const { platform } = fakePlatform();
    const model = await modelFixture(t, (_request, round) =>
      round === 0
        ? {
            ...toolReply('persisted-call', 'recruit_platforms', {}),
            reasoning_content: 'private-reasoning-fixture',
          }
        : { role: 'assistant', content: '已读取平台。' },
    );
    const start = () =>
      createDemoServer({ client: createRecruitmentClient({ home, platforms: [platform] }) });
    const first = start();
    const base = await serve(t, first);
    await post(base, '/api/config', {
      baseUrl: model.url,
      model: 'fixture-model',
      apiKey: 'fake-persistent-key',
    });
    await post(base, '/api/config', { baseUrl: model.url, model: 'updated-model', apiKey: '' });
    const events = await chat(base, { message: '列出平台' });
    const id = JSON.parse(events.split('\n')[0].slice(6)).conversationId as string;
    await post(base, '/api/ui', { conversationId: id, role: 'recruiter', platform: 'test' });
    const log = await readFile(join(home, 'conversations', id, 'events.jsonl'), 'utf8');
    assert.match(log, /tool.result/);
    assert.match(log, /turn.completed/);
    assert.doesNotMatch(log, /private-reasoning-fixture|fake-persistent-key/);
    assert.doesNotMatch(await readFile(join(home, 'config.json'), 'utf8'), /fake-persistent-key/);
    await new Promise<void>((resolve) => first.close(() => resolve()));
    const restored = await serve(t, start());
    const config = (await (await fetch(restored + '/api/config')).json()) as Record<
      string,
      unknown
    >;
    assert.equal(config.model, 'updated-model');
    assert.equal(config.hasApiKey, true);
    assert.equal('apiKey' in config, false);
    const ui = (await (await fetch(restored + '/api/ui')).json()) as {
      conversationId: string;
      role: string;
    };
    assert.equal(ui.conversationId, id);
    assert.equal(ui.role, 'recruiter');
    const history = await (await fetch(restored + '/api/conversations/' + id)).text();
    assert.match(history, /已读取平台/);
    assert.doesNotMatch(history, /private-reasoning-fixture|fake-persistent-key/);
    assert.equal(model.requests.length, 2, 'reading history must never invoke the model');
    await chat(restored, { conversationId: id, message: '继续介绍平台' });
    assert.equal(model.requests[2].authorization, 'Bearer fake-persistent-key');
    assert.ok(
      model.requests[2].messages.some(
        (message) => message.role === 'tool' && message.tool_call_id === 'persisted-call',
      ),
    );
    await post(restored, '/api/config', {
      baseUrl: model.url,
      model: 'updated-model',
      clearApiKey: true,
    });
    assert.equal((await new DemoStore(home).loadConfig())?.apiKey, '');
    await post(restored, '/api/config', {
      baseUrl: 'https://different.example/v1',
      model: 'other',
    });
    assert.equal((await new DemoStore(home).loadConfig())?.apiKey, '');
  }));

test('interrupted calls and a partial final line are restored without replay, then accept a new turn', async (t) =>
  temporaryHome(async (home) => {
    const { platform, state } = fakePlatform();
    const store = new DemoStore(home);
    const id = randomUUID();
    const turn = randomUUID();
    await store.use(id, false, async (_events, append) => {
      await append(turn, {
        type: 'turn.started',
        message: '开始联系',
        platform: 'test',
        allowContact: true,
      });
      await append(turn, {
        type: 'message',
        message: savedAgentMessage(
          toolReply('unfinished-call', 'recruit_run_plan', { planId: randomUUID() }),
        ),
      });
      await append(turn, {
        type: 'tool',
        event: {
          type: 'tool.start',
          id: 'unfinished-event',
          name: 'recruit_run_plan',
          command: 'recruit plan run fixture',
        },
      });
    });
    const filename = join(home, 'conversations', id, 'events.jsonl');
    await appendFile(filename, '{"v":1,"seq":4,"unfinished":"半');
    const model = await modelFixture(t, () => ({ role: 'assistant', content: '请先核对回执。' }));
    const base = await serve(
      t,
      createDemoServer({
        client: createRecruitmentClient({ home, platforms: [platform] }),
        config: { baseUrl: model.url, model: 'fixture', apiKey: '' },
      }),
    );
    const listing = (await (await fetch(base + '/api/conversations')).json()) as {
      conversations: { interrupted: boolean }[];
    };
    assert.equal(listing.conversations[0].interrupted, true);
    assert.equal((await fetch(base + '/api/conversations/' + id)).status, 200);
    assert.equal(model.requests.length, 0);
    assert.equal(state.sends.length, 0);
    await chat(base, { conversationId: id, message: '只说明上次的状态，不执行' });
    assert.equal(model.requests.length, 1);
    assert.equal(state.sends.length, 0);
    const context = model.requests[0].messages;
    assert.match(
      context.find((message) => message.tool_call_id === 'unfinished-call')!.content!,
      /结果未知/,
    );
    assert.match(context.at(-1)!.content!, /权限：false/);
    const recovered = await new DemoStore(home).read(id);
    assert.ok(recovered.events.some((event) => event.payload.type === 'turn.interrupted'));
    assert.equal(recovered.events.at(-1)!.payload.type, 'turn.completed');
    assert.doesNotMatch(await readFile(filename, 'utf8'), /"unfinished":/);
  }));

test('conversation locks reject concurrent writers and malformed committed records fail explicitly', async () =>
  temporaryHome(async (home) => {
    const store = new DemoStore(home);
    const id = randomUUID();
    await store.use(id, false, async (_events, append) => {
      await append(randomUUID(), {
        type: 'turn.started',
        message: 'test',
        platform: 'test',
        allowContact: false,
      });
      await assert.rejects(
        new DemoStore(home).use(id, true, async () => {}),
        { code: 'BUSY' },
      );
    });
    const filename = join(home, 'conversations', id, 'events.jsonl');
    const original = await readFile(filename, 'utf8');
    await writeFile(filename, original + '{bad json}\n');
    await assert.rejects(store.read(id));
    await assert.rejects(store.use(id, true, async () => {}));
    assert.equal(await readFile(filename, 'utf8'), original + '{bad json}\n');
    await assert.rejects(store.read('../config'));
  }));
