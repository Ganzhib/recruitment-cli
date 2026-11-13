import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { fixtureBrowser } from './fixtures.js';

const browser = fixtureBrowser(async (route) => {
  const url = new URL(route.request().url());
  if (url.hostname !== 'pages.example.test') return route.abort();
  let name = url.pathname.replace('/recruitment-cli/', '') || 'index.html';
  if (name.endsWith('/')) name += 'index.html';
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
    await page.goto('https://pages.example.test/recruitment-cli/demo/?role=recruiter');
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
      await page.goto('https://pages.example.test/recruitment-cli/demo/');
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

test('onboarding follows three audiences and the entire banner-navigation group stays sticky', async () => {
  await browser('', async (_context, page) => {
    await page.goto('https://pages.example.test/recruitment-cli/');
    assert.match(await page.locator('#audience-code').innerText(), /createRecruitmentClient/);
    await page.locator('#audience-agent').click();
    assert.match(await page.locator('#audience-description').innerText(), /WorkBuddy/);
    assert.match(await page.locator('#audience-code').innerText(), /先不发招呼/);
    await page.locator('#audience-terminal').click();
    assert.match(
      await page.locator('#audience-code').innerText(),
      /npm install -g @ganzhibin\/recruitment-cli/,
    );
    await page.locator('#audience-terminal').press('ArrowLeft');
    assert.equal(await page.locator('#audience-agent').getAttribute('aria-selected'), 'true');
    await page.locator('#agents').scrollIntoViewIfNeeded();
    assert.equal(
      await page.locator('.site-chrome').evaluate((element) => {
        const header = element.getBoundingClientRect();
        const banner = element.querySelector('.studio-banner')!.getBoundingClientRect();
        const navigation = element.querySelector('.site-header')!.getBoundingClientRect();
        return (
          header.top === 0 &&
          Math.abs(banner.bottom - navigation.top) < 1 &&
          banner.width === innerWidth
        );
      }),
      true,
    );
  });
});

test('installation prompt is prominent and local demo requires a model before chatting', async () => {
  await browser('', async (_context, page) => {
    await page.goto('https://pages.example.test/recruitment-cli/');
    await page.locator('.hero-actions a').first().click();
    assert.match(page.url(), /#install$/);
    assert.match(await page.locator('#install-prompt').innerText(), /npm install -g @ganzhibin/);
    assert.match(await page.locator('#install-prompt').innerText(), /recruit demo/);
  });
  const local = fixtureBrowser(async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname !== '127.0.0.1') return route.abort();
    if (url.pathname === '/api/config') return route.fulfill({ json: { configured: false } });
    const name = url.pathname === '/demo/' ? 'demo/index.html' : url.pathname.slice(1);
    return route.fulfill({
      body: await readFile(resolve('site', name)),
      contentType: name.endsWith('.html')
        ? 'text/html'
        : name.endsWith('.js')
          ? 'text/javascript'
          : 'text/css',
    });
  });
  await local('', async (_context, page) => {
    await page.goto('http://127.0.0.1:4318/demo/');
    await page.locator('#message-input').fill('帮我自动打招呼');
    await page.locator('#send-button').click();
    assert.equal(await page.locator('#settings-dialog').isVisible(), true);
    assert.equal(await page.locator('.tool-card').count(), 0);
    assert.equal(await page.locator('#messages').innerText(), '');
  });
});

test('live demo renders safe Markdown, follows stream states and keeps process details collapsed', async () => {
  const markdown = [
    '## 匹配结果',
    '',
    '**已找到 2 个岗位**，使用 `recruit` 查看。',
    '',
    '| 岗位 | 城市 |',
    '| --- | --- |',
    '| 前端 | 上海 |',
    '',
    '- TypeScript',
    '- React',
    '',
    '```js',
    'const greeting = "hello";',
    '```',
    '',
    '[文档](https://example.test/docs)',
    '<img src="https://attacker.example/pixel" onerror="window.markdownAttack=1">',
    '<script>window.markdownAttack=1</script>',
    '[危险链接](javascript:alert(1))',
  ].join('\n');
  const local = fixtureBrowser(async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname !== '127.0.0.1') return route.abort();
    if (url.pathname === '/api/config')
      return route.fulfill({ json: { configured: true, model: 'fixture-model' } });
    if (url.pathname === '/api/chat')
      return route.fulfill({
        contentType: 'text/event-stream',
        body: [
          { type: 'status', phase: 'thinking' },
          {
            type: 'tool.start',
            id: 'fixture-call',
            name: 'recruit_search',
            command: 'recruit search TypeScript',
            input: {},
          },
          {
            type: 'tool.result',
            id: 'fixture-call',
            name: 'recruit_search',
            result: { matched: 2 },
          },
          { type: 'status', phase: 'composing' },
          { type: 'message.delta', id: 'reply-1', delta: markdown.slice(0, 30) },
          { type: 'message.delta', id: 'reply-1', delta: markdown.slice(30) },
          { type: 'done' },
        ]
          .map((event) => 'data: ' + JSON.stringify(event) + '\n\n')
          .join(''),
      });
    const name = url.pathname === '/demo/' ? 'demo/index.html' : url.pathname.slice(1);
    return route.fulfill({
      body: await readFile(resolve('site', name)),
      contentType: name.endsWith('.html')
        ? 'text/html'
        : name.endsWith('.js')
          ? 'text/javascript'
          : 'text/css',
    });
  });
  await local('', async (_context, page) => {
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: 850 });
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.goto('http://127.0.0.1:4318/demo/');
      await page.waitForFunction(() =>
        document.querySelector('#mode-badge')?.textContent?.includes('fixture-model'),
      );
      assert.equal(await page.locator('#activity-panel').isVisible(), false);
      assert.equal(await page.locator('#allow-contact').isChecked(), true);
      await page.locator('#allow-contact').uncheck();
      await page.locator('#message-input').fill('查找岗位');
      await page.locator('#send-button').click();
      await page.waitForFunction(
        () => document.querySelector('#agent-status')?.getAttribute('data-phase') === 'done',
      );
      assert.equal(await page.locator('.markdown h2').innerText(), '匹配结果');
      assert.equal(await page.locator('.message-avatar, .message-label').count(), 0);
      assert.equal(
        await page.locator('.message.user').evaluate((row) => getComputedStyle(row).justifyContent),
        'flex-end',
      );
      assert.equal(await page.locator('.markdown table tbody tr').count(), 1);
      assert.equal(
        await page.locator('.markdown pre code').innerText(),
        'const greeting = "hello";\n',
      );
      assert.equal(
        await page
          .locator(
            '.markdown script, .markdown img, .markdown [onerror], .markdown a[href^="javascript:"]',
          )
          .count(),
        0,
      );
      assert.equal(
        await page.locator('.markdown a[href="https://example.test/docs"]').getAttribute('rel'),
        'noopener noreferrer',
      );
      assert.equal(await page.locator('#status-orb').getAttribute('data-state'), 'breathing');
      assert.equal(await page.locator('#allow-contact').isChecked(), false);
      assert.equal(await page.locator('.tool-inline').count(), 1);
      assert.equal(await page.locator('.execution-group').getAttribute('open'), null);
      assert.equal(await page.locator('.execution-steps').isVisible(), false);
      assert.match(await page.locator('.execution-group > summary').innerText(), /已完成筛选/);
      await page.locator('.execution-group > summary').click();
      assert.match(await page.locator('.tool-inline summary').innerText(), /已完成筛选/);
      await page.locator('.tool-inline summary').click();
      assert.equal(await page.locator('.tool-inline-detail').isVisible(), true);
      await page.locator('.tool-inline summary').click();
      await page.locator('.execution-group > summary').click();
      assert.equal(await page.locator('.execution-steps').isVisible(), false);
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        true,
      );
      if (width === 1280)
        await page.screenshot({ path: 'test-results/screenshots/demo-markdown.png' });
      await page.locator('#activity-toggle').click();
      assert.equal(await page.locator('#activity-panel').isVisible(), true);
      assert.equal(await page.locator('#activity-toggle').getAttribute('aria-expanded'), 'true');
      await page.locator('#activity-toggle').click();
      assert.equal(await page.locator('#activity-panel').isVisible(), false);
    }
  });
});
