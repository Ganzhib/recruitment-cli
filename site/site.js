const scenes = {
  seeker: {
    number: '01 / FOR JOB SEEKERS',
    title: '让每次投向未来的目光，\n更有方向。',
    description:
      '从你期待的岗位和城市出发，把最近活跃、值得进一步了解的机会整理出来。少一点来回切换，把精力留给了解团队和表达自己。',
    benefits: ['围绕你的岗位方向寻找机会', '优先关注近期活跃的招聘者', '看过整理结果，再开始沟通'],
    link: '体验求职者场景',
    label: '你的下一步，不必从一片空白开始。',
    tags: ['前端开发', '上海', '近期活跃'],
    match: '值得进一步了解的机会',
    detail: '岗位方向、城市与活跃状态，在开始对话前先看清楚。',
  },
  recruiter: {
    number: '02 / FOR RECRUITERS',
    title: '把更多时间，\n留给真正值得聊的人。',
    description:
      '围绕正在招聘的岗位，整理方向匹配、近期活跃的候选人。把反复翻找与重复点选交给助手，让你专注理解经历、判断匹配和建立联系。',
    benefits: [
      '围绕指定岗位整理推荐候选人',
      '按岗位相关要求与活跃度筛选',
      '使用现有招呼语，按计划发起沟通',
    ],
    link: '体验招聘者场景',
    label: '从招聘需求，到清楚的候选人计划。',
    tags: ['前端岗位', '相关技能', '近期活跃'],
    match: '值得进一步了解的候选人',
    detail: '相关经验、技能方向与活跃状态，让开始沟通更有依据。',
  },
};
document.querySelectorAll('[data-role]').forEach((button) =>
  button.addEventListener('click', () => {
    const role = button.dataset.role;
    const scene = scenes[role];
    document
      .querySelectorAll('[data-role]')
      .forEach((tab) => tab.setAttribute('aria-selected', String(tab === button)));
    document.querySelector('#role-content').setAttribute('aria-labelledby', button.id);
    document.querySelector('.role-number').textContent = scene.number;
    const title = document.querySelector('#role-title');
    title.replaceChildren();
    scene.title.split('\n').forEach((line, index) => {
      if (index) title.append(document.createElement('br'));
      title.append(document.createTextNode(line));
    });
    document.querySelector('#role-description').textContent = scene.description;
    const benefits = document.querySelector('#role-benefits');
    benefits.replaceChildren(
      ...scene.benefits.map((text) => {
        const item = document.createElement('li');
        item.textContent = text;
        return item;
      }),
    );
    const link = document.querySelector('#role-demo');
    link.firstChild.textContent = scene.link + ' ';
    link.href = 'demo/?role=' + role;
    document.querySelector('#visual-label').textContent = scene.label;
    document.querySelector('#criteria-tags').replaceChildren(
      ...scene.tags.map((text) => {
        const tag = document.createElement('b');
        tag.textContent = text;
        return tag;
      }),
    );
    document.querySelector('#match-title').textContent = scene.match;
    document.querySelector('#match-description').textContent = scene.detail;
  }),
);
document.querySelectorAll('[role="tablist"]').forEach((list) => {
  const tabs = [...list.querySelectorAll('[role="tab"]')];
  tabs.forEach((tab, index) =>
    tab.addEventListener('keydown', (event) => {
      if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
      event.preventDefault();
      const direction = event.key === 'ArrowRight' ? 1 : -1;
      const next = tabs[(index + direction + tabs.length) % tabs.length];
      next.focus();
      next.click();
    }),
  );
});

const audiences = {
  business: {
    kicker: 'FOR YOUR BUSINESS',
    title: '把招聘能力接进现有业务。',
    description: '像这个 Chat Demo 一样，复用 client 与工具接口，搭建你自己的产品流程。',
    steps: [
      ['准备业务依赖', '安装 @ganzhibin/recruitment-cli，在你的业务项目中引入公共入口。'],
      ['连接账号与工作流', '完成账号初始化，按业务需要调用搜索、计划与执行能力。'],
      ['呈现你自己的产品体验', '把结构化结果与调用事件接入已有页面、服务或 Agent。'],
    ],
    code: `import { createRecruitmentClient }
  from '@ganzhibin/recruitment-cli';

const recruit = createRecruitmentClient({
  home: './.recruitment',
});

const result = await recruit.search(
  { platform: 'boss', account: 'main' },
  { query: '前端', activeWithin: '7d' },
);`,
    example: '包根 API · 业务调用示例',
    note: 'Demo 是一个业务接入实例：页面、模型与招聘能力通过同一套接口协作。账号需先在运行环境中完成登录。',
    primary: '看业务接入 Demo ↗',
    primaryHref: 'demo/',
    secondary: '阅读业务接口说明 ↗',
    secondaryHref: 'https://github.com/Ganzhib/recruitment-cli/blob/main/docs/API.md',
    copy: '复制调用示例',
  },
  agent: {
    kicker: 'FOR YOUR AGENT',
    title: '把目标交给你已经在用的 AI。',
    description:
      'WorkBuddy、Trace、豆包、Codex、Claude Code 等助手，可以从本机命令或工具接口接入。',
    steps: [
      ['选择具备本机操作能力的模式', '让助手使用本机终端；接入型 Agent 也可以调用工具 HTTP 接口。'],
      ['让助手准备工具与账号', '复制安装提示词，安装 npm 包，再由你完成平台扫码。'],
      ['交给它第一项明确任务', '提供岗位、城市和近期活跃要求，先看整理结果，再安排沟通。'],
    ],
    code: `请帮我安装并配置 recruitment-cli。
先读取 GitHub 当前说明，检查 Node.js 22.16+ 和 Chrome。
优先安装 @ganzhibin/recruitment-cli@latest，
运行 recruit --help 和 recruit schema 核验命令。
用 recruit --version 核验，运行 recruit demo 连接 API Key。

引导我扫码登录，识别我的当前身份。
按我给的岗位、城市和近期活跃要求
整理匹配结果。这次先不发招呼。

仓库：
https://github.com/Ganzhib/recruitment-cli`,
    example: '交给你的 Agent · 安装与首个任务',
    note: '需要使用具备本机终端或工具调用能力的模式。第三方 Agent 也可通过公开的工具 schema 与 HTTP 接口接入。',
    primary: '查看 Agent 接入方式 ↗',
    primaryHref: 'https://github.com/Ganzhib/recruitment-cli/blob/main/docs/DEMO.md',
    secondary: '先体验对话流程 ↗',
    secondaryHref: 'demo/',
    copy: '复制给我的 Agent',
  },
  terminal: {
    kicker: 'FOR YOUR TERMINAL',
    title: '喜欢命令行，就直接开始。',
    description: '扫码、搜索、计划和回执，用一套连贯的命令完成。也可以按自己的习惯组合脚本。',
    steps: [
      ['安装 npm 包', '安装后即可使用 recruit 命令和内置 AI Demo。'],
      ['扫码连接平台', '运行登录命令，工具会自动识别求职者或招聘者身份。'],
      ['先搜索，再形成沟通计划', '从一个明确岗位开始，用 dry-run 查看计划，准备好后再执行。'],
    ],
    code: `npm install -g @ganzhibin/recruitment-cli@latest
recruit demo

recruit auth login boss

recruit search "前端" \
  --platform boss --active-within 7d -n 5

recruit greet "前端" \
  --platform boss --dry-run`,
    example: '终端 · npm 安装后即可使用',
    note: '通过 npm 安装 CLI；源码开发可用 npm link。使用 --help 和 schema 查看实际参数，--json 便于脚本处理。',
    primary: '查看完整命令文档 ↗',
    primaryHref: 'https://github.com/Ganzhib/recruitment-cli/blob/main/README.md#开始使用',
    secondary: '查看 API 与 schema ↗',
    secondaryHref: 'https://github.com/Ganzhib/recruitment-cli/blob/main/docs/API.md',
    copy: '复制入门命令',
  },
};
let selectedAudience = 'business';
function selectAudience(id) {
  selectedAudience = id;
  const audience = audiences[id];
  document
    .querySelectorAll('[data-audience]')
    .forEach((tab) => tab.setAttribute('aria-selected', String(tab.dataset.audience === id)));
  document.querySelector('#audience-panel').setAttribute('aria-labelledby', 'audience-' + id);
  for (const field of ['kicker', 'title', 'description', 'code', 'note'])
    document.querySelector('#audience-' + field).textContent = audience[field];
  document.querySelector('#audience-example-label').textContent = audience.example;
  const steps = audience.steps.map(([title, description]) => {
    const item = document.createElement('li');
    const heading = document.createElement('strong');
    const paragraph = document.createElement('p');
    heading.textContent = title;
    paragraph.textContent = description;
    item.append(heading, paragraph);
    return item;
  });
  document.querySelector('#audience-steps').replaceChildren(...steps);
  for (const field of ['primary', 'secondary']) {
    const link = document.querySelector('#audience-' + field);
    link.textContent = audience[field];
    link.href = audience[field + 'Href'];
    if (link.href.startsWith(location.origin)) {
      link.removeAttribute('target');
      link.removeAttribute('rel');
    } else {
      link.target = '_blank';
      link.rel = 'noreferrer';
    }
  }
  document.querySelector('#copy-audience').textContent = audience.copy;
  document.querySelector('#copy-status').textContent = '';
}
document
  .querySelectorAll('[data-audience]')
  .forEach((tab) => tab.addEventListener('click', () => selectAudience(tab.dataset.audience)));
document.querySelector('#copy-audience').addEventListener('click', async () => {
  const status = document.querySelector('#copy-status');
  try {
    await navigator.clipboard.writeText(audiences[selectedAudience].code);
    status.textContent = '已复制，可以继续下一步。';
  } catch {
    status.textContent = '浏览器未允许复制，请选中上方内容手动复制。';
  }
});
selectAudience('business');

document.querySelector('#copy-install').addEventListener('click', async () => {
  const status = document.querySelector('#install-copy-status');
  try {
    await navigator.clipboard.writeText(document.querySelector('#install-prompt').textContent);
    status.textContent = '已复制，粘贴给能操作本机的 AI 助手即可。';
  } catch {
    status.textContent = '请选中上方提示词，手动复制给你的 AI 助手。';
  }
});
