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
export const withBrowser: BrowserRunner = async (directory, action) => {
  const context = await chromium.launchPersistentContext(join(directory, 'browser-profile'), {
    executablePath: await browserExecutable(),
    headless: false,
    viewport: { width: 1440, height: 1000 },
  });
  try {
    const page = context.pages()[0] ?? (await context.newPage());
    page.setDefaultTimeout(20_000);
    return await action(context, page);
  } finally {
    await context.close();
  }
};
export async function navigate(page: Page, url: string): Promise<void> {
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded' });
  } catch (error) {
    if (
      error instanceof errors.TimeoutError ||
      (error instanceof Error && /net::ERR_/.test(error.message))
    ) {
      throw new RecruitmentError('NETWORK', '页面加载失败，请检查网络后重新读取。');
    }
    throw error;
  }
}
