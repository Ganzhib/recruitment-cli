import { chromium } from 'patchright';
import { createBrowserRunner, type BrowserEngine } from '../../runtime/browser.js';

// BOSS can redirect a debugger-instrumented page to about:blank. Use the
// compatible driver here; other platforms keep the standard Playwright runner.
// The driver implements the Playwright protocol but ships independent nominal
// handle types. Keep that type bridge confined to the browser-launch boundary.
export const bossBrowser = createBrowserRunner(chromium as unknown as BrowserEngine);
