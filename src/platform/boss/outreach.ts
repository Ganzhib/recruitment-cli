import type { Frame, Page, Request, Response } from 'playwright';
import type { ContactReceipt, PreparedContact, Target } from '../../core/schemas.js';
import { RecruitmentError } from '../../shared/errors.js';
import { assertCurrentAccount, type BossSession } from './session.js';
import { candidateCard, readCandidateCards, readJobDetail } from './discovery.js';
import { candidateContextSchema } from './session.js';
import { bossSelectors as selectors } from './selectors.js';
import { isBossVerification, requestFields } from './protocol.js';

export async function prepareContact(
  session: BossSession,
  target: Target,
): Promise<PreparedContact> {
  await assertCurrentAccount(session);
  if (session.profile.role === 'seeker') {
    const detail = await readJobDetail(session, target);
    return {
      target: detail.target,
      ready: detail.target.contactState === 'available',
      reason: detail.target.contactState,
    };
  }
  const context = candidateContextSchema.parse(target.context);
  await candidateCard(session, context);
  const targets = await readCandidateCards(session, {
    id: context.jobId,
    title: context.jobName,
  });
  const current = targets.find((candidate) => candidate.id === target.id);
  if (!current) throw new RecruitmentError('NOT_FOUND', '候选人卡片已变化，请重新筛选。');
  return {
    target: current,
    ready: current.contactState === 'available',
    reason: current.contactState,
  };
}

export async function observeGreeting(
  page: Page,
  endpoint: string,
  click: () => Promise<void>,
  timeoutMs = 15_000,
  expected: Record<string, string> = {},
): Promise<ContactReceipt> {
  let onResponse: (response: Response) => void;
  let timer: ReturnType<typeof setTimeout>;
  const requests = new Set<Request>();
  let onFrame: (frame: Frame) => void;
  let onClosed: () => void;
  const onRequest = (request: Request) => {
    const url = new URL(request.url());
    if (url.origin !== 'https://www.zhipin.com' || url.pathname !== endpoint) return;
    const parameters = requestFields(request.url(), request.postData());
    if (Object.entries(expected).every(([key, value]) => parameters.get(key) === value))
      requests.add(request);
  };
  const unknown = (reason: string, message: string, extra = {}) =>
    new RecruitmentError('INDETERMINATE', message, {
      endpoint,
      reason,
      requestObserved: requests.size > 0,
      ...extra,
    });
  const response = new Promise<ContactReceipt>((resolve, reject) => {
    timer = setTimeout(
      () =>
        reject(
          unknown(
            'receipt-timeout',
            '未获得打招呼接口结果，请在平台沟通记录中核实；不会自动重发。',
          ),
        ),
      timeoutMs,
    );
    onResponse = (response) => {
      if (!requests.has(response.request())) return;
      if (!response.ok()) {
        reject(
          unknown('receipt-http-error', '打招呼接口未返回成功的 HTTP 状态。', {
            httpStatus: response.status(),
          }),
        );
        return;
      }
      response.json().then(
        (body: { code: number; message: string }) => {
          if (body.code !== 0) {
            reject(
              new RecruitmentError('PLATFORM', '平台未确认发送成功：' + body.message, {
                platformCode: body.code,
                endpoint,
                reason: 'receipt-rejected',
                requestObserved: true,
              }),
            );
            return;
          }
          resolve({
            state: 'sent',
            evidence: {
              source: endpoint,
              message: '平台原生打招呼接口返回 code=0，使用账号当前预制招呼语。',
            },
          });
        },
        () => reject(unknown('receipt-unreadable', '打招呼接口返回了无法读取的响应。')),
      );
    };
    onFrame = (frame) => {
      if (frame === page.mainFrame() && isBossVerification(frame.url()))
        reject(
          unknown('verification-required', 'BOSS 要求安全验证，发送结果待核实，不会自动重发。'),
        );
    };
    onClosed = () =>
      reject(unknown('browser-closed', '沟通页面已关闭，发送结果待核实，不会自动重发。'));
    page.on('request', onRequest);
    page.on('response', onResponse);
    page.on('framenavigated', onFrame);
    page.on('close', onClosed);
    page.on('crash', onClosed);
  });
  try {
    // Both promises are observed: a failed click must also dispose the response watcher.
    const [receipt] = await Promise.all([response, click()]);
    return receipt;
  } finally {
    clearTimeout(timer!);
    page.off('response', onResponse!);
    page.off('request', onRequest);
    page.off('framenavigated', onFrame!);
    page.off('close', onClosed!);
    page.off('crash', onClosed!);
  }
}
export async function sendContact(session: BossSession, target: Target): Promise<ContactReceipt> {
  await assertCurrentAccount(session);
  if (target.kind !== (session.profile.role === 'seeker' ? 'job' : 'candidate'))
    throw new RecruitmentError('INPUT', '目标类型与当前身份不一致。');
  if (session.profile.role === 'seeker') {
    if (session.page.url() !== target.url)
      throw new RecruitmentError('INPUT', '职位页面已变化，请重新筛选。');
    const button = session.page.locator(selectors.seekerContact).filter({
      hasText: /^\s*立即沟通\s*$/,
      visible: true,
    });
    if ((await button.count()) !== 1)
      return {
        state: 'unavailable',
        evidence: { source: 'page', message: '页面没有唯一可见的立即沟通按钮，未点击。' },
      };
    const securityId = new URL(target.url).searchParams.get('securityId');
    if (!securityId) throw new RecruitmentError('INPUT', '职位缺少沟通上下文 securityId。');
    return observeGreeting(
      session.page,
      '/wapi/zpgeek/friend/add.json',
      () => button.click(),
      15_000,
      { securityId },
    );
  }
  // Reuse the prepared page so the activity check and click refer to the same card.
  const frame = session.page.frameLocator(selectors.recommendFrame);
  const context = candidateContextSchema.parse(target.context);
  const jobLabel = await frame.locator(selectors.jobDropdown).innerText();
  if (!jobLabel.includes(context.jobName))
    throw new RecruitmentError('INPUT', '当前招聘岗位已变化，请重新筛选。');
  const cards = frame.locator(selectors.candidateCards);
  for (const card of await cards.all()) {
    const inner = card.locator(selectors.candidateId).first();
    const candidateId =
      (await inner.getAttribute('data-geekid')) ?? (await inner.getAttribute('data-geek'));
    if (candidateId !== context.candidateId) continue;
    const button = card.locator(selectors.recruiterContact).filter({ hasText: /^打招呼$/ });
    if (!(await button.count()))
      return {
        state: 'unavailable',
        evidence: { source: 'page', message: '候选人已不允许发起新沟通，未点击。' },
      };
    return observeGreeting(session.page, '/wapi/zpjob/chat/start', () => button.click(), 15_000, {
      geekId: context.candidateId,
    });
  }
  throw new RecruitmentError('NOT_FOUND', '准备后的候选人卡片已失效，请重新筛选。');
}
