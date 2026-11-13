import test from 'node:test';
import assert from 'node:assert/strict';
import { createDemoServer } from '../src/runtime/demo-server.js';
import { createRecruitmentClient } from '../src/index.js';
import { fakePlatform, temporaryHome } from './helpers.js';
import { serve } from './fixtures/demo.js';

test('demo serves assets, exposes tools, rejects cross-origin access and keeps keys out of config reads', async (t) =>
  temporaryHome(async (home) => {
    const { platform } = fakePlatform();
    const server = createDemoServer({
      root: process.cwd() + '/site',
      client: createRecruitmentClient({ home, platforms: [platform] }),
    });
    const base = await serve(t, server);
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
  }));
