import type { Platform } from '../core/platform.js';
import { createBossPlatform } from './boss/adapter.js';
import { createCompanySitePlatform } from './company-site/adapter.js';
import type { CompanySiteConfig } from './company-site/config.js';

export function defaultPlatforms(sites: CompanySiteConfig[] = []): Platform[] {
  return [createBossPlatform(), ...sites.map((site) => createCompanySitePlatform(site))];
}
