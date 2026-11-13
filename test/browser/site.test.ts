import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { fixtureBrowser } from './fixtures.js';

const browser = fixtureBrowser(async (route) => {
  const url = new URL(route.request().url());
  if (url.hostname !== 'pages.example.test') return route.abort();
  const name = url.pathname.replace('/recruitment-cli/', '') || 'index.html';
  const content = await readFile(resolve('site', name));
  const contentType = (
    {
      '.html': 'text/html; charset=utf-8',
      '.css': 'text/css',
      '.js': 'text/javascript',
      '.png': 'image/png',
      '.svg': 'image/svg+xml',
    } as Record<string, string>
  )[extname(name)];
  return route.fulfill({ contentType, body: content });
});
test('product site supports role selection and desktop/mobile layouts without overflow', async () => {
  await browser('', async (_context, page) => {
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('https://pages.example.test/recruitment-cli/');
      assert.equal(
        await page
          .locator('.hero-sculpture')
          .evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0),
        true,
      );
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        true,
      );
      if (width === 1280) {
        await mkdir('test-results/screenshots', { recursive: true });
        await page.screenshot({ path: 'test-results/screenshots/landing.png', fullPage: true });
      }
      await page.getByRole('tab', { name: /寻找人才/ }).click();
      assert.match(await page.locator('#role-title').innerText(), /值得聊/);
    }
  });
});
test('static demo declares simulated results, shows the workflow and offers local Agent setup', async () => {
  await browser('', async (_context, page) => {
    await page.goto('https://pages.example.test/recruitment-cli/demo.html?role=recruiter');
    assert.match(await page.locator('#context-role').innerText(), /招聘者示例/);
    await page.locator('[data-prompt]').last().click();
    await page.locator('.result-card').first().waitFor();
    assert.equal(await page.locator('.result-card').count(), 3);
    assert.equal(await page.locator('.tool-card').count(), 3);
    assert.match(await page.locator('#messages').innerText(), /虚构示例/);
    await mkdir('test-results/screenshots', { recursive: true });
    await page.screenshot({ path: 'test-results/screenshots/demo.png' });
    await page.locator('#settings-open').click();
    assert.equal(await page.locator('#agent-fields').isVisible(), false);
    assert.match(await page.locator('#remote-notice').innerText(), /npm ci/);
  });
});

test('long demo conversations scroll inside the pane and keep the composer visible, including embedded mode', async () => {
  await browser('', async (_context, page) => {
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: 700 });
      await page.goto('https://pages.example.test/recruitment-cli/demo.html');
      for (let turn = 0; turn < 3; turn++) {
        await page.locator('#message-input').fill('再整理一组近期活跃的机会');
        await page.locator('#send-button').click();
        await page.waitForFunction(
          () => !(document.querySelector('#send-button') as HTMLButtonElement).disabled,
        );
      }
      assert.equal(
        await page.evaluate(() => {
          const pane = document.querySelector('#chat-scroll')!;
          const composer = document.querySelector('#chat-form')!.getBoundingClientRect();
          return (
            pane.scrollHeight > pane.clientHeight &&
            composer.bottom <= innerHeight &&
            document.documentElement.scrollHeight <= innerHeight
          );
        }),
        true,
      );
    }
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('https://pages.example.test/recruitment-cli/');
    const frame = page.frameLocator('iframe');
    await frame.locator('[data-prompt]').last().click();
    await frame.locator('.result-card').first().waitFor();
    assert.equal(
      await frame
        .locator('#chat-form')
        .evaluate((element) => element.getBoundingClientRect().bottom <= window.innerHeight),
      true,
    );
  });
});
