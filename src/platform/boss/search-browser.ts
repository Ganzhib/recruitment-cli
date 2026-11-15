import type { Page } from 'playwright';
import { navigate } from '../../runtime/browser.js';
import { RecruitmentError } from '../../shared/errors.js';
import { observeSearchResponse } from './search-response.js';
import { bossSelectors as selectors } from './selectors.js';

interface SearchTab {
  page: Page;
  query: string;
  nextPage: number;
  completedAt: number;
}

// Keep search pagination alive while the primary page reads details or prepares
// a contact. The account lock serializes callers; no search request is replayed.
const tabs = new WeakMap<Page, SearchTab>();
const pageIntervalMs = 12000;

export async function browserJobSearch<T>(
  owner: Page,
  path: string,
  referer: string,
  pageNumber: number,
): Promise<T> {
  const url = new URL(referer);
  const query = JSON.stringify([url.searchParams.get('query'), url.searchParams.get('city')]);
  let tab = tabs.get(owner);
  if (
    pageNumber !== 1 &&
    (!tab || tab.page.isClosed() || tab.query !== query || tab.nextPage !== pageNumber)
  )
    throw new RecruitmentError('INPUT', '网页搜索需要从第一页开始，按同一关键词和城市顺序翻页。');
  if (!tab || tab.page.isClosed()) {
    const page = await owner.context().newPage();
    tab = { page, query, nextPage: 0, completedAt: 0 };
    tabs.set(owner, tab);
    const close = () => void page.close().catch(() => {});
    owner.once('close', close);
    page.once('close', () => {
      owner.off('close', close);
      tabs.delete(owner);
    });
  }
  const current = tab;
  current.nextPage = 0;
  try {
    const remaining = pageIntervalMs - (Date.now() - current.completedAt);
    if (remaining > 0) await current.page.waitForTimeout(remaining);
    const observation = observeSearchResponse<T>(current.page, path, 20000, {
      waitForNavigation: pageNumber === 1,
    });
    try {
      const [result] = await Promise.all([
        observation.result,
        pageNumber === 1 ? navigate(current.page, referer) : nextPage(current.page),
      ]);
      current.query = query;
      current.nextPage = pageNumber + 1;
      return result;
    } finally {
      observation.dispose();
    }
  } finally {
    current.completedAt = Date.now();
  }
}

async function nextPage(page: Page): Promise<void> {
  // Support the page's own pagination control and its infinite-scroll layout.
  // Neither path constructs an API request or changes the requested page number.
  const next = page.locator(selectors.jobNextPage).filter({ visible: true }).first();
  if (await next.count()) {
    if (
      !(await next.isEnabled()) ||
      (await next.getAttribute('aria-disabled')) === 'true' ||
      /disabled/.test((await next.getAttribute('class')) ?? '')
    )
      throw new RecruitmentError('PLATFORM', 'BOSS 网页下一页不可用，请重新读取搜索结果。', {
        reason: 'pagination-unavailable',
      });
    await next.click();
    return;
  }
  const last = page.locator(selectors.jobCards).last();
  await last.waitFor({ state: 'visible', timeout: 5000 });
  await last.scrollIntoViewIfNeeded();
  await page.locator('body').press('End');
}
