import type { Frame, Page, Request, Response } from 'playwright';
import { RecruitmentError } from '../../shared/errors.js';
import { bossPayload, BOSS_ORIGIN } from './session.js';
import { isBossLogin, isBossVerification, requestFields } from './protocol.js';

export function observeSearchResponse<T>(
  page: Page,
  path: string,
  timeoutMs = 20000,
  options: { waitForNavigation?: boolean } = {},
) {
  const expected = new URL(path, BOSS_ORIGIN);
  const requests = new Map<Request, boolean>();
  let committed = options.waitForNavigation === false;
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const result = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  const failure = (reason: string, message: string) =>
    new RecruitmentError(
      ['verification-required', 'login-required'].includes(reason) ? 'AUTH' : 'NETWORK',
      message,
      {
        endpoint: expected.pathname,
        reason,
      },
    );
  const onFrame = (frame: Frame) => {
    if (frame !== page.mainFrame()) return;
    if (isBossVerification(frame.url()))
      reject(
        failure(
          'verification-required',
          'BOSS 要求网页安全验证，后台搜索已停止。请在登录窗口完成验证后重试。',
        ),
      );
    else if (isBossLogin(frame.url()))
      reject(failure('login-required', 'BOSS 登录态已失效，请重新登录后再搜索。'));
    else committed = true;
  };
  const onRequest = (request: Request) => {
    if (!committed) return;
    const url = new URL(request.url());
    const fields = requestFields(request.url(), request.postData());
    if (url.origin === BOSS_ORIGIN && url.pathname === expected.pathname)
      requests.set(
        request,
        ['query', 'city', 'page'].every(
          (key) =>
            (fields.get(key) ?? (key === 'page' ? '1' : '')) === expected.searchParams.get(key),
        ),
      );
  };
  const onResponse = (response: Response) => {
    if (!requests.has(response.request())) return;
    const matches = requests.get(response.request());
    if (!response.ok() || !response.headers()['content-type']?.includes('json')) {
      if (matches) reject(failure('response-unavailable', 'BOSS 搜索未返回可用数据，未自动重试。'));
      return;
    }
    void response.json().then(
      (body) => {
        try {
          // A rejection applies to the session even if the website omitted or
          // changed the search fields. Successful unrelated results are ignored.
          if (body.code !== 0 || matches) {
            const data = bossPayload<T>(body, expected.pathname);
            if (matches) resolve(data);
          }
        } catch (error) {
          reject(error);
        }
      },
      () => {
        if (matches) reject(failure('response-unreadable', 'BOSS 搜索响应无法读取，未自动重试。'));
      },
    );
  };
  const onClosed = () => reject(failure('browser-closed', '后台搜索页面已关闭。'));
  const onFailed = (request: Request) => {
    if (requests.get(request)) reject(failure('request-failed', 'BOSS 搜索连接失败，未自动重试。'));
  };
  const timer = setTimeout(
    () => reject(failure('search-timeout', '等待 BOSS 网页搜索结果超时，未自动重试。')),
    timeoutMs,
  );
  page.on('framenavigated', onFrame);
  page.on('request', onRequest);
  page.on('response', onResponse);
  page.on('requestfailed', onFailed);
  page.on('close', onClosed);
  page.on('crash', onClosed);
  if (committed) onFrame(page.mainFrame());
  return {
    result,
    dispose() {
      clearTimeout(timer);
      page.off('framenavigated', onFrame);
      page.off('request', onRequest);
      page.off('response', onResponse);
      page.off('requestfailed', onFailed);
      page.off('close', onClosed);
      page.off('crash', onClosed);
      requests.clear();
    },
  };
}
