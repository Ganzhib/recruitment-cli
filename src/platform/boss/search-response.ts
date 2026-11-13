import type { Frame, Page, Request, Response } from 'playwright';
import { RecruitmentError } from '../../shared/errors.js';
import { bossPayload, BOSS_ORIGIN } from './session.js';
import { isBossVerification, requestFields } from './protocol.js';

export function observeSearchResponse<T>(page: Page, path: string, timeoutMs = 20000) {
  const expected = new URL(path, BOSS_ORIGIN);
  const requests = new Set<Request>();
  let committed = false;
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const result = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  const failure = (reason: string, message: string) =>
    new RecruitmentError(reason === 'verification-required' ? 'AUTH' : 'NETWORK', message, {
      endpoint: expected.pathname,
      reason,
    });
  const onFrame = (frame: Frame) => {
    if (frame !== page.mainFrame()) return;
    if (isBossVerification(frame.url()))
      reject(
        failure(
          'verification-required',
          'BOSS 要求网页安全验证，后台搜索已停止。请在登录窗口完成验证后重试。',
        ),
      );
    else committed = true;
  };
  const onRequest = (request: Request) => {
    if (!committed) return;
    const url = new URL(request.url());
    const fields = requestFields(request.url(), request.postData());
    if (
      url.origin === BOSS_ORIGIN &&
      url.pathname === expected.pathname &&
      ['query', 'city', 'page'].every(
        (key) =>
          (fields.get(key) ?? (key === 'page' ? '1' : '')) === expected.searchParams.get(key),
      )
    )
      requests.add(request);
  };
  const onResponse = (response: Response) => {
    if (!requests.has(response.request())) return;
    if (!response.ok() || !response.headers()['content-type']?.includes('json')) {
      reject(failure('response-unavailable', 'BOSS 搜索未返回可用数据，未自动重试。'));
      return;
    }
    void response.json().then(
      (body) => {
        try {
          resolve(bossPayload<T>(body, expected.pathname));
        } catch (error) {
          reject(error);
        }
      },
      () => reject(failure('response-unreadable', 'BOSS 搜索响应无法读取，未自动重试。')),
    );
  };
  const onClosed = () => reject(failure('browser-closed', '后台搜索页面已关闭。'));
  const onFailed = (request: Request) => {
    if (requests.has(request)) reject(failure('request-failed', 'BOSS 搜索连接失败，未自动重试。'));
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
