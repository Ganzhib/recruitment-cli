import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import type { BrowserContext, Page } from 'playwright';
import { createBrowserPool } from '../src/runtime/browser-pool.js';

test('background browser survives separate actions, does not replay errors, and closes with its owner', async () => {
  let launches = 0;
  let closes = 0;
  let calls = 0;
  const context = new EventEmitter() as unknown as BrowserContext;
  const page = {} as Page;
  const pool = createBrowserPool(async (_directory, action) => {
    launches++;
    try {
      return await action(context, page);
    } finally {
      closes++;
    }
  });
  try {
    await pool.run('fabricated-profile', async (_context, current) => {
      assert.equal(current, page);
    });
    await assert.rejects(
      pool.run('fabricated-profile', async () => {
        calls++;
        throw new Error('operation failed');
      }),
      /operation failed/,
    );
    await pool.run('fabricated-profile', async (_context, current) => {
      assert.equal(current, page);
    });
    assert.equal(launches, 1);
    assert.equal(closes, 0);
    assert.equal(calls, 1);
  } finally {
    await pool.close();
  }
  assert.equal(closes, 1);
  await assert.rejects(
    pool.run('fabricated-profile', async () => {}),
    /closed/,
  );
});

test('a failed background launch is reported and is not automatically retried', async () => {
  let launches = 0;
  const pool = createBrowserPool(async () => {
    launches++;
    throw new Error('launch failed');
  });
  await assert.rejects(
    pool.run('fabricated-profile', async () => {}),
    /launch failed/,
  );
  assert.equal(launches, 1);
  await pool.close();
});
