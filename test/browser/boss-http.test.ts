import test from 'node:test';
import assert from 'node:assert/strict';
import { request, type APIRequestContext } from 'playwright';
import { createBossPlatform, createRecruitmentClient } from '../../src/index.js';
import { bossHttpGet, readBossHttpSession } from '../../src/platform/boss/http-session.js';
import { BOSS_ORIGIN } from '../../src/platform/boss/session.js';
import { RecruitmentError } from '../../src/shared/errors.js';
import { temporaryHome } from '../helpers.js';
import { bossFixture } from './boss-fixture.js';

test('normal login saves a local HTTP session; subsequent job search opens no browser and persists refreshed cookies', async (t) =>
  temporaryHome(async (home) => {
    const fixture = bossFixture('seeker');
    const loginClient = createRecruitmentClient({
      home,
      platforms: [
        createBossPlatform({
          browser: (directory, action) =>
            fixture.browser(directory, async (context, page) => {
              await context.addCookies([
                { name: 'bst', value: 'fabricated-initial', url: BOSS_ORIGIN },
              ]);
              return action(context, page);
            }),
        }),
      ],
    });
    await loginClient.login({ platform: 'boss' });
    let gets = 0;
    let disposed = 0;
    t.mock.method(
      request,
      'newContext',
      async (options: Parameters<typeof request.newContext>[0]) => {
        const state = options!.storageState;
        assert.ok(state && typeof state !== 'string');
        let cookies = state.cookies;
        return {
          get: async (
            url: string,
            input: { headers: Record<string, string>; maxRetries: number; maxRedirects: number },
          ) => {
            gets++;
            assert.equal(input.maxRetries, 0);
            assert.equal(input.maxRedirects, 0);
            assert.equal(
              input.headers.zp_token,
              gets === 1 ? 'fabricated-initial' : 'fabricated-refreshed',
            );
            cookies = cookies.map((cookie) => ({ ...cookie, value: 'fabricated-refreshed' }));
            const endpoint = new URL(url);
            const zpData = endpoint.pathname.includes('getUserInfo')
              ? { userId: 'fixture-user', name: '虚构用户' }
              : {
                  hasMore: false,
                  jobList: [
                    {
                      encryptJobId: 'fixture-job',
                      securityId: 'fabricated-id',
                      jobName: '前端工程师',
                      brandName: '虚构公司',
                      cityName: '上海',
                      salaryDesc: '20-30K',
                      jobExperience: '3年',
                      jobDegree: '本科',
                    },
                  ],
                };
            if (gets === 2) {
              assert.equal(endpoint.searchParams.get('query'), '前端');
              assert.equal(endpoint.searchParams.get('city'), '101020100');
              assert.match(input.headers.Referer, /\/web\/geek\/job\?/);
            }
            return {
              ok: () => true,
              headers: () => ({ 'content-type': 'application/json' }),
              json: async () => ({ code: 0, message: '', zpData }),
            };
          },
          storageState: async () => ({ cookies, origins: [] }),
          dispose: async () => {
            disposed++;
          },
        } as unknown as APIRequestContext;
      },
    );
    const client = createRecruitmentClient({
      home,
      platforms: [
        createBossPlatform({
          browser: async () => {
            throw new Error('HTTP search must not open a browser');
          },
        }),
      ],
    });
    const result = await client.search(
      { platform: 'boss' },
      {
        query: '前端',
        city: '上海',
        activeWithin: 'any',
        maxPages: 1,
        limit: 1,
      },
    );
    assert.equal(result.targets[0].title, '前端工程师');
    assert.equal(gets, 2);
    assert.equal(disposed, 2);
    const identity = await client.accounts.resolve('boss');
    await client.accounts.use(identity, async (account) => {
      const saved = await readBossHttpSession(account.directory);
      assert.equal(saved?.cookies[0].value, 'fabricated-refreshed');
      await assert.rejects(
        bossHttpGet(account.directory, 'https://external.example/api'),
        /不属于 BOSS/,
      );
    });
    assert.equal(gets, 2);
  }));

test('HTTP search stops at rejected identity without retrying, searching, or opening a browser', async (t) =>
  temporaryHome(async (home) => {
    const fixture = bossFixture('seeker');
    const client = createRecruitmentClient({
      home,
      platforms: [
        createBossPlatform({
          browser: (directory, action) =>
            fixture.browser(directory, async (context, page) => {
              await context.addCookies([
                { name: 'bst', value: 'fabricated-session', url: BOSS_ORIGIN },
              ]);
              return action(context, page);
            }),
        }),
      ],
    });
    await client.login({ platform: 'boss' });
    let gets = 0;
    t.mock.method(
      request,
      'newContext',
      async (options: Parameters<typeof request.newContext>[0]) =>
        ({
          get: async () => {
            gets++;
            return {
              ok: () => true,
              headers: () => ({ 'content-type': 'application/json' }),
              json: async () => ({ code: 37, message: '您的环境存在异常.', zpData: null }),
            };
          },
          storageState: async () => options!.storageState,
          dispose: async () => {},
        }) as unknown as APIRequestContext,
    );
    await assert.rejects(
      client.search({ platform: 'boss' }, { query: '前端', activeWithin: 'any' }),
      (error: unknown) => {
        assert.ok(error instanceof RecruitmentError);
        assert.equal(error.details?.endpoint, '/wapi/zpuser/wap/getUserInfo.json');
        assert.equal(error.details?.reason, 'environment-rejected');
        return true;
      },
    );
    assert.equal(gets, 1);
  }));
