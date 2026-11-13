import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium, errors, type BrowserContext, type Page } from 'playwright';
import { RecruitmentError } from '../shared/errors.js';

export type BrowserRunner = <T>(
  directory: string,
  action: (context: BrowserContext, page: Page) => Promise<T>,
) => Promise<T>;
export async function browserExecutable(): Promise<string> {
  const candidates = process.env.RECRUIT_BROWSER_PATH
    ? [process.env.RECRUIT_BROWSER_PATH]
    : [
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        '/usr/bin/google-chrome',
        '/usr/bin/chromium',
        '/usr/bin/chromium-browser',
        ...[process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA]
          .filter((directory): directory is string => Boolean(directory))
          .map((directory) => join(directory, 'Google', 'Chrome', 'Application', 'chrome.exe')),
        chromium.executablePath(),
      ];
  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  throw new RecruitmentError(
    'NOT_FOUND',
    '未找到 Chrome / Chromium。安装 Chrome，或设置 RECRUIT_BROWSER_PATH。',
  );
}
export type BrowserEngine = Pick<typeof chromium, 'launchPersistentContext'>;
export function createBrowserRunner(engine: BrowserEngine): BrowserRunner {
  return async (directory, action) => {
    const context = await engine.launchPersistentContext(join(directory, 'browser-profile'), {
      executablePath: await browserExecutable(),
      headless: false,
      chromiumSandbox: true,
      viewport: { width: 1440, height: 1000 },
    });
    try {
      const page =
        context.pages().find((candidate) => candidate.url() === 'about:blank') ??
        (await context.newPage());
      page.setDefaultTimeout(20_000);
      if (process.env.RECRUIT_BROWSER_DIAGNOSTICS === '1') {
        const session = await context.newCDPSession(page);
        const location = (value: string) => {
          const url = new URL(value);
          return url.origin === 'null' ? url.protocol + url.pathname : url.origin + url.pathname;
        };
        const report = (event: string, fields: Record<string, unknown> = {}) =>
          process.stderr.write(JSON.stringify({ browserEvent: event, ...fields }) + '\n');
        await session.send('Page.enable');
        session.on('Page.frameRequestedNavigation', (event) =>
          report('navigation-requested', { reason: event.reason, url: location(event.url) }),
        );
        page.on('framenavigated', (frame) => {
          if (frame === page.mainFrame()) report('navigated', { url: location(frame.url()) });
        });
        page.on('crash', () => report('crash'));
        page.on('close', () => report('closed'));
      }
      await page.bringToFront();
      return await action(context, page);
    } finally {
      await context.close();
    }
  };
}
export const withBrowser = createBrowserRunner(chromium);
export async function navigate(page: Page, url: string): Promise<void> {
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded' });
  } catch (error) {
    if (
      error instanceof errors.TimeoutError ||
      (error instanceof Error && (error.name === 'TimeoutError' || /net::ERR_/.test(error.message)))
    ) {
      throw new RecruitmentError('NETWORK', '页面加载失败，请检查网络后重新读取。');
    }
    throw error;
  }
}
