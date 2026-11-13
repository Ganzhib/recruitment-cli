import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Page } from 'playwright';
import { z } from 'zod';
import { defineCapability, definePlatform, type Platform } from '../../core/platform.js';
import type { AccountProfile, Target } from '../../core/schemas.js';
import { withBrowser, navigate, type BrowserRunner } from '../../runtime/browser.js';
import { RecruitmentError } from '../../shared/errors.js';
import { companySiteSchema, type CompanySiteConfig } from './config.js';

interface CompanySession {
  profile: AccountProfile;
  page: Page;
}
export function createCompanySitePlatform(
  input: CompanySiteConfig,
  browser: BrowserRunner = withBrowser,
): Platform {
  const config = companySiteSchema.parse(input);
  const origins = new Set([new URL(config.listingUrl).origin, ...config.allowedOrigins]);
  const capability = defineCapability<CompanySession>();
  const checkedUrl = (value: string) => {
    const url = new URL(value, config.listingUrl);
    if (!origins.has(url.origin))
      throw new RecruitmentError('INPUT', '链接不在此公司官网配置的域名范围内。');
    url.hash = '';
    return url.href;
  };
  const profile: AccountProfile = { id: 'public', name: config.name, role: 'seeker' };
  return definePlatform<CompanySession>({
    id: config.id,
    name: config.name,
    authentication: 'public',
    capabilities: [
      capability({
        id: 'opportunity.search',
        description: '读取公司官网公开职位',
        effect: 'read',
        roles: ['seeker'],
        execute: async (session, input) => {
          z.strictObject({}).parse(input.options);
          const url = new URL(config.listingUrl);
          if (config.queryParameter) url.searchParams.set(config.queryParameter, input.query);
          if (config.pageParameter) url.searchParams.set(config.pageParameter, String(input.page));
          if (input.page > 1 && !config.pageParameter) return { targets: [], hasMore: false };
          await navigate(session.page, url.href);
          checkedUrl(session.page.url());
          await session.page.locator(config.selectors.card).first().waitFor();
          const targets: Target[] = [];
          for (const card of await session.page.locator(config.selectors.card).all()) {
            const title = (await card.locator(config.selectors.title).innerText()).trim();
            const href = await card.locator(config.selectors.link).getAttribute('href');
            if (!href) continue;
            const targetUrl = checkedUrl(href);
            const location = config.selectors.location
              ? (await card.locator(config.selectors.location).innerText()).trim()
              : '';
            const summary = (await card.innerText()).trim();
            if (
              !summary.toLocaleLowerCase().includes(input.query.toLocaleLowerCase()) ||
              (input.city && !location.includes(input.city))
            )
              continue;
            targets.push({
              id: targetUrl,
              kind: 'job',
              title,
              name: '',
              organization: config.name,
              location,
              summary,
              url: targetUrl,
              activity: { label: '', withinMinutes: null },
              contactState: 'unavailable',
              context: {},
            });
          }
          const hasMore = Boolean(
            config.pageParameter &&
            config.selectors.next &&
            (await session.page.locator(config.selectors.next).count()),
          );
          return { targets, hasMore };
        },
      }),
      capability({
        id: 'opportunity.detail',
        description: '读取公司官网职位详情',
        effect: 'read',
        roles: ['seeker'],
        execute: async (session, { target }) => {
          await navigate(session.page, checkedUrl(target.url));
          checkedUrl(session.page.url());
          const description = (
            await session.page.locator(config.selectors.description).innerText()
          ).trim();
          return { target, description };
        },
      }),
    ],
    login: async () => {
      throw new RecruitmentError('UNSUPPORTED', '公开职位读取无需登录。');
    },
    withSession: async (_account, action) => {
      const directory = await mkdtemp(join(tmpdir(), 'recruit-site-'));
      try {
        return await browser(directory, async (_context, page) => action({ profile, page }));
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    },
  });
}
