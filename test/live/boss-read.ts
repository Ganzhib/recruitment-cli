// Explicit, read-only live check. Excluded from the offline test globs.
import { AccountRepository, recruitmentHome } from '../../src/runtime/accounts.js';
import {
  bossHttpGet,
  identifyHttp,
  readBossHttpSession,
} from '../../src/platform/boss/http-session.js';
import { searchJobsUsing } from '../../src/platform/boss/discovery.js';
import { RecruitmentError } from '../../src/shared/errors.js';

let stage = 'session';
try {
  const accounts = new AccountRepository(recruitmentHome());
  const identity = await accounts.resolve('boss');
  await accounts.use(identity, async (account) => {
    const saved = await readBossHttpSession(account.directory);
    if (!saved)
      throw new RecruitmentError(
        'AUTH',
        '现有账号尚未生成接口会话；本次未发出网络请求，也未打开浏览器。',
      );
    if (saved.profile.role !== 'seeker')
      throw new RecruitmentError('AUTH', '当前绑定不是求职身份。');
    stage = 'identity';
    await identifyHttp(account.directory, saved);
    stage = 'search';
    const result = await searchJobsUsing(
      (path, referer) => bossHttpGet(account.directory, path, referer),
      { query: process.argv[2] || '前端', city: process.argv[3] || '上海', page: 1, options: {} },
    );
    console.log(
      JSON.stringify({
        ok: true,
        identityVerified: true,
        jobsReturned: result.targets.length,
        firstJob: result.targets[0]?.title ?? null,
        sentGreetings: 0,
      }),
    );
  });
} catch (error) {
  console.log(
    JSON.stringify({
      ok: false,
      stage,
      error:
        error instanceof RecruitmentError
          ? { code: error.code, message: error.message, details: error.details }
          : { code: 'FAILED', message: '只读验证失败，未输出底层请求或凭据。' },
      sentGreetings: 0,
    }),
  );
  process.exitCode = 1;
}
