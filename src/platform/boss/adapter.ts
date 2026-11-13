import { join } from 'node:path';
import { z } from 'zod';
import { defineCapability, definePlatform, type Platform } from '../../core/platform.js';
import { roleSchema } from '../../core/schemas.js';
import { withBrowser, navigate, type BrowserRunner } from '../../runtime/browser.js';
import { readJson, writeJson } from '../../runtime/storage.js';
import { RecruitmentError } from '../../shared/errors.js';
import { BOSS_LOGIN, identify, listPositions, openHome, type BossSession } from './session.js';
import { readCandidateDetail, readJobDetail, searchCandidates, searchJobs } from './discovery.js';
import { prepareContact, sendContact } from './outreach.js';

export interface BossPlatformOptions {
  browser?: BrowserRunner;
  loginTimeoutMs?: number;
}
export function createBossPlatform(options: BossPlatformOptions = {}): Platform {
  const browser = options.browser ?? withBrowser;
  const capability = defineCapability<BossSession>();
  return definePlatform<BossSession>({
    id: 'boss',
    name: 'BOSS 直聘',
    authentication: 'required',
    capabilities: [
      capability({
        id: 'position.list',
        description: '读取招聘账号可关联的岗位',
        effect: 'read',
        roles: ['recruiter'],
        execute: (session) => listPositions(session),
      }),
      capability({
        id: 'opportunity.search',
        description: '按当前身份搜索职位或推荐候选人',
        effect: 'read',
        roles: ['seeker', 'recruiter'],
        execute: (session, input) => {
          if (session.profile.role === 'seeker') return searchJobs(session, input);
          return searchCandidates(session, input);
        },
      }),
      capability({
        id: 'opportunity.detail',
        description: '读取职位详情或候选人在线简历与活跃度',
        effect: 'read',
        roles: ['seeker', 'recruiter'],
        execute: (session, { target }) => {
          if (session.profile.role === 'seeker') return readJobDetail(session, target);
          return readCandidateDetail(session, target);
        },
      }),
      capability({
        id: 'contact.prepare',
        description: '重新核对联系人、沟通状态与活跃度',
        effect: 'read',
        roles: ['seeker', 'recruiter'],
        execute: (session, { target }) => prepareContact(session, target),
      }),
      capability({
        id: 'contact.send',
        description: '点击平台原生沟通按钮并核对接口回执',
        effect: 'remote-write',
        roles: ['seeker', 'recruiter'],
        execute: (session, { target }) => sendContact(session, target),
      }),
    ],
    login: (directory) =>
      browser(directory, async (_context, page) => {
        await navigate(page, BOSS_LOGIN);
        await page.waitForURL(
          (url) =>
            url.origin === 'https://www.zhipin.com' &&
            /^\/web\/(geek|chat)(\/|$)/.test(url.pathname),
          { timeout: options.loginTimeoutMs ?? 180_000 },
        );
        const profile = await identify(page);
        await writeJson(join(directory, 'session.json'), { role: profile.role });
        return profile;
      }),
    withSession: (account, action) => {
      if (!account) throw new RecruitmentError('AUTH', 'BOSS 需要先扫码登录。');
      return browser(account.directory, async (_context, page) => {
        const saved = z
          .object({ role: roleSchema })
          .parse(await readJson(join(account.directory, 'session.json')));
        await openHome(page, saved.role);
        const profile = await identify(page);
        return action({ profile, page });
      });
    },
  });
}
