# 公共包 API

公共入口为 `src/index.ts`，构建后由 `package.json` 的 `exports["."]` 和 `types` 暴露。不使用内部文件路径接入。

## Client

```typescript
import { createRecruitmentClient } from '@ganzhibin/recruitment-cli';

const client = createRecruitmentClient({
  home: '/var/lib/my-app/recruitment',
});

await client.login({ platform: 'boss', account: 'main' });
const profile = await client.status({ platform: 'boss', account: 'main' });
const result = await client.search(
  { platform: 'boss' },
  { query: 'TypeScript', city: '北京', activeWithin: '7d', limit: 10 },
);
const detail = await client.detail({ platform: 'boss' }, result.targets[0]);

// 招聘者可以读取可关联岗位，并在 options.job 中指定目标。
const positions = await client.invoke({ platform: 'boss' }, 'position.list', {});

const plan = await client.prepare(
  { platform: 'boss' },
  { query: 'TypeScript', options: { job: positions[0].id } },
);
const execution = await client.run(plan.id, { intervalMs: 3000 });
const history = await client.history({ platform: 'boss' });
```

`prepare` 只读取并保存计划；`run` 执行发送；`greet` 将两者组合。业务需要审核时可以在二者之间设置自己的流程，CLI 不强制增加审核步骤。

`run` 返回 `OutreachResult`：`complete` 表示本次遍历完成，具体发送与跳过数量应读取 `operations`；`attention` 表示存在结果不明的写入，需要核实。不会因为异常而自动重新点击。

`invoke` 只接受读取能力，运行时也会拒绝写能力，JavaScript 调用者不能通过字符串绕过发送记录。

## 注册第三方适配器

公共导出包括 `definePlatform`、`defineCapability`、`PlatformRegistry`、`Platform`、`PlatformSession`、`SessionProfile`、`AccountScope`、`Capability` 和领域类型。输入输出的共享 schema 在 `core/schemas.ts` 定义，并从包根导出。

```typescript
import {
  createRecruitmentClient,
  defineCapability,
  definePlatform,
  type AccountProfile,
} from '@ganzhibin/recruitment-cli';

interface MySession {
  profile: AccountProfile;
}

const capability = defineCapability<MySession>();
const platform = definePlatform<MySession>({
  id: 'my-jobs',
  name: '我的招聘系统',
  authentication: 'public',
  capabilities: [
    capability({
      id: 'opportunity.search',
      description: '读取业务系统的职位',
      effect: 'read',
      roles: ['seeker'],
      execute: async () => ({ targets: [], hasMore: false }),
    }),
  ],
  login: async () => {
    throw new Error('公开职位无需登录');
  },
  withSession: async (_account, action) => {
    return action({ profile: { id: 'public', name: '公开职位', role: 'seeker' } });
  },
});

const client = createRecruitmentClient({ platforms: [platform] });
const jobs = await client.search(
  { platform: 'my-jobs' },
  { query: 'TypeScript', activeWithin: 'any' },
);
```

该示例只演示扩展协议，返回空职位列表。实际适配器需要实现自己的读取协议；有明细能力时注册 `opportunity.detail`；有联系能力时实现 `contact.prepare` 与 `contact.send`。`roles` 控制能力可用于哪些当前身份。

平台处理器要释放自己的网络连接、订阅和定时器；返回稳定 ID；使用自己确认过的活跃度证据。写能力只在取得明确平台回执后返回 `sent`，结果不明就抛出异常，由通用工作流保存结果。

## 官网配置

```typescript
import { createRecruitmentClient, type CompanySiteConfig } from '@ganzhibin/recruitment-cli';

const sites: CompanySiteConfig[] = [
  {
    id: 'example-careers',
    name: '示例公司',
    listingUrl: 'https://careers.example/jobs',
    selectors: {
      card: '.job-card',
      title: '.job-title',
      link: 'a.job-link',
      location: '.job-location',
      description: '.job-description',
    },
  },
];
const client = createRecruitmentClient({ sites });
```

`queryParameter`、`pageParameter` 可以映射站点查询参数，`selectors.next` 判断下一页是否存在。跨域 ATS 详情链接必须在 `allowedOrigins` 声明。未配置分页参数时只读取第一页，不虚构分页支持。

## 错误

已知业务错误使用 `RecruitmentError`，包括 `INPUT`、`AUTH`、`UNSUPPORTED`、`BUSY`、`NETWORK`、`PLATFORM`、`INDETERMINATE` 和 `NOT_FOUND`。CLI 中 JSON 成功在 stdout，失败在 stderr，结果不明退出码为 2，其余失败为 1。SDK 调用者可以通过错误类型进行业务处理。

平台认证与登录态存储在本地 `home`，不导出 Cookie 到返回值，不把凭证写入日志或测试夹具。
