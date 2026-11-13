import test from 'node:test';
import assert from 'node:assert/strict';
import { waitForBossLogin, BOSS_LOGIN } from '../../src/platform/boss/session.js';
import { fixtureBrowser } from './fixtures.js';
import { chromium as compatibleChromium } from 'patchright';
import type { BrowserContext } from 'playwright';
import { createBrowserRunner } from '../../src/runtime/browser.js';
import { createRecruitmentClient, createBossPlatform } from '../../src/index.js';
import { temporaryHome } from '../helpers.js';

test('BOSS compatible driver identifies a fabricated account through the shared browser runner', async () =>
  temporaryHome(async (home) => {
    const browser = createBrowserRunner({
      async launchPersistentContext(directory, options) {
        const context = await compatibleChromium.launchPersistentContext(directory, {
          ...options,
          headless: true,
          serviceWorkers: 'block',
        });
        await context.route('**/*', async (route) => {
          const url = new URL(route.request().url());
          if (url.origin !== 'https://www.zhipin.com') return route.abort();
          if (url.pathname === '/web/user/')
            return route.fulfill({
              contentType: 'text/html',
              body: '<script>location.replace("/web/geek/job")</script>',
            });
          if (url.pathname === '/web/geek/job')
            return route.fulfill({
              contentType: 'text/html',
              body: '<script>document.cookie="__zp_stoken__=fabricated-search-session; path=/"</script><main>Fabricated home</main>',
            });
          if (url.pathname === '/wapi/zpuser/wap/getUserInfo.json')
            return route.fulfill({
              json: {
                code: 0,
                message: '',
                zpData: { userId: 'fixture-compatible', name: 'Fixture' },
              },
            });
          return route.abort();
        });
        return context as unknown as BrowserContext;
      },
    });
    const client = createRecruitmentClient({ home, platforms: [createBossPlatform({ browser })] });
    const account = await client.login({ platform: 'boss' });
    assert.equal(account.profile.id, 'fixture-compatible');
    assert.equal(account.profile.role, 'seeker');
  }));

test('BOSS restores a lost login page once and accepts the subsequent authenticated page', async () => {
  let visits = 0;
  const browser = fixtureBrowser(async (route) => {
    if (new URL(route.request().url()).pathname === '/web/user/') visits++;
    await route.fulfill({ contentType: 'text/html', body: '<main>Fabricated QR login</main>' });
  });
  await browser('', async (context, page) => {
    await page.goto(BOSS_LOGIN);
    const waiting = waitForBossLogin(context, 5000, { blankGraceMs: 50 });
    await page.goto('about:blank');
    await page.waitForURL(BOSS_LOGIN);
    assert.equal(visits, 2);
    await page.goto('https://www.zhipin.com/web/geek/job');
    assert.equal(await waiting, page);
  });
});

test('BOSS stops repeated blank navigation instead of holding the login lock until timeout', async () => {
  let visits = 0;
  const browser = fixtureBrowser(async (route) => {
    visits++;
    await route.fulfill({
      contentType: 'text/html',
      body: '<script>setTimeout(() => location.replace("about:blank"), 20)</script>',
    });
  });
  await browser('', async (context, page) => {
    await page.goto(BOSS_LOGIN);
    await assert.rejects(waitForBossLogin(context, 5000, { blankGraceMs: 50 }), /再次变为空白页/);
    assert.equal(visits, 2);
  });
});

test('BOSS keeps an active QR or verification page without reloading it', async () => {
  let visits = 0;
  const browser = fixtureBrowser(async (route) => {
    visits++;
    await route.fulfill({ contentType: 'text/html', body: '<main>Fabricated verification</main>' });
  });
  await browser('', async (context, page) => {
    await page.goto(BOSS_LOGIN);
    await assert.rejects(
      waitForBossLogin(context, 600, { blankGraceMs: 50 }),
      /等待 BOSS 登录超时/,
    );
    assert.equal(visits, 1);
  });
});
