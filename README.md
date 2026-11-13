[![你的 AI，又在等你派活？淘气工作室 · 给它找点新本事。打开工具箱 ↗](docs/assets/studio-banner.svg)](https://my.feishu.cn/wiki/Tj4ZwTpEUisrg3kojmbcnR9yn1I?create_from=create_doc_to_wiki)

# recruitment-cli · 求职与招聘助手

**recruitment-cli 是面向 AI 助手的求职与招聘工具。安装后使用 `recruit` 命令。**

把时间留给了解机会、认识人才，把反复筛选与点选交给 recruitment-cli。说清楚你想找的岗位，或正在招聘什么人，让 AI 帮你整理近期活跃的匹配结果、准备沟通计划，再按你的安排开始对话。

[看看产品官网](https://ganzhib.github.io/recruitment-cli/) · [开始使用](#开始使用) · [体验对话 Demo](https://ganzhib.github.io/recruitment-cli/demo/) · [淘气工作室工具箱 ↗](https://my.feishu.cn/wiki/Tj4ZwTpEUisrg3kojmbcnR9yn1I?create_from=create_doc_to_wiki)

免费开源 · 在你的电脑上运行 · 直接在终端使用，或搭配能操作本机的 AI 助手使用

## 选择你的使用方式

| 你想怎么用                                                     | 从这里开始                                                 | 下一步                                                                                      |
| -------------------------------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| 业务系统接入，像这个 Chat Demo 一样                            | 从包根导入 client 或工具接口，在自己的业务流程中调用       | [业务系统接入指南](docs/GETTING_STARTED.md#1-业务系统接入) · [Demo 源码](site/demo/demo.ts) |
| 交给 WorkBuddy、Trace、豆包、Codex、Claude Code 等第三方 Agent | 使用具备本机终端或工具调用能力的模式，把安装提示词交给助手 | [Agent 接入指南](docs/GETTING_STARTED.md#2-第三方-agent)                                    |
| 喜欢直接使用命令行                                             | 构建后扫码登录，用命令完成搜索、计划和执行                 | [终端使用指南](docs/GETTING_STARTED.md#3-命令行爱好者)                                      |

## recruitment-cli 能帮你做什么？

求职和招聘都有一些重复工作：翻找岗位、查看候选人、确认对方是否活跃、整理联系对象，再一条条发起沟通。recruitment-cli 把这些步骤接起来，让你把精力留给真正的了解与判断。

- **寻找机会，先有一个清楚的方向。** 围绕岗位关键词和城市找机会，优先整理近期活跃的招聘者。
- **寻找人才，先看岗位是否匹配。** 从指定岗位的推荐列表中，按岗位相关要求和活跃度整理候选人。
- **先准备计划，再开始沟通。** 结果整理清楚后，按你的安排使用平台当前配置的招呼语联系对方。
- **每一步，有结果可查。** 查看筛选参数、沟通计划和执行回执；重复执行时识别已处理目标，结果不明时先核实。
- **让现有 AI 多一项行动能力。** 可以让助手操作 `recruit`，也可以从包根导入业务能力或通过工具 HTTP 接口接入已有 Agent。

## 支持哪些场景？

| 场景                  | 可以帮你完成                                                       | 当前范围                                                         |
| --------------------- | ------------------------------------------------------------------ | ---------------------------------------------------------------- |
| BOSS 直聘 · 求职者    | 搜索职位、查看详情和招聘者活跃度、准备计划、使用平台预制招呼语沟通 | 扫码后自动识别当前身份；真实账号与实时页面效果仍需按验收文档确认 |
| BOSS 直聘 · 招聘者    | 读取可关联岗位、筛选推荐候选人、读取在线简历、准备与执行沟通计划   | 从指定岗位推荐列表筛选，当前不是全站候选人搜索                   |
| 公司招聘官网          | 根据站点配置读取公开职位列表与详情                                 | 只读职位发现，不提交投递表单                                     |
| AI 对话与第三方 Agent | 可视化工具调用、兼容模型工具调用接口、业务能力导出                 | 在线 Demo 是虚构示例，真实操作在本地连接                         |

平台能力、账号权限与页面变化仍由对应平台决定。具体边界见 [真实平台验收](docs/LIVE_ACCEPTANCE.md)。CLI 与本地 AI Demo 通过 npm 包一起安装。

## 试着这样对 AI 说

> 使用 recruitment-cli，帮我找上海的前端岗位，优先看最近 7 天活跃的招聘者。先整理 5 个值得进一步了解的机会，告诉我岗位信息和活跃状态，这次先不联系。

> 使用 recruitment-cli，我正在招聘前端工程师。先确认我的招聘者身份与目标岗位，再按 TypeScript 和相关项目经验整理近期活跃的候选人，给我看一份沟通计划。

> 按已经整理好的这份计划，使用我在 BOSS 里配置的招呼语发起沟通。完成后告诉我哪些成功、哪些跳过、哪些还需要核实，不重复联系已处理的目标。

## npm 安装与本地 AI Demo

npm 包名为 `@ganzhibin/recruitment-cli`，安装后的命令为 `recruit`。安装命令：

```bash
npm install -g @ganzhibin/recruitment-cli@latest
recruit --version
recruit demo
```

Demo 页面随 npm 包分发，不需要下载源码或安装开发依赖。浏览器打开输出的本机地址，填写模型服务地址、模型名称和 API Key，点击「扫码登录 BOSS」；说明岗位、城市与数量后，点击「准备自动打招呼指令」并发送。AI 会在本轮沟通权限开启时生成并执行计划，显示真实工具调用与回执。默认使用平台预制招呼语。

也可以用 `recruit --home <directory> --sites <sites.json> demo --port 4319` 指定数据目录、官网配置和端口。API Key 只在服务内存中保存。

## 从源码运行对话 Demo

```bash
npm ci
npm run demo
```

打开 `http://127.0.0.1:4318/`。连接支持工具调用的兼容模型接口后，即可使用真实 AI 工作流。公开官网另有明确标识的虚构流程预览。右侧展示真实工具调用、对应 CLI 命令、参数与回执。第三方 Agent 可以通过工具 HTTP 接口，或从包根导入 `createRecruitmentTools` 接入相同能力。Demo 默认允许自动打招呼，使用者可关闭开关进入只读模式，模型不能自行修改权限。

## 开始使用

### 让 AI 帮你安装与连接

把这段话交给能操作你本机的 AI 助手：

> 请帮我安装并配置 recruitment-cli（求职与招聘助手，命令为 recruit）。先读取 https://github.com/Ganzhib/recruitment-cli 的当前说明；检查 Node.js 22.16+ 与 Chrome/Chromium，然后运行 npm install -g @ganzhibin/recruitment-cli@latest，使用 recruit --version、recruit --help 和 recruit schema 核验版本和实际命令；运行 recruit demo，在本地页面配置模型服务地址、模型名称与 API Key。复用已有兼容环境。先确认我要使用的账号与场景，引导我扫码登录 BOSS，读取实际用户与当前身份，再根据我的岗位方向、城市和近期活跃要求准备筛选结果。这次只安装、登录和读取，不发招呼；之后按我的明确安排执行沟通计划。不要索取或展示 Cookie、密码、验证码。最后告诉我安装位置、当前账号身份、已验证的能力和未完成事项。

### 自行安装与登录

要求 Node.js ≥ 22.16，并已安装 Chrome 或 Chromium。

```bash
npm install -g @ganzhibin/recruitment-cli@latest
recruit --help
recruit auth login boss
recruit demo
```

登录时会打开独立浏览器。扫码后，CLI 根据实际进入的求职端或招聘端识别当前身份，并读取平台用户 ID 完成账号绑定。无需指定 `--role`、提取 Cookie 或手动启动调试服务。登录窗口最长等待三分钟。

以下示例使用 `recruit`；源码环境可替换为 `node dist/recruit.js`。`npm link` 可在本地安装命令。本地 Demo 可使用 `recruit demo` 启动。

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
