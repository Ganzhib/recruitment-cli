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

招聘者先用 `recruit positions --platform boss` 确认岗位，再通过 `--options` 指定岗位 ID 或完整名称。确认计划后可使用 `recruit plan run <plan-id>`；实际发送与未确认结果都会保留记录。

后续入口：[完整使用说明](../README.md) · [命令与类型](API.md)。
