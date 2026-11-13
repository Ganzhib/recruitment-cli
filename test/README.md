# 测试目录

测试按行为归属组织，公共准备逻辑放在 fixture 中。模拟账号、模型和浏览器仅使用虚构数据。

| 范围                | 文件                                                   | 关注点                                         |
| ------------------- | ------------------------------------------------------ | ---------------------------------------------- |
| CLI、SDK 和业务服务 | 根目录其余 `*.test.ts`                                 | 参数、能力发现、账号绑定、计划和发送回执       |
| Demo HTTP 服务      | `demo-server.test.ts`                                  | 静态资源、配置、来源限制和密钥不回传           |
| AI 调用循环         | `demo-agent.test.ts`                                   | 工具调用、流式输出、发送授权和不确定结果不重发 |
| 官网                | `browser/site.test.ts`                                 | 安装提示、入口、导航和响应式布局               |
| Demo 界面           | `browser/demo.test.ts`                                 | Markdown 清理、对话布局、折叠记录和用户授权    |
| 平台浏览器适配      | `browser/boss.test.ts`、`browser/company-site.test.ts` | 登录、身份识别、发现和原生沟通回执             |

`helpers.ts` 提供临时目录与虚构平台；`fixtures/demo.ts` 统一管理模拟模型、HTTP 服务生命周期和对话请求。服务由测试结束钩子关闭，模拟模型处理错误会使测试失败。

`browser/fixtures.ts` 只负责隔离浏览器，所有请求必须被拦截，禁用 Service Worker。BOSS 页面协议位于 `browser/boss-fixture.ts`，官网资源与 Demo API 模拟位于 `browser/site-fixture.ts`。不要使用真实 cookies 或让浏览器测试访问真实招聘平台。

运行 `npm test` 检查服务和业务行为，运行 `npm run test:browser` 检查页面。截图统一写入被 Git 忽略的 `test/screenshots/`，不是需要提交的测试基准图。

提交前执行仓库要求的六项检查：`npm run format:check`、`npm run check`、`npm test`、`npm run test:browser`、`npm run smoke`、`npm run check:package`。`check:package` 在临时目录安装打包产物并验证 CLI、SDK 和 Demo，结束后清理临时目录。
