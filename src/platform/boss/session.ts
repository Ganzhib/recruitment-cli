import type { BrowserContext, Page } from 'playwright';
import { z } from 'zod';
import type { AccountProfile, Role } from '../../core/schemas.js';
import { RecruitmentError } from '../../shared/errors.js';
import { navigate } from '../../runtime/browser.js';

export const BOSS_ORIGIN = 'https://www.zhipin.com';
export const BOSS_LOGIN = BOSS_ORIGIN + '/web/user/?ka=header-login';
export interface BossSession {
  profile: AccountProfile;
  page: Page;
}
export const candidateContextSchema = z.object({
  jobId: z.string().min(1),
  jobName: z.string().min(1),
  candidateId: z.string().min(1),
});
export type CandidateContext = z.infer<typeof candidateContextSchema>;
export const bossOptionsSchema = z.strictObject({ job: z.string().min(1).optional() });
interface BossEnvelope<T> {
  code: number;
  message: string;
  zpData: T | null;
}
export function roleFromUrl(value: string): Role | undefined {
  const url = new URL(value);
  if (url.origin !== BOSS_ORIGIN) return undefined;
  if (/^\/web\/geek(?:\/|$)/.test(url.pathname)) return 'seeker';
  if (/^\/web\/chat(?:\/|$)/.test(url.pathname)) return 'recruiter';
  return undefined;
}
export function assertBossUrl(value: string): string {
  const url = new URL(value);
  if (url.origin !== BOSS_ORIGIN) throw new RecruitmentError('INPUT', '目标不属于 BOSS 直聘。');
  return url.href;
}
export async function bossGet<T>(page: Page, path: string): Promise<T> {
  assertBossUrl(page.url());
  const endpoint = new URL(assertBossUrl(new URL(path, BOSS_ORIGIN).href)).pathname;
  const token = (await page.context().cookies(BOSS_ORIGIN)).find(
    (cookie) => cookie.name === 'bst',
  )?.value;
  const response = (await page.evaluate(
    async ({ path, token }) => {
      const result = await fetch(path, {
        credentials: 'include',
        headers: {
          'X-Requested-With': 'XMLHttpRequest',
          ...(token ? { zp_token: token } : {}),
        },
      });
      if (!result.ok) return { httpError: result.status, envelope: null };
      if (!result.headers.get('content-type')?.includes('json'))
        return { httpError: 0, envelope: null };
      return { httpError: 0, envelope: await result.json() };
    },
    { path, token },
  )) as { httpError: number; envelope: BossEnvelope<T> | null };
  if (response.httpError || !response.envelope)
    throw new RecruitmentError('NETWORK', '平台未返回可用的 JSON 响应。', {
      endpoint,
      ...(response.httpError ? { httpStatus: response.httpError } : {}),
    });
  return bossPayload(response.envelope, endpoint);
}
export function bossPayload<T>(envelope: BossEnvelope<T>, endpoint: string): T {
  if (envelope.code !== 0)
    throw new RecruitmentError(
      envelope.code === 37 ? 'AUTH' : 'PLATFORM',
      'BOSS 请求失败：' + envelope.message,
      {
        platformCode: envelope.code,
        endpoint,
        reason: /环境.*异常/.test(envelope.message)
          ? 'environment-rejected'
          : envelope.code === 37
            ? 'session-rejected'
            : [121, 122].includes(envelope.code)
              ? 'verification-required'
              : envelope.code === 9
                ? 'rate-limited'
                : 'platform-error',
      },
    );
  if (envelope.zpData === null) throw new RecruitmentError('PLATFORM', 'BOSS 成功响应缺少数据。');
  return envelope.zpData;
}
export async function identify(page: Page): Promise<AccountProfile> {
  const role = roleFromUrl(page.url());
  if (!role)
    throw new RecruitmentError('AUTH', '请完成扫码登录，并进入求职端或招聘端主页以识别当前身份。');
  const user = await bossGet<{ userId: number | string; name: string }>(
    page,
    '/wapi/zpuser/wap/getUserInfo.json',
  );
  if (!user.userId) throw new RecruitmentError('AUTH', '未取得登录用户 ID。');
  return { id: String(user.userId), name: user.name, role };
}
export async function assertCurrentAccount(session: BossSession): Promise<void> {
  assertBossUrl(session.page.url());
  const currentRole = roleFromUrl(session.page.url());
  if (currentRole && currentRole !== session.profile.role)
    throw new RecruitmentError('AUTH', '当前浏览器身份已切换，操作已停止。');
  const user = await bossGet<{ userId: number | string }>(
    session.page,
    '/wapi/zpuser/wap/getUserInfo.json',
  );
  if (String(user.userId) !== session.profile.id)
    throw new RecruitmentError('AUTH', '当前浏览器账号已切换，操作已停止。');
}
export async function openHome(page: Page, role: Role): Promise<void> {
  await navigate(page, BOSS_ORIGIN + (role === 'seeker' ? '/web/geek/job' : '/web/chat/index'));
}
export async function listPositions(session: BossSession) {
  const result = await bossGet<
    { encryptJobId: string; jobName: string; address?: string; salaryDesc?: string }[]
  >(session.page, '/wapi/zpjob/job/chatted/jobList');
  return result.map((job) => ({
    id: job.encryptJobId,
    title: job.jobName,
    location: job.address ?? '',
    salary: job.salaryDesc ?? '',
  }));
}

export async function waitForBossLogin(
  context: BrowserContext,
  timeoutMs = 180_000,
  options: { blankGraceMs?: number } = {},
): Promise<Page> {
  const deadline = Date.now() + timeoutMs;
  const blankGraceMs = options.blankGraceMs ?? 2000;
  let blankSince: number | undefined;
  let recovered = false;
  let closed = false;
  const onClose = () => {
    closed = true;
  };
  context.on('close', onClose);
  try {
    while (Date.now() < deadline) {
      if (closed)
        throw new RecruitmentError(
          'AUTH',
          '登录浏览器已关闭，扫码尚未完成。请重新打开登录窗口并保持到身份确认完成。',
        );
      const pages = context.pages().filter((candidate) => !candidate.isClosed());
      const page = pages.find((candidate) => roleFromUrl(candidate.url()));
      if (page) return page;
      // A short blank transition can occur during QR navigation. Recover only when
      // no real page remains, and only once; never reload an active QR/verification page.
      if (pages.every((candidate) => candidate.url() === 'about:blank')) {
        blankSince ??= Date.now();
        if (Date.now() - blankSince >= blankGraceMs) {
          if (recovered)
            throw new RecruitmentError(
              'AUTH',
              'BOSS 登录页再次变为空白页，已停止等待并释放本次登录任务。请检查浏览器或网络；本次未完成登录。',
            );
          recovered = true;
          const loginPage = pages[0] ?? (await context.newPage());
          await loginPage.bringToFront();
          await navigate(loginPage, BOSS_LOGIN);
          blankSince = undefined;
        }
      } else {
        blankSince = undefined;
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new RecruitmentError(
      'AUTH',
      '等待 BOSS 登录超时。请在 BOSS 页面扫码并进入求职端或招聘端主页；若平台要求验证，请先完成验证。',
    );
  } finally {
    context.off('close', onClose);
  }
}
