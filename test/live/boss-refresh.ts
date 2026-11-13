// Opt-in recovery using the existing account's normal browser profile.
// The user completes any platform verification; this script never solves it.
import { AccountRepository, recruitmentHome } from '../../src/runtime/accounts.js';
import { bossBrowser } from '../../src/platform/boss/browser.js';
import { BOSS_ORIGIN, identify } from '../../src/platform/boss/session.js';
import {
  bossHttpGet,
  saveBossHttpSession,
  waitForBossSearchReady,
} from '../../src/platform/boss/http-session.js';
import { searchJobsUsing } from '../../src/platform/boss/discovery.js';
import { RecruitmentError } from '../../src/shared/errors.js';

let stage = 'browser-verification';
try {
  const accounts = new AccountRepository(recruitmentHome());
  await accounts.use(await accounts.resolve('boss'), async (account) => {
    await bossBrowser(account.directory, async (context, initialPage) => {
      await initialPage.goto(
        BOSS_ORIGIN + '/web/geek/job?' + new URLSearchParams({ query: '前端', city: '101020100' }),
        { waitUntil: 'domcontentloaded', timeout: 20000 },
      );
      console.log(JSON.stringify({ stage, waitingForNormalPage: true, sentGreetings: 0 }));
      const ready = await waitForBossSearchReady(context);
      const profile = await identify(ready);
      if (profile.id !== account.identity.accountId)
        throw new RecruitmentError('AUTH', '验证后的账号与原绑定不一致，未覆盖会话。');
      await saveBossHttpSession(account.directory, context, ready, profile);
      stage = 'search';
      const result = await searchJobsUsing(
        (path, referer) => bossHttpGet(account.directory, path, referer),
        { query: '前端', city: '上海', page: 1, options: {} },
      );
      console.log(
        JSON.stringify({
          ok: true,
          jobsReturned: result.targets.length,
          jobs: result.targets.slice(0, 3).map((job) => ({
            title: job.title,
            company: job.organization,
            location: job.location,
            summary: job.summary,
          })),
          sentGreetings: 0,
        }),
      );
    });
  });
} catch (error) {
  console.log(
    JSON.stringify({
      ok: false,
      stage,
      error:
        error instanceof RecruitmentError
          ? { code: error.code, message: error.message, details: error.details }
          : { code: 'FAILED', message: '正常页面验证未完成，未输出凭据或底层请求。' },
      sentGreetings: 0,
    }),
  );
  process.exitCode = 1;
}
