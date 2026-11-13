import test from 'node:test';
import assert from 'node:assert/strict';
import { fixtureBrowser } from './fixtures.js';
import { searchJobs } from '../../src/platform/boss/discovery.js';
import { observeSearchResponse } from '../../src/platform/boss/search-response.js';
import { RecruitmentError } from '../../src/shared/errors.js';

const origin = 'https://www.zhipin.com';
const path = '/wapi/zpgeek/search/joblist.json';
const input = { query: 'TypeScript', city: '上海', page: 1, options: { transport: 'browser' } };
const profile = { id: 'fixture', name: 'Fixture', role: 'seeker' as const };

for (const mode of ['verification', 'failed', 'html'] as const) {
  test(`browser search stops on ${mode} instead of waiting for a missing JSON response`, async () => {
    let reads = 0;
    const browser = fixtureBrowser(async (route) => {
      const url = new URL(route.request().url());
      if (url.origin !== origin) return route.abort();
      if (url.pathname === '/web/passport/zp/verify.html')
        return route.fulfill({ contentType: 'text/html', body: 'Verification required' });
      if (url.pathname === '/web/geek/job')
        return route.fulfill({
          contentType: 'text/html',
          body:
            mode === 'verification'
              ? '<script>location.href="/web/passport/zp/verify.html"</script>'
              : `<script>fetch('${path}', {method:'POST', body:JSON.stringify({query:'TypeScript',city:'101020100',page:1})})</script>`,
        });
      if (url.pathname === path) {
        reads++;
        return mode === 'failed'
          ? route.abort()
          : route.fulfill({ contentType: 'text/html', body: 'Unavailable' });
      }
      return route.abort();
    });
    await browser('', async (_context, page) => {
      await assert.rejects(searchJobs({ page, profile }, input), (error: unknown) => {
        assert.ok(error instanceof RecruitmentError);
        assert.equal(
          error.details?.reason,
          {
            verification: 'verification-required',
            failed: 'request-failed',
            html: 'response-unavailable',
          }[mode],
        );
        return true;
      });
      assert.equal(reads, mode === 'verification' ? 0 : 1);
    });
  });
}

test('browser search only accepts the requested query after navigation', async () => {
  const browser = fixtureBrowser(async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) return route.abort();
    if (url.pathname === '/web/geek/job')
      return route.fulfill({
        contentType: 'text/html',
        body: `<script>
        fetch('${path}', {method:'POST', body:JSON.stringify({query:'other',city:'101020100',page:1})});
        fetch('${path}', {method:'POST', body:JSON.stringify({query:'TypeScript',city:'101020100',page:1})});
      </script>`,
      });
    if (url.pathname === path)
      return route.fulfill({
        json: { code: 0, zpData: { query: JSON.parse(route.request().postData()!).query } },
      });
    return route.abort();
  });
  await browser('', async (_context, page) => {
    const observed = observeSearchResponse<{ query: string }>(
      page,
      path + '?query=TypeScript&city=101020100&page=1',
      2000,
    );
    try {
      const [result] = await Promise.all([observed.result, page.goto(origin + '/web/geek/job')]);
      assert.equal(result.query, 'TypeScript');
    } finally {
      observed.dispose();
    }
  });
});
