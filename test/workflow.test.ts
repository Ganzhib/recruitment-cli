import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createRecruitmentClient, RecruitmentError } from '../src/index.js';
import { writeJson } from '../src/runtime/storage.js';
import { fakePlatform, target, temporaryHome } from './helpers.js';

test('search uses recent activity, excludes contacted and unknown, and orders active targets', async () =>
  temporaryHome(async (home) => {
    const { platform, state } = fakePlatform();
    state.targets = [
      target('old', 20000),
      target('unknown', null),
      target('recent', 500),
      target('online', 0),
      { ...target('contacted'), contactState: 'contacted' },
    ];
    const client = createRecruitmentClient({ home, platforms: [platform] });
    await client.login({ platform: 'test' });
    const result = await client.search(
      { platform: 'test' },
      { query: 'TypeScript', activeWithin: '7d' },
    );
    assert.deepEqual(
      result.targets.map((target) => target.id),
      ['online', 'recent'],
    );
    assert.equal(state.detailReads, 1);
    assert.deepEqual(
      result.excluded.map((target) => target.reason),
      ['inactive', 'activity-unknown', 'already-contacted'],
    );
  }));
test('plans freeze identity, role and options; repeated plans never resend the same target', async () =>
  temporaryHome(async (home) => {
    const { platform, state } = fakePlatform();
    const client = createRecruitmentClient({ home, platforms: [platform] });
    const binding = await client.login({ platform: 'test' });
    const plan = await client.prepare(
      { platform: 'test' },
      { query: 'TypeScript', options: { opaque: 'value' } },
    );
    assert.deepEqual(plan.identity, binding.identity);
    assert.equal(plan.role, 'seeker');
    assert.deepEqual(plan.selection.options, { opaque: 'value' });
    assert.equal(state.sends.length, 0);
    assert.equal((await client.run(plan.id)).status, 'complete');
    await client.run(plan.id);
    const next = await client.prepare({ platform: 'test' }, { query: 'TypeScript' });
    await client.run(next.id);
    assert.deepEqual(state.sends, ['job-1']);
  }));
test('uncertain dispatch stops a batch and is never replayed on resume', async () =>
  temporaryHome(async (home) => {
    const { platform, state } = fakePlatform();
    state.targets = [target('one'), target('two')];
    const client = createRecruitmentClient({ home, platforms: [platform] });
    await client.login({ platform: 'test' });
    const plan = await client.prepare({ platform: 'test' }, { query: 'TypeScript' });
    state.fail = true;
    const failed = await client.run(plan.id);
    assert.equal(failed.status, 'attention');
    assert.deepEqual(state.sends, ['one']);
    state.fail = false;
    const resumed = await client.run(plan.id);
    assert.equal(resumed.status, 'attention');
    assert.deepEqual(state.sends, ['one', 'two']);
    assert.equal(
      (await client.history({ platform: 'test' })).filter((operation) => operation.state === 'sent')
        .length,
      1,
    );
  }));
test('pending receipt from a crashed process is converted to indeterminate without another send', async () =>
  temporaryHome(async (home) => {
    const { platform, state } = fakePlatform();
    const client = createRecruitmentClient({ home, platforms: [platform] });
    const { identity } = await client.login({ platform: 'test' });
    const plan = await client.prepare({ platform: 'test' }, { query: 'TypeScript' });
    await client.run(plan.id);
    const file = (await readdir(join(home, 'operations', identity.bindingId)))[0];
    const operation = (await client.history({ platform: 'test' }))[0];
    await writeJson(join(home, 'operations', identity.bindingId, file), {
      ...operation,
      state: 'pending',
    });
    assert.equal((await client.run(plan.id)).operations[0].state, 'indeterminate');
    assert.equal(state.sends.length, 1);
  }));
test('changed user or role cannot execute a frozen plan', async () =>
  temporaryHome(async (home) => {
    const { platform, state } = fakePlatform();
    const client = createRecruitmentClient({ home, platforms: [platform] });
    await client.login({ platform: 'test' });
    const plan = await client.prepare({ platform: 'test' }, { query: 'TypeScript' });
    state.profile = { ...state.profile, role: 'recruiter' };
    await assert.rejects(
      client.run(plan.id),
      (error: unknown) => error instanceof RecruitmentError && error.code === 'AUTH',
    );
    state.profile = { ...state.profile, role: 'seeker', id: 'another-user' };
    await assert.rejects(
      client.run(plan.id),
      (error: unknown) => error instanceof RecruitmentError && error.code === 'AUTH',
    );
    assert.equal(state.sends.length, 0);
  }));
test('concurrent operations share the real account lock across aliases and clients', async () =>
  temporaryHome(async (home) => {
    const { platform } = fakePlatform();
    const client = createRecruitmentClient({ home, platforms: [platform] });
    const { identity } = await client.login({ platform: 'test' });
    await client.accounts.use(identity, async () => {
      const otherClient = createRecruitmentClient({ home, platforms: [platform] });
      await assert.rejects(
        otherClient.status({ platform: 'test' }),
        (error: unknown) => error instanceof RecruitmentError && error.code === 'BUSY',
      );
    });
  }));
test('generic invoke rejects direct writes even when called from JavaScript', async () =>
  temporaryHome(async (home) => {
    const { platform } = fakePlatform();
    const client = createRecruitmentClient({ home, platforms: [platform] });
    assert.throws(
      () =>
        Reflect.apply(client.invoke, client, [
          { platform: 'test' },
          'contact.send',
          { target: target() },
        ]),
      /联系计划/,
    );
  }));
