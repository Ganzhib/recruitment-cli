import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createRecruitmentClient,
  createRecruitmentTools,
  type RecruitmentToolEvent,
} from '../src/index.js';
import { fakePlatform, temporaryHome } from './helpers.js';

test('agent tools expose schemas and share real client execution and events', async () =>
  temporaryHome(async (home) => {
    const { platform } = fakePlatform();
    const client = createRecruitmentClient({ home, platforms: [platform] });
    await client.login({ platform: 'test' });
    const events: RecruitmentToolEvent[] = [];
    const tools = createRecruitmentTools(client, (event) => events.push(event));
    assert.ok(tools.functions().some((tool) => tool.function.name === 'recruit_search'));
    const result = (await tools.execute('recruit_search', {
      platform: 'test',
      query: 'TypeScript',
    })) as { targets: unknown[] };
    assert.equal(result.targets.length, 1);
    assert.deepEqual(
      events.map((event) => event.type),
      ['tool.start', 'tool.result'],
    );
    assert.match(events[0].command, /recruit search/);
  }));
test('agent write permission belongs to the caller and cannot come from model tool arguments', async () =>
  temporaryHome(async (home) => {
    const { platform, state } = fakePlatform();
    const client = createRecruitmentClient({ home, platforms: [platform] });
    await client.login({ platform: 'test' });
    const plan = await client.prepare({ platform: 'test' }, { query: 'TypeScript' });
    const tools = createRecruitmentTools(client);
    await assert.rejects(
      tools.execute('recruit_run_plan', { planId: plan.id, allowContact: true }),
      /未开启/,
    );
    assert.deepEqual(state.sends, []);
    await tools.execute('recruit_run_plan', { planId: plan.id }, { allowContact: true });
    await tools.execute('recruit_run_plan', { planId: plan.id }, { allowContact: true });
    assert.deepEqual(state.sends, ['job-1']);
    await assert.rejects(tools.execute('shell', { command: 'anything' }), /工具不存在/);
  }));
