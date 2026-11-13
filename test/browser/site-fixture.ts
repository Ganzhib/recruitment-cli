import { mkdir, readFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import type { Page, Route } from 'playwright';
import { fixtureBrowser } from './fixtures.js';

export const siteUrl = 'https://pages.example.test/recruitment-cli/';
export const demoUrl = 'http://127.0.0.1:4318/demo/';
const contentTypes: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

async function siteAsset(route: Route, pathname: string) {
  const name = !pathname || pathname.endsWith('/') ? pathname + 'index.html' : pathname;
  return route.fulfill({
    body: await readFile(resolve('site', name)),
    contentType: contentTypes[extname(name)],
  });
}

export const siteBrowser = fixtureBrowser(async (route) => {
  const url = new URL(route.request().url());
  if (!url.href.startsWith(siteUrl)) return route.abort();
  return siteAsset(route, url.pathname.slice('/recruitment-cli/'.length));
});

export function demoFixture(
  options: {
    configured?: boolean;
    events?: Record<string, unknown>[];
    history?: { id: string; title: string; events: Record<string, unknown>[] };
  } = {},
) {
  const requests: { message: string; allowContact: boolean }[] = [];
  const browser = fixtureBrowser(async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== new URL(demoUrl).origin) return route.abort();
    if (url.pathname === '/api/config')
      return route.fulfill({
        json: { configured: options.configured ?? false, model: 'fixture-model' },
      });
    if (url.pathname === '/api/ui')
      return route.fulfill({
        json: { conversationId: options.history?.id ?? null, role: 'seeker', platform: 'boss' },
      });
    if (url.pathname === '/api/conversations')
      return route.fulfill({
        json: {
          conversations: options.history
            ? [{ id: options.history.id, title: options.history.title, interrupted: true }]
            : [],
        },
      });
    if (url.pathname.startsWith('/api/conversations/'))
      return route.fulfill({
        json: { id: options.history?.id, events: options.history?.events ?? [], running: false },
      });
    if (url.pathname === '/api/chat') {
      requests.push(route.request().postDataJSON());
      return route.fulfill({
        contentType: 'text/event-stream',
        body: (options.events ?? [])
          .map((event) => 'data: ' + JSON.stringify(event) + '\n\n')
          .join(''),
      });
    }
    if (url.pathname.startsWith('/api/')) return route.abort();
    return siteAsset(route, url.pathname.slice(1));
  });
  return { browser, requests };
}

export async function screenshot(page: Page, name: string, fullPage = false) {
  await mkdir('test/screenshots', { recursive: true });
  await page.screenshot({ path: `test/screenshots/${name}.png`, fullPage });
}
