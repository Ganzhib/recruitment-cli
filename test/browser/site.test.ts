import test from 'node:test';
import assert from 'node:assert/strict';
import { siteBrowser as browser, siteUrl, screenshot } from './site-fixture.js';

test('product site supports role selection and desktop/mobile layouts without overflow', async () => {
  await browser('', async (_context, page) => {
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(siteUrl);
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
        await screenshot(page, 'landing', true);
      }
      await page.getByRole('tab', { name: /寻找人才/ }).click();
      assert.match(await page.locator('#role-title').innerText(), /值得聊/);
    }
  });
});
test('onboarding follows three audiences and the entire banner-navigation group stays sticky', async () => {
  await browser('', async (_context, page) => {
    await page.goto(siteUrl);
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

test('installation prompt leads to npm installation and the local demo', async () => {
  await browser('', async (_context, page) => {
    await page.goto(siteUrl);
    await page.locator('.hero-actions a').first().click();
    assert.match(page.url(), /#install$/);
    assert.match(await page.locator('#install-prompt').innerText(), /npm install -g @ganzhibin/);
    assert.match(await page.locator('#install-prompt').innerText(), /recruit demo/);
  });
});
