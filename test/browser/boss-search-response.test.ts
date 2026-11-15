import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import type { Frame, Page, Request } from 'playwright';
import { fixtureBrowser } from './fixtures.js';
import { searchJobs } from '../../src/platform/boss/discovery.js';
import { observeSearchResponse } from '../../src/platform/boss/search-response.js';
import { RecruitmentError } from '../../src/shared/errors.js';

const origin = 'https://www.zhipin.com';
const path = '/wapi/zpgeek/search/joblist.json';
const input = { query: 'TypeScript', city: '上海', page: 1, options: { transport: 'browser' } };
const profile = { id: 'fixture', name: 'Fixture', role: 'seeker' as const };

for (const mode of ['verification', 'login', 'failed', 'html'] as const) {
  test(`browser search stops on ${mode} instead of waiting for a missing JSON response`, async () => {
    let reads = 0;
    const browser = fixtureBrowser(async (route) => {
      const url = new URL(route.request().url());
      if (url.origin !== origin) return route.abort();
      if (url.pathname === '/web/passport/zp/verify.html')
        return route.fulfill({ contentType: 'text/html', body: 'Verification required' });
      if (url.pathname === '/web/user/')
        return route.fulfill({ contentType: 'text/html', body: 'Login required' });
      if (url.pathname === '/web/geek/job')
        return route.fulfill({
          contentType: 'text/html',
          body:
            mode === 'verification'
              ? '<script>location.href="/web/passport/zp/verify.html"</script>'
              : mode === 'login'
                ? '<script>location.href="/web/user/"</script>'
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
            login: 'login-required',
            failed: 'request-failed',
            html: 'response-unavailable',
          }[mode],
        );
        return true;
      });
      assert.equal(reads, ['verification', 'login'].includes(mode) ? 0 : 1);
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

test('browser search stops on session rejection even when request fields are missing', async () => {
  for (const code of [31, 37, 9, 121]) {
    let reads = 0;
    const browser = fixtureBrowser(async (route) => {
      const url = new URL(route.request().url());
      if (url.origin !== origin) return route.abort();
      if (url.pathname === '/web/geek/job')
        return route.fulfill({
          contentType: 'text/html',
          body: `<script>fetch('${path}', {method:'POST'})</script>`,
        });
      if (url.pathname === path) {
        reads++;
        return route.fulfill({ json: { code, message: 'Rejected', zpData: null } });
      }
      return route.abort();
    });
    await browser('', async (_context, page) => {
      await assert.rejects(
        searchJobs({ page, profile }, { ...input, options: {} }),
        (error: unknown) => {
          assert.ok(error instanceof RecruitmentError);
          assert.equal(error.details?.platformCode, code);
          return true;
        },
      );
      await assert.rejects(searchJobs({ page, profile }, { ...input, page: 2 }), /从第一页开始/);
      assert.equal(reads, 1);
    });
  }
});

for (const mode of ['button', 'scroll'] as const) {
  test(`browser search preserves pagination across detail navigation using ${mode}`, async () => {
    const requested: number[] = [];
    const requestedAt: number[] = [];
    let navigations = 0;
    const browser = fixtureBrowser(async (route) => {
      const url = new URL(route.request().url());
      if (url.origin !== origin) return route.abort();
      if (url.pathname === '/web/geek/job') {
        navigations++;
        return route.fulfill({
          contentType: 'text/html',
          body: `<meta charset="utf-8"><article class="job-card-wrapper" style="height:1500px">Job</article>
            ${mode === 'button' ? '<button aria-label="下一页" onclick="loadNext()">Next</button>' : ''}
            <script>
              let page = 0;
              function loadNext() {
                fetch('${path}', {method:'POST',body:new URLSearchParams({
                  query:'TypeScript',city:'101020100',page:String(++page)
                })});
              }
              ${mode === 'scroll' ? "document.addEventListener('keydown', e => { if (e.key === 'End') loadNext(); });" : ''}
              loadNext();
            </script>`,
        });
      }
      if (url.pathname === path) {
        const number = Number(new URLSearchParams(route.request().postData()!).get('page'));
        requested.push(number);
        requestedAt.push(Date.now());
        return route.fulfill({ json: { code: 0, zpData: { jobList: [], hasMore: number < 2 } } });
      }
      if (url.pathname === '/job_detail/fixture.html')
        return route.fulfill({ contentType: 'text/html', body: 'Fixture detail' });
      return route.abort();
    });
    await browser('', async (context, page) => {
      const first = await searchJobs({ page, profile }, input);
      assert.equal(first.hasMore, true);
      await page.goto(origin + '/job_detail/fixture.html');
      await assert.rejects(searchJobs({ page, profile }, { ...input, page: 3 }), /顺序翻页/);
      await assert.rejects(
        searchJobs({ page, profile }, { ...input, city: '北京', page: 2 }),
        /顺序翻页/,
      );
      const second = await searchJobs({ page, profile }, { ...input, page: 2 });
      assert.equal(second.hasMore, false);
      assert.deepEqual(requested, [1, 2]);
      assert.ok(requestedAt[1] - requestedAt[0] >= 12000);
      assert.equal(navigations, 1);
      assert.equal(page.url(), origin + '/job_detail/fixture.html');
      assert.equal(context.pages().length, 2);
    });
  });
}

test('search observers ignore stale responses and clean up after timeout or close', async () => {
  for (const mode of ['timeout', 'close'] as const) {
    const events = new EventEmitter();
    const frame = { url: () => origin + '/web/geek/job' } as Frame;
    const page = Object.assign(events, { mainFrame: () => frame }) as unknown as Page;
    const observed = observeSearchResponse(
      page,
      path + '?query=TypeScript&city=101020100&page=2',
      20,
      {
        waitForNavigation: false,
      },
    );
    const request = {
      url: () => origin + path,
      postData: () => 'query=TypeScript&city=101020100&page=2',
    } as Request;
    events.emit('response', { request: () => request });
    if (mode === 'close') events.emit('close');
    try {
      await assert.rejects(observed.result, (error: unknown) => {
        assert.ok(error instanceof RecruitmentError);
        assert.equal(error.details?.reason, mode === 'close' ? 'browser-closed' : 'search-timeout');
        return true;
      });
    } finally {
      observed.dispose();
    }
    for (const event of [
      'framenavigated',
      'request',
      'response',
      'requestfailed',
      'close',
      'crash',
    ])
      assert.equal(events.listenerCount(event), 0);
  }
});
