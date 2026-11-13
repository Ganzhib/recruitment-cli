import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createRecruitmentClient,
  createRecruitmentTools,
  type RecruitmentToolEvent,
} from '../src/index.js';
import { fakePlatform, temporaryHome } from './helpers.js';
import { RecruitmentError } from '../src/shared/errors.js';

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

test('agent failure events preserve the rejected endpoint for the demo receipt', async (t) =>
  temporaryHome(async (home) => {
    const { platform } = fakePlatform();
    const client = createRecruitmentClient({ home, platforms: [platform] });
    const details = {
      endpoint: '/wapi/zpuser/wap/getUserInfo.json',
      reason: 'environment-rejected',
      platformCode: 37,
    };
    t.mock.method(client, 'search', async () => {
      throw new RecruitmentError('AUTH', '环境存在异常', details);
    });
    const events: RecruitmentToolEvent[] = [];
    const tools = createRecruitmentTools(client, (event) => events.push(event));
    await assert.rejects(
      tools.execute('recruit_search', { platform: 'test', query: 'TypeScript' }),
      /环境存在异常/,
    );
    assert.equal(events.at(-1)?.type, 'tool.error');
    assert.equal(events.at(-1)?.errorCode, 'AUTH');
    assert.deepEqual(events.at(-1)?.errorDetails, details);
  }));
