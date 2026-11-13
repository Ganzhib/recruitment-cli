import test from 'node:test';
import assert from 'node:assert/strict';
import {
  siteBrowser as browser,
  siteUrl,
  demoUrl,
  demoFixture,
  screenshot,
} from './site-fixture.js';

test('static demo declares simulated results, shows the workflow and offers local Agent setup', async () => {
  await browser('', async (_context, page) => {
    await page.goto(siteUrl + 'demo/?role=recruiter');
    assert.match(await page.locator('#context-role').innerText(), /招聘者示例/);
    await page.locator('[data-prompt]').last().click();
    await page.locator('.result-card').first().waitFor();
    assert.equal(await page.locator('.result-card').count(), 3);
    assert.equal(await page.locator('.tool-inline').count(), 3);
    assert.match(await page.locator('#messages').innerText(), /虚构示例/);
    await screenshot(page, 'demo');
    await page.locator('#settings-open').click();
    assert.equal(await page.locator('#agent-fields').isVisible(), false);
    assert.match(await page.locator('#remote-notice').innerText(), /npm ci/);
  });
});

test('long demo conversations scroll inside the pane and keep the composer visible, including embedded mode', async () => {
  await browser('', async (_context, page) => {
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: 700 });
      await page.goto(siteUrl + 'demo/');
      await page.emulateMedia({ reducedMotion: 'reduce' });
      assert.equal(await page.locator('#starter-prev').isDisabled(), true);
      await page.locator('#starter-next').click();
      await page.waitForFunction(() => document.querySelector('#starter-prompts')!.scrollLeft > 0);
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        true,
      );
      await page.locator('#starter-prev').click();
      await page.waitForFunction(() => document.querySelector('#starter-prompts')!.scrollLeft <= 1);
      await screenshot(page, 'demo-prompts-' + width);
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
    await page.goto(siteUrl);
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

test('local demo requires a model before chatting', async () => {
  const { browser: local } = demoFixture();
  await local('', async (_context, page) => {
    await page.goto(demoUrl);
    await page.locator('#message-input').fill('帮我自动打招呼');
    await page.locator('#send-button').click();
    assert.equal(await page.locator('#settings-dialog').isVisible(), true);
    assert.equal(await page.locator('.tool-inline').count(), 0);
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
  const { browser: local, requests } = demoFixture({
    configured: true,
    events: [
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
    ],
  });
  await local('', async (_context, page) => {
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: 850 });
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.goto(demoUrl);
      await page.waitForFunction(() =>
        document.querySelector('#mode-badge')?.textContent?.includes('fixture-model'),
      );
      assert.equal(await page.locator('#activity-panel, #activity-toggle').count(), 0);
      assert.equal(await page.locator('#allow-contact').isChecked(), width === 1280);
      await page.locator('#allow-contact').uncheck();
      assert.equal(
        await page
          .locator('#composer-shortcuts button')
          .evaluateAll(
            (buttons) =>
              new Set(
                buttons
                  .filter((button) => button.getClientRects().length)
                  .map((button) => Math.round(button.getBoundingClientRect().top)),
              ).size,
          ),
        1,
      );
      if (width === 390) {
        await page.locator('#shortcuts-next').click();
        await page.waitForFunction(
          () => document.querySelector('#composer-shortcuts')!.scrollLeft > 0,
        );
        await page.locator('#shortcuts-prev').click();
        await page.waitForFunction(
          () => document.querySelector('#composer-shortcuts')!.scrollLeft <= 1,
        );
      }
      const previousRequests = requests.length;
      await page.getByRole('button', { name: '查看回执', exact: true }).click();
      assert.match(await page.locator('#message-input').inputValue(), /已有的沟通回执/);
      assert.equal(requests.length, previousRequests);
      assert.equal(await page.locator('#allow-contact').isChecked(), false);
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
      assert.equal(requests.at(-1)?.allowContact, false);
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
      if (width === 1280) await screenshot(page, 'demo-markdown');
      await page.reload();
      await page.waitForFunction(
        () => !document.querySelector('#send-button')?.hasAttribute('disabled'),
      );
      assert.equal(await page.locator('#allow-contact').isChecked(), false);
    }
  });
});

test('local demo restores history without sending and keeps contact enabled by default', async () => {
  const { browser: local, requests } = demoFixture({
    configured: true,
    history: {
      id: 'd8111fb3-c7fe-48db-ab95-e4f01700b6b5',
      title: '上次的招聘需求，帮我整理上海最近活跃的前端工程师岗位，并比较职责、薪资和匹配理由',
      events: [
        {
          payload: {
            type: 'turn.started',
            message: '上次的招聘需求',
            platform: 'boss',
            allowContact: true,
          },
        },
        { payload: { type: 'message', message: { role: 'assistant', content: '**已整理计划**' } } },
        {
          payload: {
            type: 'tool',
            event: {
              type: 'tool.start',
              id: 'pending',
              name: 'recruit_run_plan',
              command: 'recruit plan run fixture',
              input: {},
            },
          },
        },
      ],
    },
  });
  await local('', async (_context, page) => {
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: 850 });
      await page.goto(demoUrl);
      await page.locator('.message.user').waitFor();
      await page.waitForFunction(
        () => document.querySelector('#agent-status-label')?.textContent === '上次执行中断',
      );
      assert.equal(await page.locator('.message.user').innerText(), '上次的招聘需求');
      assert.equal(await page.locator('.markdown strong').innerText(), '已整理计划');
      assert.match(await page.locator('.message.error').innerText(), /未自动重跑/);
      assert.equal(await page.locator('.tool-inline').getAttribute('data-state'), 'error');
      assert.equal(await page.locator('#allow-contact').isChecked(), true);
      assert.equal(requests.length, 0);
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        true,
      );
      if (width === 1280) await screenshot(page, 'demo-history');
      await page.reload();
      await page.locator('.message.user').waitFor();
      assert.equal(requests.length, 0);
      await page.locator('#history-open').click();
      await page.locator('#history-search').fill('不存在的会话');
      assert.equal(await page.locator('.history-item').count(), 0);
      assert.match(await page.locator('.history-empty').innerText(), /没有找到/);
      await page.locator('#history-search').fill('招聘需求');
      assert.equal(await page.locator('.history-item').count(), 1);
      assert.equal(
        await page
          .locator('.history-list')
          .evaluate((list) => list.scrollWidth <= list.clientWidth),
        true,
      );
      assert.equal(
        await page
          .locator('.history-list')
          .evaluate((list) => getComputedStyle(list).scrollbarWidth),
        'none',
      );
      await screenshot(page, 'demo-history-panel-' + width);
      assert.equal(await page.locator('#history-panel #new-chat').count(), 0);
      await page.locator('.sidebar #new-chat').click();
      assert.equal(await page.locator('#messages').innerText(), '');
      await page.locator('#history-open').click();
      await page.locator('.history-item').click();
      await page.locator('.message.user').waitFor();
      assert.equal(requests.length, 0);
    }
  });
});
