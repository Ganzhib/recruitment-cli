import type { FrameLocator, Locator } from 'playwright';
import type { SearchInput, SearchPage, Target, TargetDetail } from '../../core/schemas.js';
import { RecruitmentError } from '../../shared/errors.js';
import { navigate } from '../../runtime/browser.js';
import { bossActivity } from './activity.js';
import { bossSelectors as selectors } from './selectors.js';
import {
  BOSS_ORIGIN,
  assertBossUrl,
  candidateContextSchema,
  type CandidateContext,
  bossGet,
  bossOptionsSchema,
  listPositions,
  type BossSession,
} from './session.js';

export async function text(locator: Locator): Promise<string> {
  return (await locator.count())
    ? (await locator.first().innerText()).replace(/\s+/g, ' ').trim()
    : '';
}
export async function candidateFrame(session: BossSession): Promise<FrameLocator> {
  await session.page.locator(selectors.recommendFrame).waitFor();
  return session.page.frameLocator(selectors.recommendFrame);
}
export async function selectPosition(
  session: BossSession,
  jobId: string,
): Promise<{ id: string; title: string }> {
  const positions = await listPositions(session);
  const matches = positions.filter((job) => job.id === jobId || job.title === jobId);
  if (matches.length !== 1)
    throw new RecruitmentError(
      'INPUT',
      '招聘端需要唯一岗位 ID 或名称，先运行 recruit positions --platform boss。',
    );
  const position = matches[0];
  if (positions.filter((job) => job.title === position.title).length !== 1)
    throw new RecruitmentError(
      'INPUT',
      '存在同名招聘岗位，当前页面无法可靠区分，请使用平台网页操作。',
    );
  const frame = await candidateFrame(session);
  const dropdown = frame.locator(selectors.jobDropdown);
  if ((await text(dropdown)).includes(position.title)) return position;
  await dropdown.click();
  const option = frame.locator(selectors.jobOptions).filter({ hasText: position.title });
  if ((await option.count()) !== 1)
    throw new RecruitmentError('INPUT', '页面中岗位名称不唯一，请在浏览器中确认目标岗位。');
  await option.click();
  await dropdown.filter({ hasText: position.title }).waitFor();
  return position;
}
export async function readCandidateCards(
  session: BossSession,
  position: { id: string; title: string },
): Promise<Target[]> {
  const frame = await candidateFrame(session);
  await frame.locator('.card-list, .geek-list, .empty-tips').first().waitFor();
  const cards = frame.locator(selectors.candidateCards);
  const targets: Target[] = [];
  for (const card of await cards.all()) {
    const inner = card.locator(selectors.candidateId);
    const candidateId =
      (await inner.first().getAttribute('data-geekid')) ??
      (await inner.first().getAttribute('data-geek'));
    // A missing stable identifier cannot safely own a write receipt.
    if (!candidateId) continue;
    const name = await text(card.locator(selectors.candidateName));
    const title = await text(card.locator(selectors.candidateTitle));
    const activeLabel = (await card.locator(selectors.candidateOnline).count())
      ? '在线'
      : await text(card.locator(selectors.candidateActivity));
    const button = card.locator(selectors.recruiterContact);
    const contactText = await text(button);
    const contacted =
      /继续沟通|已沟通/.test(contactText) ||
      (await card.locator('.chat-history .icon-chat-history').count()) > 0;
    let contactState: Target['contactState'] = 'unavailable';
    if (contacted) contactState = 'contacted';
    else if (
      contactText === '打招呼' &&
      (await button.isEnabled()) &&
      !/(disabled|forbid|ban)/i.test((await button.getAttribute('class')) ?? '')
    )
      contactState = 'available';
    targets.push({
      id: position.id + ':' + candidateId,
      kind: 'candidate',
      title,
      name,
      organization: '',
      location: await text(card.locator('.expect-wrap')),
      summary: await text(card),
      url: BOSS_ORIGIN + '/web/chat/recommend',
      activity: bossActivity(activeLabel),
      contactState,
      context: { jobId: position.id, jobName: position.title, candidateId },
    });
  }
  return targets;
}
export async function searchCandidates(
  session: BossSession,
  input: SearchInput,
): Promise<SearchPage> {
  const options = bossOptionsSchema.parse(input.options);
  if (!options.job)
    throw new RecruitmentError(
      'INPUT',
      '招聘端请通过 --options JSON 指定 {"job":"岗位 ID 或完整名称"}。',
    );
  await navigate(session.page, BOSS_ORIGIN + '/web/chat/recommend');
  const position = await selectPosition(session, options.job);
  const frame = await candidateFrame(session);
  for (let page = 1; page < input.page; page++) {
    const cards = frame.locator(selectors.candidateCards);
    const last = cards.last();
    if (!(await cards.count())) break;
    await last.scrollIntoViewIfNeeded();
    await frame.locator('body').press('End');
    await session.page.waitForTimeout(1000);
  }
  const targets = await readCandidateCards(session, position);
  const query = input.query.toLocaleLowerCase();
  return {
    targets: targets.filter(
      (target) =>
        target.summary.toLocaleLowerCase().includes(query) &&
        (!input.city || target.location.includes(input.city)),
    ),
    hasMore:
      (await frame.locator('.no-more, .no-more-tips, .empty-tips').count()) === 0 &&
      targets.length > 0,
  };
}
interface JobCard {
  encryptJobId: string;
  securityId: string;
  lid?: string;
  jobName: string;
  brandName: string;
  cityName: string;
  areaDistrict?: string;
  salaryDesc: string;
  jobExperience: string;
  jobDegree: string;
  skills?: string[];
}
export async function searchJobs(session: BossSession, input: SearchInput): Promise<SearchPage> {
  return searchJobsUsing(async (path, referer) => {
    await navigate(session.page, referer);
    return bossGet(session.page, path);
  }, input);
}
export async function searchJobsUsing(
  get: <T>(path: string, referer: string) => Promise<T>,
  input: SearchInput,
): Promise<SearchPage> {
  bossOptionsSchema.parse(input.options);
  const cities: Record<string, string> = {
    全国: '100010000',
    北京: '101010100',
    上海: '101020100',
    广州: '101280100',
    深圳: '101280600',
    杭州: '101210100',
    成都: '101270100',
    南京: '101190100',
    武汉: '101200100',
    苏州: '101190400',
    西安: '101110100',
    长沙: '101250100',
    天津: '101030100',
    重庆: '101040100',
  };
  const city = input.city ? (cities[input.city] ?? input.city) : cities.全国;
  if (!/^\d{9}$/.test(city))
    throw new RecruitmentError('INPUT', '此城市名称未内置，请使用 BOSS 的 9 位城市代码。');
  const parameters = new URLSearchParams({
    query: input.query,
    city,
    page: String(input.page),
    pageSize: '15',
  });
  const result = await get<{ jobList: JobCard[]; hasMore: boolean }>(
    '/wapi/zpgeek/search/joblist.json?' + parameters,
    BOSS_ORIGIN + '/web/geek/job?' + parameters,
  );
  return {
    hasMore: result.hasMore,
    targets: result.jobList.map((job) => ({
      id: job.encryptJobId,
      kind: 'job',
      title: job.jobName,
      name: '',
      organization: job.brandName,
      location: [job.cityName, job.areaDistrict].filter(Boolean).join(' '),
      summary: [
        job.jobName,
        job.salaryDesc,
        job.jobExperience,
        job.jobDegree,
        ...(job.skills ?? []),
      ].join(' '),
      url:
        BOSS_ORIGIN +
        '/job_detail/' +
        encodeURIComponent(job.encryptJobId) +
        '.html?' +
        new URLSearchParams({ securityId: job.securityId, lid: job.lid ?? '' }),
      activity: bossActivity(''),
      contactState: 'available',
      context: {},
    })),
  };
}
export async function candidateCard(
  session: BossSession,
  context: CandidateContext,
): Promise<Locator> {
  await navigate(session.page, BOSS_ORIGIN + '/web/chat/recommend');
  const position = await selectPosition(session, context.jobId);
  const frame = await candidateFrame(session);
  for (let attempt = 0; attempt < 10; attempt++) {
    const cards = frame.locator(selectors.candidateCards);
    for (const card of await cards.all()) {
      const inner = card.locator(selectors.candidateId).first();
      const candidateId =
        (await inner.getAttribute('data-geekid')) ?? (await inner.getAttribute('data-geek'));
      if (candidateId === context.candidateId) return card;
    }
    if (
      (await frame.locator('.no-more, .no-more-tips, .empty-tips').count()) ||
      !(await cards.count())
    )
      break;
    await cards.last().scrollIntoViewIfNeeded();
    await frame.locator('body').press('End');
    await session.page.waitForTimeout(1000);
  }
  throw new RecruitmentError(
    'NOT_FOUND',
    `候选人已不在岗位 ${position.title} 的当前推荐列表中，请重新筛选。`,
  );
}
export async function readJobDetail(session: BossSession, target: Target): Promise<TargetDetail> {
  await navigate(session.page, assertBossUrl(target.url));
  await session.page.locator(selectors.jobDescription).first().waitFor();
  const activity = bossActivity(await text(session.page.locator(selectors.bossActivity)));
  const buttonText = await text(session.page.locator(selectors.seekerContact));
  let contactState: Target['contactState'] = 'unavailable';
  if (/继续沟通/.test(buttonText)) contactState = 'contacted';
  else if (/立即沟通/.test(buttonText)) contactState = 'available';
  return {
    target: {
      ...target,
      activity,
      contactState,
    },
    description: await text(session.page.locator(selectors.jobDescription)),
  };
}
export async function readCandidateDetail(
  session: BossSession,
  target: Target,
): Promise<TargetDetail> {
  const context = candidateContextSchema.parse(target.context);
  const card = await candidateCard(session, context);
  const cards = await readCandidateCards(session, { id: context.jobId, title: context.jobName });
  const current = cards.find((candidate) => candidate.id === target.id);
  if (!current) throw new RecruitmentError('NOT_FOUND', '候选人卡片已变化，请重新筛选。');
  await card.locator(selectors.candidateId).first().click();
  const resume = session.page.frameLocator(selectors.resumeFrame);
  await resume.locator('body').waitFor();
  const label = await text(resume.locator('.active-time-desc, .active-status, .text-orange'));
  return {
    target: { ...current, activity: label ? bossActivity(label) : current.activity },
    description: await text(resume.locator('body')),
  };
}
