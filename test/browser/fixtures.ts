import { chromium, type Route } from 'playwright';
import { browserExecutable, type BrowserRunner } from '../../src/runtime/browser.js';

export function fixtureBrowser(handler: (route: Route) => Promise<void>): BrowserRunner {
  return async (_directory, action) => {
    const browser = await chromium.launch({
      executablePath: await browserExecutable(),
      headless: true,
    });
    const context = await browser.newContext({ serviceWorkers: 'block' });
    // All requests are intercepted; fabricated sessions never reach a real recruitment platform.
    await context.route('**/*', handler);
    try {
      return await action(context, await context.newPage());
    } finally {
      await browser.close();
    }
  };
}
