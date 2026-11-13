import type { Platform } from '../core/platform.js';
import { createBossPlatform } from './boss/adapter.js';
import { createCompanySitePlatform } from './company-site/adapter.js';
import type { CompanySiteConfig } from './company-site/config.js';
import { createBrowserPool } from '../runtime/browser-pool.js';
import { bossBackgroundBrowser } from './boss/browser.js';

export function defaultPlatforms(sites: CompanySiteConfig[] = []): Platform[] {
  return [createBossPlatform(), ...sites.map((site) => createCompanySitePlatform(site))];
}

export function createDemoPlatforms(sites: CompanySiteConfig[] = []) {
  const browsers = createBrowserPool(bossBackgroundBrowser);
  return {
    platforms: [
      createBossPlatform({ sessionBrowser: browsers.run }),
      ...sites.map((site) => createCompanySitePlatform(site)),
    ],
    close: browsers.close,
  };
}
