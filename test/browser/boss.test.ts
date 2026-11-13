import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import type { Page, Response } from 'playwright';
import { createRecruitmentClient, createBossPlatform } from '../../src/index.js';
import { observeGreeting } from '../../src/platform/boss/outreach.js';
import { bossFixture } from './fixtures.js';
import { temporaryHome } from '../helpers.js';

for (const role of ['seeker', 'recruiter'] as const) {
  test(`BOSS ${role}: QR landing identifies role, activity selection and native greeting produce a verified receipt`, async () =>
    temporaryHome(async (home) => {
      const { browser, state } = bossFixture(role);
      const client = createRecruitmentClient({
        home,
        platforms: [createBossPlatform({ browser, loginTimeoutMs: 5000 })],
      });
      const binding = await client.login({ platform: 'boss' });
      assert.equal(binding.profile.role, role);
      assert.equal(binding.profile.id, 'fixture-user');
      const plan = await client.prepare(
        { platform: 'boss' },
        {
          query: 'TypeScript',
          activeWithin: '7d',
          options: role === 'recruiter' ? { job: 'position-1' } : {},
        },
      );
      assert.equal(plan.targets.length, 1);
      assert.equal(plan.targets[0].activity.withinMinutes, 4320);
      const result = await client.run(plan.id);
      assert.equal(result.status, 'complete');
      assert.equal(result.operations[0].state, 'sent');
      assert.match(
        result.operations[0].receipt!.evidence.source,
        role === 'seeker' ? /friend\/add/ : /chat\/start/,
      );
      assert.equal(state.sends, 1);
      await client.run(plan.id);
      assert.equal(state.sends, 1);
    }));
}
test('BOSS skips a target whose activity becomes too old after planning', async () =>
  temporaryHome(async (home) => {
    const { browser, state } = bossFixture('seeker');
    const client = createRecruitmentClient({ home, platforms: [createBossPlatform({ browser })] });
    await client.login({ platform: 'boss' });
    const plan = await client.prepare({ platform: 'boss' }, { query: 'TypeScript' });
    state.activity = '30日内活跃';
    const result = await client.run(plan.id);
    assert.equal(result.operations[0].state, 'skipped');
    assert.equal(state.sends, 0);
  }));
test('native greeting watcher times out without success and removes listeners after a failed click', async () => {
  const events = new EventEmitter();
  const page = events as unknown as Page;
  await assert.rejects(
    observeGreeting(page, '/wapi/zpgeek/friend/add.json', async () => {}, 20),
    /不会自动重发/,
  );
  assert.equal(events.listenerCount('response'), 0);
  await assert.rejects(
    observeGreeting(
      page,
      '/wapi/zpgeek/friend/add.json',
      async () => {
        throw new Error('click failed');
      },
      1000,
    ),
    /click failed/,
  );
  assert.equal(events.listenerCount('response'), 0);
});

test('native greeting ignores successful responses for other targets', async () => {
  const events = new EventEmitter();
  const page = events as unknown as Page;
  const wrongResponse = {
    url: () => 'https://www.zhipin.com/wapi/zpgeek/friend/add.json?securityId=other',
    request: () => ({ postData: () => null }),
    ok: () => true,
    json: async () => ({ code: 0, message: '' }),
  } as unknown as Response;
  await assert.rejects(
    observeGreeting(
      page,
      '/wapi/zpgeek/friend/add.json',
      async () => {
        events.emit('response', wrongResponse);
      },
      20,
      { securityId: 'expected' },
    ),
    /不会自动重发/,
  );
  assert.equal(events.listenerCount('response'), 0);
});

test('BOSS login follows a new authenticated tab when the original login page closes', async () => {
  const { waitForBossLogin } = await import('../../src/platform/boss/session.js');
  const { fixtureBrowser } = await import('./fixtures.js');
  const browser = fixtureBrowser(async (route) =>
    route.fulfill({ contentType: 'text/html', body: '<main>fabricated login</main>' }),
  );
  await browser('', async (context, original) => {
    await original.goto('https://www.zhipin.com/web/user/');
    const waiting = waitForBossLogin(context, 5000);
    const authenticated = await context.newPage();
    await authenticated.goto('https://www.zhipin.com/web/geek/job');
    await original.close();
    assert.equal(await waiting, authenticated);
  });
});
