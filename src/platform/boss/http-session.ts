import { join } from 'node:path';
import { request, type BrowserContext, type Page } from 'playwright';
import { z } from 'zod';
import { profileSchema, type AccountProfile } from '../../core/schemas.js';
import { readJson, writeJson } from '../../runtime/storage.js';
import { RecruitmentError } from '../../shared/errors.js';
import { assertBossUrl, bossPayload, BOSS_ORIGIN } from './session.js';

const domains = ['www.zhipin.com', '.www.zhipin.com', 'zhipin.com', '.zhipin.com'];
const cookieSchema = z.object({
  name: z.string().min(1),
  value: z.string(),
  domain: z.string().refine((value) => domains.includes(value)),
  path: z.string().startsWith('/'),
  expires: z.number(),
  httpOnly: z.boolean(),
  secure: z.boolean(),
  sameSite: z.enum(['Strict', 'Lax', 'None']),
});
const httpSessionSchema = z.object({
  version: z.literal(1),
  profile: profileSchema,
  userAgent: z.string().min(1),
  cookies: z.array(cookieSchema),
});
type HttpSession = z.infer<typeof httpSessionSchema>;
const sessionPath = (directory: string) => join(directory, 'http-session.json');

export async function readBossHttpSession(directory: string): Promise<HttpSession | undefined> {
  const saved = await readJson(sessionPath(directory)).catch((error) => {
    if (error instanceof SyntaxError)
      throw new RecruitmentError('AUTH', '本地 BOSS 接口会话格式无效，请重新登录。');
    throw error;
  });
  if (saved === undefined) return undefined;
  const parsed = httpSessionSchema.safeParse(saved);
  if (!parsed.success)
    throw new RecruitmentError('AUTH', '本地 BOSS 接口会话格式无效，请重新登录。');
  return parsed.data;
}

export async function saveBossHttpSession(
  directory: string,
  context: BrowserContext,
  page: Page,
  profile: AccountProfile,
): Promise<void> {
  assertBossUrl(page.url());
  const cookies = (await context.cookies()).filter((cookie) => domains.includes(cookie.domain));
  if (!cookies.length) return;
  await writeJson(sessionPath(directory), {
    version: 1,
    profile,
    userAgent: await page.evaluate(() => navigator.userAgent),
    cookies,
  });
}

export async function bossHttpGet<T>(
  directory: string,
  path: string,
  referer = BOSS_ORIGIN + '/web/geek/job',
): Promise<T> {
  const url = new URL(assertBossUrl(new URL(path, BOSS_ORIGIN).href));
  assertBossUrl(referer);
  const saved = await readBossHttpSession(directory);
  if (!saved) throw new RecruitmentError('AUTH', '尚未保存 BOSS 接口会话，请先完成正常登录。');
  const cookies = saved.cookies.filter(
    (cookie) => cookie.expires === -1 || cookie.expires > Date.now() / 1000,
  );
  if (!cookies.length) throw new RecruitmentError('AUTH', 'BOSS 接口会话已过期，请重新登录。');
  const token = cookies.find(
    (cookie) =>
      cookie.name === 'bst' &&
      (url.pathname === cookie.path ||
        url.pathname.startsWith(cookie.path.endsWith('/') ? cookie.path : cookie.path + '/')),
  )?.value;
  const client = await request.newContext({
    storageState: { cookies, origins: [] },
    userAgent: saved.userAgent,
    timeout: 20_000,
  });
  try {
    const response = await client
      .get(url.href, {
        maxRedirects: 0,
        maxRetries: 0,
        headers: {
          Referer: referer,
          'X-Requested-With': 'XMLHttpRequest',
          ...(token ? { zp_token: token } : {}),
        },
      })
      .catch(() => {
        throw new RecruitmentError('NETWORK', 'BOSS 接口连接失败，未自动重试。', {
          endpoint: url.pathname,
        });
      });
    const refreshed = (await client.storageState()).cookies.filter((cookie) =>
      domains.includes(cookie.domain),
    );
    await writeJson(sessionPath(directory), { ...saved, cookies: refreshed });
    if (!response.ok() || !response.headers()['content-type']?.includes('json'))
      throw new RecruitmentError(
        'NETWORK',
        'BOSS 接口未返回可用 JSON，可能需要重新登录或网页验证。',
        {
          endpoint: url.pathname,
          httpStatus: response.status(),
        },
      );
    const payload = await response.json().catch(() => {
      throw new RecruitmentError('PLATFORM', 'BOSS 接口返回的 JSON 无法解析。', {
        endpoint: url.pathname,
      });
    });
    return bossPayload<T>(payload, url.pathname);
  } finally {
    await client.dispose();
  }
}

export async function identifyHttp(directory: string, saved: HttpSession): Promise<AccountProfile> {
  const user = await bossHttpGet<{ userId: string | number; name: string }>(
    directory,
    '/wapi/zpuser/wap/getUserInfo.json',
    BOSS_ORIGIN + (saved.profile.role === 'seeker' ? '/web/geek/job' : '/web/chat/index'),
  );
  if (String(user.userId) !== saved.profile.id)
    throw new RecruitmentError('AUTH', 'BOSS 接口会话账号与绑定身份不一致，请重新登录。');
  return { ...saved.profile, name: user.name };
}
