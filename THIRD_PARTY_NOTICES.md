# 参考项目与许可

- [Ganzhib/wemedia-cli](https://github.com/Ganzhib/wemedia-cli)，MIT：参考其 CLI、core、runtime、services、platform 分层、根入口导出、真实账号绑定、能力发现与持久化写回执的设计。本项目为招聘领域独立实现；`docs/assets/studio-banner.svg` 复用该项目的淘气工作室宣传横幅，采用 MIT 许可。
- [jackwener/boss-cli](https://github.com/jackwener/boss-cli)，Apache-2.0：参考其公开文档和平台接口路径，包含用户信息、职位搜索与可关联岗位读取。没有将其招聘端的资料查看命令当作实际发送能力。
- [joohw/boss-cli](https://github.com/joohw/boss-cli)，GPL-3.0：作为 BOSS 招聘页面结构、选择器名称与原生沟通流程的研究参考。没有复制、分发该项目的实现代码、打包产物或反检测逻辑。

以上项目不是本包的运行时依赖。本项目不复制开源项目的安全校验绕过、浏览器指纹修改或验证码处理逻辑。第三方 npm 依赖遵循各自发布包中的许可。

## Demo Markdown renderer

The Demo includes Marked (MIT, https://github.com/markedjs/marked) and DOMPurify (Apache-2.0 OR MPL-2.0, https://github.com/cure53/DOMPurify). Their browser modules and license files are copied from the installed dependencies into `dist/site/vendor/` and the static website build. No CDN is required.

The AI status canvas uses the thinking-orbs engine (MIT © Jakub Antalik, https://github.com/Jakubantalik/thinking-orbs). Its license is distributed in the vendor directory. The host follows the upstream 20/64 presets, reduced-motion, visibility pausing and DPR guidance.

## BOSS browser driver

BOSS uses Patchright (Apache-2.0, https://github.com/Kaliiiiiiiiii-Vinyzu/patchright-nodejs) as an npm runtime dependency for browser-driver compatibility. Other platforms use Playwright. Patchright's license is included in its published dependency package.
