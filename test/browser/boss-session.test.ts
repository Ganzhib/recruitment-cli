import test from 'node:test';
import assert from 'node:assert/strict';
import { bossGet, BOSS_ORIGIN } from '../../src/platform/boss/session.js';
import { RecruitmentError } from '../../src/shared/errors.js';
import { fixtureBrowser } from './fixtures.js';

test('BOSS reads use the current session token and never send it to another origin', async () => {
  let requests = 0;
  const browser = fixtureBrowser(async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== BOSS_ORIGIN) return route.abort();
    if (url.pathname === '/web/geek/job')
      return route.fulfill({ contentType: 'text/html', body: '<main>Fabricated jobs</main>' });
    requests++;
    const tokenMatches = route.request().headers().zp_token === `fabricated-session-${requests}`;
    return route.fulfill({ json: { code: 0, message: '', zpData: { tokenMatches } } });
  });
  await browser('', async (context, page) => {
    await page.goto(BOSS_ORIGIN + '/web/geek/job');
    for (const index of [1, 2]) {
      await context.addCookies([
        {
          name: 'bst',
          value: `fabricated-session-${index}`,
          url: BOSS_ORIGIN,
          httpOnly: true,
        },
      ]);
      assert.deepEqual(await bossGet(page, '/wapi/zpgeek/search/joblist.json'), {
        tokenMatches: true,
      });
    }
    await assert.rejects(bossGet(page, 'https://external.example/api'), /不属于 BOSS/);
    assert.equal(requests, 2);
  });
});

test('BOSS read failures preserve endpoint and rejection reason without retrying or exposing queries', async () => {
  const scenarios = [
    { code: 37, message: '您的环境存在异常.', reason: 'environment-rejected' },
    { code: 37, message: '请登录', reason: 'session-rejected' },
    { code: 121, message: '请验证', reason: 'verification-required' },
    { code: 122, message: '请验证', reason: 'verification-required' },
    { code: 9, message: '请求频繁', reason: 'rate-limited' },
  ];
  let requests = 0;
  const browser = fixtureBrowser(async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== BOSS_ORIGIN) return route.abort();
    if (url.pathname === '/web/geek/job')
      return route.fulfill({ contentType: 'text/html', body: '<main>Fabricated jobs</main>' });
    const scenario = scenarios[requests++];
    return route.fulfill({
      json: { code: scenario.code, message: scenario.message, zpData: null },
    });
  });
  await browser('', async (_context, page) => {
    await page.goto(BOSS_ORIGIN + '/web/geek/job');
    for (const scenario of scenarios) {
      await assert.rejects(
        bossGet(page, '/wapi/zpgeek/search/joblist.json?query=private-query'),
        (error: unknown) => {
          assert.ok(error instanceof RecruitmentError);
          assert.deepEqual(error.details, {
            platformCode: scenario.code,
            endpoint: '/wapi/zpgeek/search/joblist.json',
            reason: scenario.reason,
          });
          return true;
        },
      );
    }
    assert.equal(requests, scenarios.length);
  });
});
