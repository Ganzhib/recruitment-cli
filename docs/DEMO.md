# Chat Demo 与第三方 Agent

## 运行

安装 npm 包后，直接运行 `recruit demo`（自定义端口：`recruit demo --port 4319`）。页面、模型工具调用服务和 CLI 一起分发，不依赖源码。也可以在源码目录使用下面的命令。

```bash
npm ci
npm run demo
```

打开 `http://127.0.0.1:4318/`。入口命令是 `recruit demo`，HTTP 服务在 `src/runtime/demo-server.ts`，模型循环在 `src/services/demo-agent.ts`，页面位于 `site/demo/index.html`。`RECRUIT_DEMO_PORT` 可以指定其他本地端口。

GitHub Pages 展示带有明确标识的虚构示例，不调用真实招聘平台。本地 Demo 未连接模型时提示配置，不会生成预设回复。连接模型后，聊天请求由真实模型生成工具调用，服务复用包根导出的 client 执行，页面显示工具参数、对应 CLI 命令和返回回执。

`--options <options.json>` 在工具面板中表示同名 JSON 文件占位符，实际工具请求使用结构化 `options`。Demo 不启动 shell，也不执行模型生成的任意命令字符串。

## 连接模型

本地页面不会用预设回复代替未连接的 AI。点击「连接 Agent」，填入服务的 Base URL、模型 ID 和 API Key。服务需支持 Chat Completions 的 `tools` / `tool_calls` 协议。远程地址必须使用 HTTPS，本机服务可使用 `http://127.0.0.1` 或 `http://localhost`。

也可以使用环境变量：

```bash
export RECRUIT_AGENT_BASE_URL=https://your-provider.example/v1
export RECRUIT_AGENT_MODEL=your-model-id
# 在本机环境中设置 RECRUIT_AGENT_API_KEY，然后启动；不要把真实密钥提交到仓库。
npm run demo
```

配置仅保存在当前 Demo 服务内存中，GET 接口不返回 API Key，页面不使用 localStorage 保存密钥。连接远程模型后，对话与工具结果会发送到使用者配置的模型服务，请使用你允许处理这些数据的服务。当前默认使用 Chat Completions 以兼容第三方服务；具体模型需支持函数工具调用。

对话会话仅保留在本进程内存中。刷新页面或重新启动服务后会开始新对话。模型调用每轮最多 8 次，单次请求超时为 60 秒。没有配置模型或调用失败时，不会使用假回复冒充真实 AI。

## 自动打招呼

1. 配置 API Key、Base URL 与支持工具调用的模型。
2. 点击「扫码登录 BOSS」，在浏览器完成登录，AI 读取真实账号与身份。
3. 给出岗位、城市、活跃时间和数量；招聘者还需选定目标岗位。
4. 点击「准备自动打招呼指令」，核对输入框内容后发送。该按钮会开启本轮沟通权限；也可以手动勾选并输入指令。
5. AI 在同一轮准备计划、执行预制招呼语、返回回执。下一轮权限自动关闭。重复目标和结果不明的发送不会重发。

本地的 `--home` 与 `--sites` 同样作用于 Demo。GitHub Pages 为静态流程预览，真实 AI 和招聘平台操作在本机工作台运行。

## 工具 HTTP 接口

所有接口只监听 `127.0.0.1`，拒绝跨站 Origin 和非预期 Host。不要将本地 Demo 直接反向代理到公网。第三方业务可以在同一台机器上调用：

```bash
curl http://127.0.0.1:4318/api/tools

curl http://127.0.0.1:4318/api/tools/execute \
  -H 'Content-Type: application/json' \
  -d '{"name":"recruit_platforms","input":{}}'

curl http://127.0.0.1:4318/api/tools/execute \
  -H 'Content-Type: application/json' \
  -d '{"name":"recruit_search","input":{"platform":"boss","query":"TypeScript","city":"北京","activeWithin":"7d","limit":5}}'
```

工具包括平台发现、账号列表、扫码登录、身份校验、招聘岗位、搜索、联系计划、计划执行和历史回执。工具输入由 Zod schema 生成，校验在执行入口完成。

`POST /api/chat` 接收 `{message, platform, conversationId?, allowContact?}`，返回 SSE：

```text
data: {"type":"session","conversationId":"..."}

data: {"type":"tool.start","id":"...","name":"recruit_search","command":"recruit search ...","input":{}}

data: {"type":"tool.result","id":"...","name":"recruit_search","result":{},"durationMs":100}

data: {"type":"message","content":"..."}

data: {"type":"done"}
```

出错时返回 `tool.error` 或 `error` 事件。页面的结果卡片和活动面板来源于这些真实事件。示例工作流则始终带有 `simulated: true` 并在界面声明。

## 从包根导入

```typescript
import { createRecruitmentClient, createRecruitmentTools } from '@ganzhibin/recruitment-cli';

const client = createRecruitmentClient();
const tools = createRecruitmentTools(client, (event) => {
  // 将事件传给你自己的聊天界面。
  console.log(event.type, event.name);
});

const descriptions = tools.describe();
const functionTools = tools.functions();
const result = await tools.execute('recruit_search', {
  platform: 'boss',
  query: 'TypeScript',
  activeWithin: '7d',
  limit: 5,
});
```

`tools.functions()` 可直接用作兼容 Chat Completions 请求的 `tools`。工具执行复用现有账号锁、计划和发送记录。

发起真实沟通默认关闭。使用者在本轮打开「允许发起沟通」后，模型才可调用 `recruit_run_plan`；直接调用工具 HTTP 接口时需明确传入 `allowContact: true`。这项权限由调用方提供，不取自模型生成的工具参数。

```json
{
  "name": "recruit_run_plan",
  "input": { "planId": "事先生成的真实计划 UUID" },
  "allowContact": true
}
```

权限不会改变已有的发送去重和结果不明处理。运行中的平台批次仍使用 CLI 的执行语义；关闭网页不会撤销已经发出的消息。

## GitHub Pages

产品宣传页源文件在 `site/`，入口 `site/index.html`，Demo 为 `site/demo/index.html`。`npm run build:site` 将页面资源输出到 `site-dist/`，排除本地服务的 TypeScript 源文件；`.github/workflows/pages.yml` 发布构建结果到 GitHub Pages。需要将仓库 Pages 的 Source 设置为 GitHub Actions。

公开页面不包含账号、模型密钥或本地会话，也不会从线上页面直接调用本机 CLI。页面上的「连接 Agent」会说明如何启动本地服务。

主视觉由内置 imagegen 生成，文件为 `site/assets/connection-hero.png`。最终提示词：黑色石墨背景，单条精密光学玻璃带形成相连的上升双环，两端连接黑曜石与钛金属平面，冰蓝折射、克制高光，右侧构图，左侧留白，无文字、无 UI、无标志。宣传页中的界面预览是真实 HTML Demo。
