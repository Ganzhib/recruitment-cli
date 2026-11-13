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
    link.href = 'demo.html?role=' + role;
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
document.querySelectorAll('[role="tab"]').forEach((tab, index, tabs) =>
  tab.addEventListener('keydown', (event) => {
    if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    event.preventDefault();
    const next = tabs[(index + 1) % tabs.length];
    next.focus();
    next.click();
  }),
);
document.querySelector('#copy-setup').addEventListener('click', async () => {
  const status = document.querySelector('#copy-status');
  try {
    const prompt =
      document.querySelector('#setup-prompt').textContent +
      '\n仓库：https://github.com/Ganzhib/recruitment-cli\n官网：https://ganzhib.github.io/recruitment-cli/';
    await navigator.clipboard.writeText(prompt);
    status.textContent = '已复制，交给能操作本机的 AI 助手即可。';
  } catch {
    status.textContent = '浏览器未允许复制，请选中上方提示词手动复制。';
  }
});
