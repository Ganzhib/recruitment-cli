# recruitment-cli

面向求职者、招聘者和第三方业务的多平台招聘 CLI。BOSS 直聘是首个平台；公司官网通过配置注册为独立的职位读取适配器。

命令行入口为 `recruit`。第三方业务从包根入口导入同一套 client、服务和类型，不需要另起 HTTP 服务。

## 快速开始

要求 Node.js ≥ 22.16，并已安装 Chrome 或 Chromium。

```bash
npm install
npm run build
node dist/recruit.js --help
node dist/recruit.js auth login boss
```

登录时会打开独立浏览器。扫码后，CLI 根据实际进入的求职端或招聘端识别当前身份，并读取平台用户 ID 完成账号绑定。无需指定 `--role`、提取 Cookie 或手动启动调试服务。登录窗口最长等待三分钟。

以下示例使用 `recruit`；源码环境可替换为 `node dist/recruit.js`。`npm link` 可在本地安装命令。该包尚未发布到 npm。

## 先筛选，再使用平台预制招呼语联系

“近期”以**对方最近活跃时间**为准：求职端看招聘者，招聘端看候选人。默认上限为 `7d`，支持 `online`、`30m`、`24h`、`7d` 和 `any`。平台未提供可识别的活跃度时，不猜测时间；该条目会以 `activity-unknown` 原因排除。

求职端：

```bash
recruit auth status boss
recruit search "TypeScript" --platform boss --city 北京 --active-within 7d -n 10

# 只保存筛选计划，不发送
recruit greet "TypeScript" --platform boss --city 北京 --active-within 7d -n 10 --dry-run

# 筛选后逐条使用 BOSS 原生按钮发起沟通
recruit greet "TypeScript" --platform boss --city 北京 --active-within 7d -n 10
```

招聘端：

```bash
recruit positions --platform boss
```

把目标岗位 ID 或唯一的完整名称写入 `boss-options.json`：

```json
{ "job": "从 positions 命令取得的岗位 ID" }
```

```bash
recruit search "TypeScript" --platform boss --options boss-options.json --active-within 3d
recruit greet "TypeScript" --platform boss --options boss-options.json --active-within 3d -n 10
```

招聘端首版读取**指定岗位的推荐候选人列表**，在卡片内容中匹配关键词和城市；不是全站候选人搜索。不自动购买权益、开通付费套餐或代解验证码。岗位列表来自平台的可关联岗位接口；未在列表中的岗位需要先在网页端确认。

发送使用账号在 BOSS 中当前配置的预制招呼语。CLI 不改招呼语、不生成额外文案。请先在 BOSS 中配置好你要使用的招呼语。成功回执表示对应目标的原生沟通接口返回成功；不代表对方已阅读、回复，也不保证平台没有更改默认话术策略。

## 计划、去重与回执

```bash
recruit plan create "TypeScript" --platform boss --active-within 7d
recruit plan get <plan-id>
recruit plan run <plan-id>
recruit history --platform boss
```

计划保存平台、真实账号、当前身份、筛选参数和目标快照。执行时重新读取活跃度与沟通状态；账号或身份变化会阻止执行。同一账号通过 CLI 或 client 并发操作时共用账号锁。

每次写入前先保存 `pending` 记录，成功后保存 `sent` 和接口证据。进程中断、请求超时或发送结果无法确认时，记录为 `indeterminate`，批次停止；再次执行会保留该结果，继续其他尚未处理的条目，**不会再次点击结果不明的目标**。需要在 BOSS 沟通记录中人工核实，目前不提供自动回查或清除记录后重发命令。

`--interval-ms` 默认 `3000`，最少 `1000`。它控制两次新发送之间的间隔。已经联系过或本地有发送记录的目标不会重复发送。

## 公司官网

首版支持通过 CSS 选择器读取公开职位列表和详情。配置示例见 [examples/company-sites.json](examples/company-sites.json)。

```bash
recruit --sites company-sites.json platform list
recruit --sites company-sites.json search "TypeScript" --platform example-careers --active-within any
```

示例中的 `.example` 域名是占位符，需要替换为实际公司官网和经过验证的选择器。官网若没有联系人活跃度，应使用 `--active-within any`。这些适配器只声明 `opportunity.search` 和 `opportunity.detail`，不提供打招呼、表单提交或投递。需要登录、验证码、多步骤申请或特殊 API 的官网应编写独立适配器。

## 第三方业务接入

包根入口公开 client、平台注册接口和类型。CLI 也使用同一套服务，详见 [docs/API.md](docs/API.md)。

```typescript
import { createRecruitmentClient } from '@ganzhibin/recruitment-cli';

const recruitment = createRecruitmentClient({ home: '/var/lib/my-app/recruitment' });

// 交互式首次登录；服务端业务可在有桌面环境的账号初始化流程中完成。
await recruitment.login({ platform: 'boss', account: 'main' });

const results = await recruitment.search(
  { platform: 'boss', account: 'main' },
  { query: 'TypeScript', city: '北京', activeWithin: '7d', limit: 10 },
);

const plan = await recruitment.prepare(
  { platform: 'boss', account: 'main' },
  { query: 'TypeScript', activeWithin: '7d', limit: 10 },
);
const receipt = await recruitment.run(plan.id);
```

`home` 中包含登录会话和求职、招聘记录，应使用当前业务专用目录。需要无人值守服务器或已有账号体系时，可以通过 `platforms` 注入适配器，复用自己的身份认证与传输方式。当前内置 BOSS 适配器需要可见桌面浏览器。

## 目录与开发

沿用 [Ganzhib/wemedia-cli](https://github.com/Ganzhib/wemedia-cli) 的职责划分：

```text
src/
  recruit.ts              # 可执行入口
  index.ts                # 公共包导出
  cli/                    # Commander 命令、输入输出、schema 发现
  core/                   # 平台与能力契约、共享领域类型
  runtime/                # 存储、账号绑定、锁、浏览器生命周期
  services/               # 筛选、联系计划、发送回执、统一 client
  platform/
    builtins.ts           # 内置平台组合入口
    boss/                 # BOSS 的会话、选择器、读取和原生发送
    company-site/         # 可配置的公开官网职位读取
```

```bash
npm run format:check
npm run check
npm test
npm run test:browser
npm run smoke
npm run check:package
```

浏览器测试会拦截所有请求，只使用虚构账号与页面，不访问真实招聘平台。已实现的功能与隔离测试通过，不等于真实账号验收通过；真实 BOSS 页面、当前接口和预制话术效果仍需登录后验收。验收步骤见 [docs/LIVE_ACCEPTANCE.md](docs/LIVE_ACCEPTANCE.md)。

默认数据目录为 `~/.config/recruitment-cli`，可通过 `--home`、`RECRUIT_HOME` 或 client 的 `home` 指定。`RECRUIT_BROWSER_PATH` 可指定 Chrome/Chromium 可执行文件。

参考项目及许可说明见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
