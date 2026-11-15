# 按你的使用场景开始

recruitment-cli 是安装在电脑或业务运行环境中的工具。官网帮助了解产品，在线 Demo 展示交互；使用真实账号时，需要在自己的运行环境完成安装与登录。

## 1. 业务系统接入

适合自有招聘系统、内部工具、对话界面和自动化流程。内置的 `recruit demo` 就是一个业务接入实例：它复用 client，把模型调用和工具事件接到自己的页面。

在业务项目里安装：

```bash
npm install @ganzhibin/recruitment-cli
```

从包根导入：

```typescript
import { createRecruitmentClient } from '@ganzhibin/recruitment-cli';

const recruit = createRecruitmentClient({ home: '/your-app/recruitment-data' });

// 初始化阶段，在具备桌面浏览器的运行环境中完成平台登录。
await recruit.login({ platform: 'boss', account: 'main' });

const result = await recruit.search(
  { platform: 'boss', account: 'main' },
  { query: '前端', activeWithin: '7d', limit: 5 },
);
```

已有 Agent 的业务系统可以导入 `createRecruitmentTools`，或运行本地 Demo 服务后调用工具 HTTP 接口。前端展示从工具事件与真实返回值生成，不需要解析终端文本。

后续入口：[业务 API](API.md) · [Demo 与工具 HTTP 接口](DEMO.md) · [Demo 服务源码](../site/demo/demo.ts)。

## 2. 第三方 Agent

适合 WorkBuddy、Trace、豆包、Codex、Claude Code 等助手的接入场景。具体使用方式取决于当前模式是否提供本机终端或工具调用能力。

**有本机终端能力：**让助手读取仓库说明、安装和构建，再使用 `recruit` 命令。可以复制以下提示词：

> 请帮我安装并配置 recruitment-cli（求职与招聘助手，命令为 recruit）。先读取 https://github.com/Ganzhib/recruitment-cli 的当前说明；检查 Node.js 22.16+ 与 Chrome/Chromium，运行 npm install -g @ganzhibin/recruitment-cli@latest，使用 recruit --help 和 recruit schema 核对命令，运行 recruit demo 在本地页面连接模型 API Key。引导我扫码登录，自动识别当前账号与求职者或招聘者身份。再按我给出的岗位、城市和近期活跃要求整理结果。这次只安装、登录和读取，先不发招呼。不要索取或展示账号凭据。

**有工具调用接口：**把 `createRecruitmentTools(client).functions()` 注册到你的工具调用链，或通过 `GET /api/tools` 发现工具，再调用 `POST /api/tools/execute`。实际沟通权限由使用者提供，不由模型参数授予。

可以先给助手一个明确的小任务：

> 帮我整理北京最近 7 天活跃的 TypeScript 岗位，先返回 5 个匹配结果和活跃状态，这次不联系。

后续入口：[Agent 与工具协议](DEMO.md) · [安装与登录](../README.md#开始使用)。

## 3. 命令行爱好者

在终端运行：

```bash
npm install -g @ganzhibin/recruitment-cli@latest

recruit --help
recruit auth login boss
recruit auth status boss

recruit search "前端" --platform boss --city 上海 --active-within 7d -n 5
recruit greet "前端" --platform boss --active-within 7d --dry-run
```

需要短命令时可以在源码目录运行 `npm link`，之后使用 `recruit`。`--json` 输出便于脚本处理；`schema` 和 `platform list` 用于发现实际命令和平台能力。

正常登录后，BOSS 会话自动保存在本机账号目录。求职端岗位搜索默认使用浏览器，读取正常搜索页面自己发出的响应，不额外构造搜索请求。搜索使用独立标签页，读取详情不会破坏翻页状态；后续页通过网页按钮或滚动加载，相邻搜索至少间隔 12 秒。身份读取仍使用本地保存的 HTTP 会话，接口更新的会话信息会写回本地。旧的浏览器会话在下次正常身份校验成功后自动补存。

最小只读搜索可运行 `recruit --json search "前端" --platform boss --city 上海 --active-within any --max-pages 1 -n 1`。`any` 不要求逐个读取岗位详情，适合先确认查询是否正常。环境异常、请求频繁、会话失效或验证要求会停止本次请求，不会自动重试或切换通道；请按提示在登录窗口完成验证。离线测试通过不代表当前账号已通过 BOSS 实站验证。

确实需要原有 HTTP 列表通道时，将 `{"transport":"http"}` 保存到 `boss-http.json`，通过 `--options boss-http.json` 显式选择。`--options` 接受 JSON 文件路径；网页模式也可在文件中指定 `{"transport":"browser"}`。这两种模式都不能保证解除平台风控，不生成验证凭证，也不自动处理验证码。

招聘者先用 `recruit positions --platform boss` 确认岗位，再通过 `--options` 指定岗位 ID 或完整名称。确认计划后可使用 `recruit plan run <plan-id>`；实际发送与未确认结果都会保留记录。

后续入口：[完整使用说明](../README.md) · [命令与类型](API.md)。
