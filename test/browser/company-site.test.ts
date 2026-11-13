import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createCompanySitePlatform,
  createRecruitmentClient,
  RecruitmentError,
} from '../../src/index.js';
import { fixtureBrowser } from './fixtures.js';
import { temporaryHome } from '../helpers.js';

test('company sites expose actual read capabilities, search without login, and never pretend to send greetings', async () =>
  temporaryHome(async (home) => {
    const browser = fixtureBrowser(async (route) => {
      const url = new URL(route.request().url());
      if (url.hostname !== 'careers.example.test') return route.abort();
      return route.fulfill({
        contentType: 'text/html; charset=utf-8',
        body:
          url.pathname === '/jobs'
            ? '<article><h2>TypeScript 工程师</h2><a href="/jobs/1">查看</a><span>北京</span></article>'
            : '<main>负责 TypeScript 开发</main>',
      });
    });
    const platform = createCompanySitePlatform(
      {
        id: 'example',
        name: '示例公司',
        listingUrl: 'https://careers.example.test/jobs',
        selectors: {
          card: 'article',
          title: 'h2',
          link: 'a',
          location: 'span',
          description: 'main',
        },
      },
      browser,
    );
    const client = createRecruitmentClient({ home, platforms: [platform] });
    const result = await client.search(
      { platform: 'example' },
      { query: 'TypeScript', city: '北京', activeWithin: 'any' },
    );
    assert.equal(result.targets.length, 1);
    assert.equal(
      (await client.detail({ platform: 'example' }, result.targets[0])).description,
      '负责 TypeScript 开发',
    );
    assert.equal(platform.capabilities.has('contact.send'), false);
    await assert.rejects(
      client.prepare({ platform: 'example' }, { query: 'TypeScript' }),
      (error: unknown) => error instanceof RecruitmentError && error.code === 'UNSUPPORTED',
    );
  }));
