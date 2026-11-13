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
  hasBossSearchToken,
  waitForBossSearchReady,
} from './http-session.js';
import { prepareContact, sendContact } from './outreach.js';

interface BossAdapterSession {
  profile: AccountProfile;
  httpDirectory?: string;
  browser<T>(action: (session: BossSession) => Promise<T>): Promise<T>;
}
export interface BossPlatformOptions {
  browser?: BrowserRunner;
  sessionBrowser?: BrowserRunner;
  loginTimeoutMs?: number;
}
export function createBossPlatform(options: BossPlatformOptions = {}): Platform {
  const browser = options.sessionBrowser ?? options.browser ?? bossBrowser;
  const loginBrowser = options.browser ?? bossBrowser;
  const verificationTimeout = options.sessionBrowser ? 15000 : options.loginTimeoutMs;
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
          if (
            session.profile.role === 'seeker' &&
            session.httpDirectory &&
            input.options.transport !== 'browser'
          )
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
      loginBrowser(directory, async (context, page) => {
        await navigate(page, BOSS_LOGIN);
        let authenticatedPage = await waitForBossLogin(context, options.loginTimeoutMs);
        if (new URL(authenticatedPage.url()).pathname.startsWith('/web/geek/'))
          authenticatedPage = await waitForBossSearchReady(context, options.loginTimeoutMs);
        const profile = await identify(authenticatedPage);
        await writeJson(join(directory, 'session.json'), { role: profile.role });
        await saveBossHttpSession(directory, context, authenticatedPage, profile);
        return profile;
      }),
    withSession: async (account, action) => {
      if (!account) throw new RecruitmentError('AUTH', 'BOSS 需要先扫码登录。');
      let http = await readBossHttpSession(account.directory);
      if (http?.profile.role === 'seeker' && !hasBossSearchToken(http.cookies)) {
        await browser(account.directory, async (context, page) => {
          await openHome(page, 'seeker');
          const ready = await waitForBossSearchReady(context, verificationTimeout);
          const actual = await identify(ready);
          if (actual.id !== account.identity.accountId)
            throw new RecruitmentError('AUTH', '浏览器账号已变化，未覆盖原会话。');
          await saveBossHttpSession(account.directory, context, ready, actual);
        });
        http = await readBossHttpSession(account.directory);
      }
      if (http) {
        const profile = await identifyHttp(account.directory, http);
        let ready: Promise<BossSession> | undefined;
        let lifetime: Promise<void> | undefined;
        let release: (() => void) | undefined;
        const getBrowser = () => {
          if (ready) return ready;
          let opened!: (session: BossSession) => void;
          let failed!: (error: unknown) => void;
          ready = new Promise<BossSession>((resolve, reject) => {
            opened = resolve;
            failed = reject;
          });
          const finished = new Promise<void>((resolve) => {
            release = resolve;
          });
          lifetime = browser(account.directory, async (context, page) => {
            const current = await readBossHttpSession(account.directory);
            if (current) await context.addCookies(current.cookies);
            await openHome(page, profile.role);
            const actual = await identify(page);
            if (actual.id !== profile.id || actual.role !== profile.role)
              throw new RecruitmentError('AUTH', '浏览器账号或身份已变化，操作已停止。');
            opened({ profile: actual, page });
            await finished;
            await saveBossHttpSession(account.directory, context, page, actual);
          });
          // Observe startup failure immediately; the lifetime is also awaited on cleanup.
          void lifetime.catch(failed);
          return ready;
        };
        try {
          return await action({
            profile,
            httpDirectory: account.directory,
            browser: async (run) => run(await getBrowser()),
          });
        } finally {
          release?.();
          await lifetime;
        }
      }
      // Existing browser-only sessions are migrated after a normal identity check.
      return browser(account.directory, async (context, page) => {
        const saved = z
          .object({ role: roleSchema })
          .parse(await readJson(join(account.directory, 'session.json')));
        await openHome(page, saved.role);
        const ready =
          saved.role === 'seeker'
            ? await waitForBossSearchReady(context, verificationTimeout)
            : page;
        const profile = await identify(ready);
        await saveBossHttpSession(account.directory, context, ready, profile);
        return action({ profile, browser: (run) => run({ profile, page: ready }) });
      });
    },
  });
}
