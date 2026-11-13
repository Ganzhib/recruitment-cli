import { chromium, type Route } from 'playwright';
import { browserExecutable, type BrowserRunner } from '../../src/runtime/browser.js';

export function fixtureBrowser(handler: (route: Route) => Promise<void>): BrowserRunner {
  return async (_directory, action) => {
    const browser = await chromium.launch({
      executablePath: await browserExecutable(),
      headless: true,
    });
    const context = await browser.newContext();
    // All requests are intercepted; fabricated sessions never reach a real recruitment platform.
    await context.route('**/*', handler);
    try {
      return await action(context, await context.newPage());
    } finally {
      await browser.close();
    }
  };
}
export function bossFixture(role: 'seeker' | 'recruiter') {
  const state = { sends: 0, userId: 'fixture-user', activity: '3日内活跃' };
  const browser = fixtureBrowser(async (route) => {
    const url = new URL(route.request().url());
    const json = (zpData: unknown) => route.fulfill({ json: { code: 0, message: '', zpData } });
    const html = (body: string) =>
      route.fulfill({
        contentType: 'text/html; charset=utf-8',
        body:
          '<!doctype html><html><head><meta charset="utf-8"></head><body>' +
          body +
          '</body></html>',
      });
    if (url.pathname === '/web/user/')
      return html(
        `<script>location.href='/web/${role === 'seeker' ? 'geek/job' : 'chat/index'}'</script>`,
      );
    if (url.pathname === '/wapi/zpuser/wap/getUserInfo.json')
      return json({ userId: state.userId, name: '虚构用户' });
    if (url.pathname === '/wapi/zpjob/job/chatted/jobList')
      return json([
        {
          encryptJobId: 'position-1',
          jobName: 'TypeScript 工程师',
          address: '北京',
          salaryDesc: '20-30K',
        },
      ]);
    if (url.pathname === '/wapi/zpgeek/search/joblist.json')
      return json({
        hasMore: false,
        jobList: [
          {
            encryptJobId: 'job-1',
            securityId: 'fabricated-id',
            jobName: 'TypeScript 工程师',
            brandName: '测试公司',
            cityName: '北京',
            salaryDesc: '20-30K',
            jobExperience: '3-5年',
            jobDegree: '本科',
          },
        ],
      });
    if (
      url.pathname === '/wapi/zpgeek/friend/add.json' ||
      url.pathname === '/wapi/zpjob/chat/start'
    ) {
      state.sends++;
      return json({});
    }
    if (url.pathname === '/job_detail/job-1.html')
      return html(
        `<h1>TypeScript 工程师</h1><div class="job-sec-text">负责 TypeScript 开发</div><span class="boss-active-time">${state.activity}</span><button class="btn-startchat" onclick="fetch('/wapi/zpgeek/friend/add.json?securityId=fabricated-id').then(()=>this.textContent='继续沟通')">立即沟通</button>`,
      );
    if (url.pathname === '/web/chat/recommend')
      return html('<iframe name="recommendFrame" src="/web/frame/recommend"></iframe>');
    if (url.pathname === '/web/frame/recommend')
      return html(
        `<div class="job-selecter-wrap"><div class="ui-dropmenu-label">TypeScript 工程师</div></div><div class="card-list"><article class="candidate-card-wrap"><div class="card-inner" data-geekid="geek-1"><div class="name-wrap"><span class="name">虚构候选人</span></div><div class="expect-wrap"><div class="content">北京 TypeScript 开发</div></div><span class="active-desc">${state.activity}</span></div><div class="button-chat-wrap"><button class="btn btn-greet" onclick="fetch('/wapi/zpjob/chat/start',{method:'POST',body:'geekId=geek-1&jobId=position-1'}).then(()=>this.textContent='继续沟通')">打招呼</button></div></article></div><div class="no-more">没有更多了</div>`,
      );
    if (url.pathname === '/web/geek/job' || url.pathname === '/web/chat/index')
      return html('<main>测试主页</main>');
    return route.abort();
  });
  return { browser, state };
}
