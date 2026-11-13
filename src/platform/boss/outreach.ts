import type { Page, Response } from 'playwright';
import type { ContactReceipt, PreparedContact, Target } from '../../core/schemas.js';
import { RecruitmentError } from '../../shared/errors.js';
import { assertCurrentAccount, type BossSession } from './session.js';
import { candidateCard, readCandidateCards, readJobDetail } from './discovery.js';
import { candidateContextSchema } from './session.js';
import { bossSelectors as selectors } from './selectors.js';

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
  const response = new Promise<ContactReceipt>((resolve, reject) => {
    timer = setTimeout(
      () =>
        reject(
          new RecruitmentError(
            'INDETERMINATE',
            '未获得打招呼接口结果，请在平台沟通记录中核实；不会自动重发。',
          ),
        ),
      timeoutMs,
    );
    onResponse = (response) => {
      const url = new URL(response.url());
      if (url.origin !== 'https://www.zhipin.com' || url.pathname !== endpoint) return;
      const parameters = new URLSearchParams(url.search);
      const body = response.request().postData();
      if (body) for (const [key, value] of new URLSearchParams(body)) parameters.set(key, value);
      if (Object.entries(expected).some(([key, value]) => parameters.get(key) !== value)) return;
      if (!response.ok()) {
        reject(new RecruitmentError('INDETERMINATE', '打招呼接口未返回成功的 HTTP 状态。'));
        return;
      }
      response.json().then(
        (body: { code: number; message: string }) => {
          if (body.code !== 0) {
            reject(
              new RecruitmentError('PLATFORM', '平台未确认发送成功：' + body.message, {
                platformCode: body.code,
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
        () => reject(new RecruitmentError('INDETERMINATE', '打招呼接口返回了无法读取的响应。')),
      );
    };
    page.on('response', onResponse);
  });
  try {
    // Both promises are observed: a failed click must also dispose the response watcher.
    const [receipt] = await Promise.all([response, click()]);
    return receipt;
  } finally {
    clearTimeout(timer!);
    page.off('response', onResponse!);
  }
}
export async function sendContact(session: BossSession, target: Target): Promise<ContactReceipt> {
  await assertCurrentAccount(session);
  if (target.kind !== (session.profile.role === 'seeker' ? 'job' : 'candidate'))
    throw new RecruitmentError('INPUT', '目标类型与当前身份不一致。');
  if (session.profile.role === 'seeker') {
    if (session.page.url() !== target.url)
      throw new RecruitmentError('INPUT', '职位页面已变化，请重新筛选。');
    const button = session.page.locator(selectors.seekerContact).filter({ hasText: /^立即沟通$/ });
    if (!(await button.count()))
      return {
        state: 'unavailable',
        evidence: { source: 'page', message: '页面已无立即沟通按钮，未点击。' },
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
