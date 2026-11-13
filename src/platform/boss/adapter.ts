import { join } from 'node:path';
import { z } from 'zod';
import { defineCapability, definePlatform, type Platform } from '../../core/platform.js';
import { roleSchema, searchInputSchema, type AccountProfile } from '../../core/schemas.js';
import { navigate, type BrowserRunner } from '../../runtime/browser.js';
import { bossBrowser } from './browser.js';
import { readJson, writeJson } from '../../runtime/storage.js';
import { RecruitmentError } from '../../shared/errors.js';
import {
  BOSS_LOGIN,
  waitForBossLogin,
  bossOptionsSchema,
  identify,
  listPositions,
  openHome,
  type BossSession,
} from './session.js';
import {
  readCandidateDetail,
  readJobDetail,
  searchCandidates,
  searchJobs,
  searchJobsUsing,
} from './discovery.js';
import {
  bossHttpGet,
  identifyHttp,
  readBossHttpSession,
  saveBossHttpSession,
} from './http-session.js';
import { prepareContact, sendContact } from './outreach.js';

interface BossAdapterSession {
  profile: AccountProfile;
  httpDirectory?: string;
  browser<T>(action: (session: BossSession) => Promise<T>): Promise<T>;
}
export interface BossPlatformOptions {
  browser?: BrowserRunner;
  loginTimeoutMs?: number;
}
export function createBossPlatform(options: BossPlatformOptions = {}): Platform {
  const browser = options.browser ?? bossBrowser;
  const capability = defineCapability<BossAdapterSession>();
  return definePlatform<BossAdapterSession>({
    id: 'boss',
    name: 'BOSS 直聘',
    authentication: 'required',
    capabilities: [
      capability({
        id: 'position.list',
        description: '读取招聘账号可关联的岗位',
        effect: 'read',
        roles: ['recruiter'],
        execute: (session) => session.browser(listPositions),
      }),
      capability({
        id: 'opportunity.search',
        inputSchema: searchInputSchema.extend({ options: bossOptionsSchema.default({}) }),
        description: '按当前身份搜索职位或推荐候选人',
        effect: 'read',
        roles: ['seeker', 'recruiter'],
        execute: (session, input) => {
          if (session.profile.role === 'seeker' && session.httpDirectory)
            return searchJobsUsing(
              (path, referer) => bossHttpGet(session.httpDirectory!, path, referer),
              input,
            );
          return session.browser((browserSession) =>
            session.profile.role === 'seeker'
              ? searchJobs(browserSession, input)
              : searchCandidates(browserSession, input),
          );
        },
      }),
      capability({
        id: 'opportunity.detail',
        description: '读取职位详情或候选人在线简历与活跃度',
        effect: 'read',
        roles: ['seeker', 'recruiter'],
        execute: (session, { target }) => {
          return session.browser((browserSession) =>
            session.profile.role === 'seeker'
              ? readJobDetail(browserSession, target)
              : readCandidateDetail(browserSession, target),
          );
        },
      }),
      capability({
        id: 'contact.prepare',
        description: '重新核对联系人、沟通状态与活跃度',
        effect: 'read',
        roles: ['seeker', 'recruiter'],
        execute: (session, { target }) =>
          session.browser((browserSession) => prepareContact(browserSession, target)),
      }),
      capability({
        id: 'contact.send',
        description: '点击平台原生沟通按钮并核对接口回执',
        effect: 'remote-write',
        roles: ['seeker', 'recruiter'],
        execute: (session, { target }) =>
          session.browser((browserSession) => sendContact(browserSession, target)),
      }),
    ],
    login: (directory) =>
      browser(directory, async (context, page) => {
        await navigate(page, BOSS_LOGIN);
        const authenticatedPage = await waitForBossLogin(context, options.loginTimeoutMs);
        const profile = await identify(authenticatedPage);
        await writeJson(join(directory, 'session.json'), { role: profile.role });
        await saveBossHttpSession(directory, context, authenticatedPage, profile);
        return profile;
      }),
    withSession: async (account, action) => {
      if (!account) throw new RecruitmentError('AUTH', 'BOSS 需要先扫码登录。');
      const http = await readBossHttpSession(account.directory);
      if (http) {
        const profile = await identifyHttp(account.directory, http);
        return action({
          profile,
          httpDirectory: account.directory,
          browser: (run) =>
            browser(account.directory, async (context, page) => {
              const current = await readBossHttpSession(account.directory);
              if (current) await context.addCookies(current.cookies);
              await openHome(page, profile.role);
              const actual = await identify(page);
              if (actual.id !== profile.id || actual.role !== profile.role)
                throw new RecruitmentError('AUTH', '浏览器账号或身份已变化，操作已停止。');
              const result = await run({ profile: actual, page });
              await saveBossHttpSession(account.directory, context, page, actual);
              return result;
            }),
        });
      }
      // Existing browser-only sessions are migrated after a normal identity check.
      return browser(account.directory, async (context, page) => {
        const saved = z
          .object({ role: roleSchema })
          .parse(await readJson(join(account.directory, 'session.json')));
        await openHome(page, saved.role);
        const profile = await identify(page);
        await saveBossHttpSession(account.directory, context, page, profile);
        return action({ profile, browser: (run) => run({ profile, page }) });
      });
    },
  });
}
