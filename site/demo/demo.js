import { marked } from '../vendor/marked.js';
import DOMPurify from '../vendor/purify.js';
import { createOrb } from './orb.js';

const $ = (selector) => document.querySelector(selector);
const state = {
  local: false,
  ready: false,
  configured: false,
  role: 'seeker',
  conversationId: undefined,
  history: [],
  busy: false,
  inlineTools: new Map(),
  executionGroup: undefined,
};
const names = {
  recruit_platforms: '发现可用平台',
  recruit_accounts: '读取账号',
  recruit_login: '扫码登录',
  recruit_status: '确认当前身份',
  recruit_positions: '选择招聘岗位',
  recruit_search: '筛选匹配结果',
  recruit_plan: '整理沟通计划',
  recruit_plan_get: '查看计划',
  recruit_run_plan: '执行沟通计划',
  recruit_history: '核对沟通回执',
};
const statusOrb = createOrb($('#status-orb'));
const welcomeOrb = createOrb($('#welcome-orb'), 64);
welcomeOrb.set('breathing', '等待你的需求', false);
function status(phase, label) {
  if ($('#agent-status').dataset.phase === phase && $('#agent-status-label').textContent === label)
    return;
  const modes = {
    idle: 'breathing',
    thinking: 'solving',
    connecting: 'connecting',
    tool: 'working',
    searching: 'searching',
    composing: 'composing',
    done: 'breathing',
    error: 'breathing',
  };
  $('#agent-status').dataset.phase = phase;
  $('#agent-status-label').textContent = label;
  statusOrb.set(modes[phase] ?? 'working', label, !['idle', 'done', 'error'].includes(phase));
}
window.addEventListener('pagehide', () => {
  statusOrb.destroy();
  welcomeOrb.destroy();
});
function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
function disclosureIcon() {
  const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  icon.classList.add('tool-inline-chevron');
  icon.setAttribute('viewBox', '0 0 24 24');
  icon.setAttribute('aria-hidden', 'true');
  icon.setAttribute('focusable', 'false');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', 'm9 6 6 6-6 6');
  icon.append(path);
  return icon;
}
function scrollChat() {
  $('#chat-scroll').scrollTop = $('#chat-scroll').scrollHeight;
}
function renderMarkdown(body, text) {
  body.classList.add('markdown');
  body.innerHTML = DOMPurify.sanitize(
    marked.parse(text, { gfm: true, breaks: true, async: false }),
    {
      ALLOWED_TAGS: [
        'p',
        'br',
        'strong',
        'em',
        'del',
        'blockquote',
        'ul',
        'ol',
        'li',
        'h1',
        'h2',
        'h3',
        'h4',
        'h5',
        'h6',
        'pre',
        'code',
        'a',
        'hr',
        'table',
        'thead',
        'tbody',
        'tr',
        'th',
        'td',
      ],
      ALLOWED_ATTR: ['href', 'title', 'start'],
    },
  );
  body.querySelectorAll('a[href]').forEach((link) => {
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
  });
  body.querySelectorAll('table').forEach((table) => {
    const wrapper = element('div', 'markdown-table');
    wrapper.tabIndex = 0;
    wrapper.setAttribute('role', 'region');
    wrapper.setAttribute('aria-label', '表格，可横向滚动');
    table.replaceWith(wrapper);
    wrapper.append(table);
  });
}
function message(role, text) {
  $('#welcome').hidden = true;
  const row = element('article', 'message ' + role);
  const content = element('div');
  const body = element('div', 'message-content');
  if (role === 'assistant') {
    renderMarkdown(body, text);
  } else {
    body.textContent = text;
  }
  content.append(body);
  row.append(content);
  $('#messages').append(row);
  scrollChat();
  return content;
}
function results(container, targets) {
  const list = element('div', 'message-result');
  targets.slice(0, 6).forEach((target) => {
    const card = element('div', 'result-card');
    card.append(element('span', 'result-badge', target.activity?.label || '待确认'));
    card.append(
      element(
        'h4',
        '',
        target.kind === 'candidate' ? `${target.name} · ${target.title}` : target.title,
      ),
    );
    card.append(
      element(
        'p',
        '',
        [target.organization, target.location, target.summary]
          .filter(Boolean)
          .join(' · ')
          .slice(0, 150),
      ),
    );
    list.append(card);
  });
  container.append(list);
  scrollChat();
}
function tool(event) {
  if (event.type === 'tool.start') {
    const inline = element('details', 'tool-inline');
    inline.dataset.state = 'running';
    const summary = element('summary');
    const icon = element('span', 'tool-inline-icon', '›_');
    icon.setAttribute('aria-hidden', 'true');
    summary.append(
      icon,
      element('span', 'tool-inline-label', '正在' + (names[event.name] || '执行操作')),
      disclosureIcon(),
    );
    const detail = element('div', 'tool-inline-detail');
    detail.append(
      element('pre', '', '$ ' + event.command),
      element('pre', '', JSON.stringify(event.input, null, 2)),
    );
    inline.append(summary, detail);
    state.inlineTools.set(event.id, inline);
    if (!state.executionGroup) {
      const group = element('details', 'execution-group');
      const heading = element('summary');
      const groupIcon = element('span', 'tool-inline-icon', '›_');
      groupIcon.setAttribute('aria-hidden', 'true');
      heading.append(
        groupIcon,
        element('span', 'execution-label'),
        element('span', 'execution-count'),
        disclosureIcon(),
      );
      group.append(heading, element('div', 'execution-steps'));
      $('#messages').append(group);
      state.executionGroup = group;
    }
    state.executionGroup.querySelector('.execution-steps').append(inline);
    updateExecutionGroup(inline);
    scrollChat();
    status(
      event.name.includes('search')
        ? 'searching'
        : event.name.includes('login')
          ? 'connecting'
          : 'tool',
      names[event.name] || '正在执行',
    );
  } else {
    const inline = state.inlineTools.get(event.id);
    if (inline) {
      const failed = event.type === 'tool.error';
      inline.dataset.state = failed ? 'error' : 'done';
      const labels = {
        recruit_platforms: '已读取平台能力',
        recruit_accounts: '已读取账号',
        recruit_login: '已完成扫码登录',
        recruit_status: '已确认当前身份',
        recruit_positions: '已读取招聘岗位',
        recruit_search: '已完成筛选',
        recruit_plan: '已生成沟通计划',
        recruit_plan_get: '已读取沟通计划',
        recruit_run_plan: '已执行沟通计划',
        recruit_history: '已读取沟通回执',
      };
      inline.querySelector('.tool-inline-label').textContent = failed
        ? (names[event.name] || '操作') + ' · 需要处理'
        : labels[event.name] || '已执行操作';
      inline
        .querySelector('.tool-inline-detail')
        .append(
          element(
            'pre',
            '',
            JSON.stringify(
              failed && event.errorDetails
                ? { message: event.error, code: event.errorCode, details: event.errorDetails }
                : (event.result ?? event.error),
              null,
              2,
            ),
          ),
        );
      updateExecutionGroup(inline);
    }
    const targets = event.result?.targets;
    if (targets?.length) {
      const output = message('assistant', '');
      results(output, targets);
    }
  }
}
function updateExecutionGroup(inline) {
  const group = inline.closest('.execution-group');
  const steps = [...group.querySelectorAll('.tool-inline')];
  const running = steps.find((step) => step.dataset.state === 'running');
  const failures = steps.filter((step) => step.dataset.state === 'error').length;
  group.dataset.state = running ? 'running' : failures ? 'error' : 'done';
  group.querySelector('.execution-label').textContent = (running || inline).querySelector(
    '.tool-inline-label',
  ).textContent;
  group.querySelector('.execution-count').textContent =
    `${steps.length} 步` + (failures ? ` · ${failures} 项需处理` : '');
}
function reset(save = true) {
  if (state.busy) return;
  state.conversationId = undefined;
  state.inlineTools.clear();
  state.executionGroup = undefined;
  $('#messages').replaceChildren();
  status('idle', '就绪');
  $('#welcome').hidden = false;
  $('#allow-contact').checked = false;
  renderHistory();
  if (save) void saveUi().catch(historyError);
}
function role(role, save = true) {
  reset(false);
  state.role = role;
  document
    .querySelectorAll('[data-scenario]')
    .forEach((button) => button.classList.toggle('selected', button.dataset.scenario === role));
  $('#context-role').textContent = state.configured
    ? '真实 Agent · BOSS 直聘'
    : role === 'seeker'
      ? '求职者示例'
      : '招聘者示例';
  $('#message-input').placeholder =
    role === 'seeker' ? '描述你正在寻找的机会…' : '描述你正在寻找的人…';
  if (save) void saveUi().catch(historyError);
}
async function sample(text) {
  message('user', text);
  const response = message(
    'assistant',
    '正在展示一个预设工作流。以下公司、人员与结果均为虚构示例，不会联系真实用户。',
  );
  const targets =
    state.role === 'seeker'
      ? [
          {
            kind: 'job',
            title: '前端工程师',
            organization: '栖云科技（虚构）',
            location: '上海',
            summary: 'React / TypeScript · 25–35K',
            activity: { label: '刚刚活跃' },
          },
          {
            kind: 'job',
            title: '高级前端开发',
            organization: '向野工作室（虚构）',
            location: '上海',
            summary: '产品体验 / 工程化 · 30–40K',
            activity: { label: '今日活跃' },
          },
          {
            kind: 'job',
            title: '前端研发工程师',
            organization: '方舟实验室（虚构）',
            location: '上海',
            summary: 'TypeScript / 可视化 · 25–40K',
            activity: { label: '3 日内活跃' },
          },
        ]
      : [
          {
            kind: 'candidate',
            name: '示例候选人 A',
            title: '前端开发',
            organization: '',
            location: '上海',
            summary: 'React / TypeScript · 5 年相关经验',
            activity: { label: '在线' },
          },
          {
            kind: 'candidate',
            name: '示例候选人 B',
            title: '前端工程师',
            organization: '',
            location: '上海',
            summary: '工程化 / 组件库 · 4 年相关经验',
            activity: { label: '今日活跃' },
          },
          {
            kind: 'candidate',
            name: '示例候选人 C',
            title: '高级前端',
            organization: '',
            location: '上海',
            summary: 'TypeScript / 可视化 · 6 年相关经验',
            activity: { label: '3 日内活跃' },
          },
        ];
  const steps = [
    {
      name: 'recruit_status',
      command: 'recruit auth status boss',
      input: { platform: 'boss' },
      result: { role: state.role, name: '演示账号', simulated: true },
    },
    {
      name: 'recruit_search',
      command: 'recruit search "前端" --platform boss --city 上海 --active-within 7d -n 3',
      input: {
        query: '前端',
        city: '上海',
        activeWithin: '7d',
        limit: 3,
        ...(state.role === 'recruiter' ? { options: { job: '示例岗位' } } : {}),
      },
      result: { matched: 3, scanned: 12, simulated: true },
    },
    {
      name: 'recruit_plan',
      command: 'recruit plan create "前端" --platform boss -n 3',
      input: { query: '前端', activeWithin: '7d', limit: 3 },
      result: { planId: 'demo-plan', state: 'ready', count: 3, simulated: true },
    },
  ];
  for (const [index, step] of steps.entries()) {
    const id = 'demo-' + Date.now() + '-' + index;
    tool({ ...step, id, type: 'tool.start' });
    await new Promise((resolve) => setTimeout(resolve, 330));
    tool({ ...step, id, type: 'tool.result', durationMs: 330 });
  }
  results(response, targets);
  message(
    'assistant',
    '示例已整理出 3 个近期活跃的匹配结果，并生成沟通计划。真实使用时，Agent 会读取本机 CLI 的实际结果；只有你开启本轮沟通权限后，才会执行平台预制招呼语。\n\n点击「连接 Agent」，可以查看本地运行和接入方式。',
  );
}
async function chat(text) {
  message('user', text);
  const response = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      conversationId: state.conversationId,
      message: text,
      platform: $('#platform').value,
      allowContact: $('#allow-contact').checked,
    }),
  });
  if (!response.ok) {
    const problem = await response.json();
    throw new Error(problem.error);
  }
  const reader = response.body.getReader();
  let complete = false;
  let currentMessage;
  let currentText = '';
  let currentId;
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let end;
    while ((end = buffer.indexOf('\n\n')) >= 0) {
      const frame = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      if (!frame.startsWith('data: ')) continue;
      const event = JSON.parse(frame.slice(6));
      if (event.type === 'session') {
        state.conversationId = event.conversationId;
        await saveUi();
      }
      if (event.type === 'status')
        status(event.phase, event.phase === 'composing' ? '正在输出' : '正在思考');
      if (event.type === 'message.delta') {
        status('composing', '正在输出');
        if (currentId !== event.id) {
          currentId = event.id;
          currentText = '';
          currentMessage = message('assistant', '').querySelector('.message-content');
        }
        currentText += event.delta;
        renderMarkdown(currentMessage, currentText);
        scrollChat();
      }
      if (event.type === 'message') {
        status('composing', '正在输出');
        message('assistant', event.content);
      }
      if (event.type === 'done') {
        complete = true;
        status('done', '已完成');
      }

      if (event.type.startsWith('tool.')) tool(event);
      if (event.type === 'error') throw new Error(event.message);
    }
  }
  if (!complete) throw new Error('连接已中断，请先核对执行记录。');
}
async function submit(text) {
  if (!state.ready || !text.trim() || state.busy) return;
  if (state.local && !state.configured) {
    $('#settings-dialog').showModal();
    return;
  }
  state.busy = true;
  state.executionGroup = undefined;
  status('thinking', state.configured ? '正在思考' : '正在演示');
  $('#send-button').disabled = true;
  $('#message-input').value = '';
  try {
    if (state.configured) await chat(text.trim());
    else {
      await sample(text.trim());
      status('done', '示例已完成');
    }
  } catch (error) {
    status('error', '需要处理');
    message('error', error.message);
  } finally {
    state.busy = false;
    $('#send-button').disabled = false;
    $('#message-input').focus();
    if (state.local) await refreshHistory().catch(historyError);
  }
}
$('#chat-form').addEventListener('submit', (event) => {
  event.preventDefault();
  submit($('#message-input').value);
});
$('#message-input').addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    submit(event.currentTarget.value);
  }
});
const starterPrompts = $('#starter-prompts');
function updateStarterNavigation() {
  $('#starter-prev').disabled = starterPrompts.scrollLeft <= 1;
  $('#starter-next').disabled =
    starterPrompts.scrollLeft + starterPrompts.clientWidth >= starterPrompts.scrollWidth - 1;
}
function scrollStarters(direction) {
  starterPrompts.scrollBy({
    left: direction * starterPrompts.clientWidth * 0.85,
    behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth',
  });
}
$('#starter-prev').addEventListener('click', () => scrollStarters(-1));
$('#starter-next').addEventListener('click', () => scrollStarters(1));
starterPrompts.addEventListener('scroll', updateStarterNavigation, { passive: true });
starterPrompts.addEventListener('keydown', (event) => {
  if (event.target !== starterPrompts || !['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
  event.preventDefault();
  scrollStarters(event.key === 'ArrowLeft' ? -1 : 1);
});
const starterObserver = new ResizeObserver(updateStarterNavigation);
starterObserver.observe(starterPrompts);
window.addEventListener('pagehide', () => starterObserver.disconnect());
updateStarterNavigation();
document.querySelectorAll('[data-prompt]').forEach((button) =>
  button.addEventListener('click', () => {
    role(button.dataset.role);
    submit(button.dataset.prompt);
  }),
);
document.querySelectorAll('[data-scenario]').forEach((button) =>
  button.addEventListener('click', () => {
    if (!state.busy) role(button.dataset.scenario);
  }),
);
$('#new-chat').addEventListener('click', () => {
  if (state.busy) return;
  reset();
  $('#history-panel').hidePopover();
  $('#message-input').focus();
});
$('#settings-open').addEventListener('click', () => $('#settings-dialog').showModal());
$('#settings-close').addEventListener('click', () => $('#settings-dialog').close());
$('#settings-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!state.local) return;
  $('#settings-error').textContent = '';
  try {
    const response = await fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...Object.fromEntries(new FormData(event.currentTarget)),
        clearApiKey: $('#clear-key').checked,
      }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error);
    $('#agent-key').value = '';
    $('#clear-key').checked = false;
    state.configured = true;
    connected(result.model);
    $('#settings-dialog').close();
  } catch (error) {
    $('#settings-error').textContent = error.message;
  }
});
function connected(model) {
  $('#mode-badge').textContent = model + ' · 已连接';
  $('#settings-open').firstChild.textContent = '连接设置 ';
  $('#context-role').textContent = '真实 Agent · BOSS 直聘';
  $('#permission-label').hidden = false;
  $('#live-actions').hidden = false;
  $('#platform-label').hidden = true;
  $('#sample-label').hidden = true;
  $('#composer-note').hidden = true;
}
function historyError(error) {
  status('error', '历史记录需要处理');
  message('error', error.message);
}
async function api(path, options) {
  const response = await fetch(path, options);
  const value = await response.json();
  if (!response.ok) throw new Error(value.error);
  return value;
}
let uiWrites = Promise.resolve();
function saveUi() {
  if (!state.local || !state.ready) return Promise.resolve();
  const body = JSON.stringify({
    conversationId: state.conversationId ?? null,
    role: state.role,
    platform: $('#platform').value,
  });
  uiWrites = uiWrites
    .catch(() => {})
    .then(() =>
      api('/api/ui', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      }),
    );
  return uiWrites;
}
function renderHistory() {
  const query = $('#history-search').value.trim().toLocaleLowerCase();
  const items = state.history.filter((item) => item.title.toLocaleLowerCase().includes(query));
  const list = $('#history-list');
  list.replaceChildren();
  $('#history-count').textContent = state.history.length
    ? `${state.history.length} 段对话 · 保存在本机`
    : '继续上次的话题';
  for (const item of items) {
    const row = element('button', 'history-item');
    row.type = 'button';
    row.disabled = state.busy;
    row.dataset.conversationId = item.id;
    if (item.id === state.conversationId) {
      row.classList.add('is-current');
      row.setAttribute('aria-current', 'true');
    }
    const content = element('span', 'history-item-content');
    content.append(element('span', 'history-item-title', item.title));
    const date = item.updatedAt
      ? new Date(item.updatedAt).toLocaleString('zh-CN', {
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        })
      : '';
    content.append(
      element(
        'span',
        'history-item-date',
        (item.id === state.conversationId ? '当前会话' : '点击继续') + (date ? ' · ' + date : ''),
      ),
    );
    row.append(content);
    if (item.running || item.interrupted)
      row.append(
        element(
          'span',
          'history-badge' + (item.running ? ' running' : ''),
          item.running ? '执行中' : '已中断',
        ),
      );
    row.addEventListener('click', async () => {
      if (state.busy) return;
      try {
        await loadConversation(item.id);
        $('#history-panel').hidePopover();
        $('#message-input').focus();
      } catch (error) {
        $('#history-feedback').textContent = error.message;
      }
    });
    list.append(row);
  }
  if (!items.length) {
    const empty = element('div', 'history-empty');
    empty.append(element('strong', '', query ? '没有找到匹配会话' : '还没有历史会话'));
    empty.append(element('p', '', query ? '换个关键词试试' : '开始一段对话，它会自动保存在这里。'));
    list.append(empty);
  }
}
async function refreshHistory() {
  const { conversations } = await api('/api/conversations');
  state.history = conversations;
  renderHistory();
}
$('#history-search').addEventListener('input', renderHistory);
$('#history-panel').addEventListener('beforetoggle', (event) => {
  if (event.newState !== 'open') return;
  $('#history-search').value = '';
  $('#history-feedback').textContent = '';
  renderHistory();
  void refreshHistory().catch((error) => {
    $('#history-feedback').textContent = error.message;
  });
});
$('#history-panel').addEventListener('toggle', (event) => {
  if (event.newState === 'open') $('#history-search').focus();
});
async function loadConversation(id) {
  if (state.busy) return;
  state.busy = true;
  $('#send-button').disabled = true;
  let conversation;
  try {
    conversation = await api('/api/conversations/' + encodeURIComponent(id));
  } finally {
    state.busy = false;
    $('#send-button').disabled = false;
  }
  reset(false);
  state.conversationId = id;
  let lastTurn;
  const finishTools = () => {
    for (const inline of state.inlineTools.values()) {
      if (inline.dataset.state !== 'running') continue;
      inline.dataset.state = 'error';
      inline.querySelector('.tool-inline-label').textContent = '执行中断 · 请核对回执';
      updateExecutionGroup(inline);
    }
  };
  for (const record of conversation.events) {
    const event = record.payload;
    if (event.type === 'turn.started') {
      if (lastTurn && !['turn.completed', 'turn.interrupted'].includes(lastTurn)) {
        finishTools();
        message('error', '上次执行中断，未自动重跑。请先核对操作回执。');
      }
      state.executionGroup = undefined;
      message('user', event.message);
      $('#platform').value = event.platform;
    }
    if (event.type === 'message' && event.message.role === 'assistant' && event.message.content)
      message('assistant', event.message.content);
    if (event.type === 'tool') tool(event.event);
    if (event.type === 'turn.interrupted') {
      finishTools();
      message('error', event.reason + ' 未自动重跑，请先核对操作回执。');
    }
    lastTurn = event.type;
  }
  if (conversation.running) {
    status('thinking', '此会话仍在执行，可稍后重新打开查看');
  } else if (lastTurn && lastTurn !== 'turn.completed') {
    finishTools();
    if (lastTurn !== 'turn.interrupted')
      message('error', '上次执行中断，未自动重跑。请先核对操作回执。');
    status('error', '上次执行中断');
  } else status('done', '已恢复历史会话');
  renderHistory();
  await saveUi();
}
async function initialize() {
  state.local = location.hostname === '127.0.0.1';
  if (!state.local) {
    $('#remote-notice').hidden = false;
    $('#agent-fields').hidden = true;
    $('#agent-fields').disabled = true;
    $('#settings-save').hidden = true;
    $('#settings-intro').textContent =
      '你正在浏览 GitHub Pages 交互演示。示例内容不会连接真实账号。';
    state.ready = true;
    return;
  }
  try {
    const config = await api('/api/config');
    state.configured = config.configured;
    $('#agent-base').value = config.baseUrl;
    $('#agent-model').value = config.model;
    $('#agent-key').placeholder = config.hasApiKey
      ? '已保存；留空保留同一服务的密钥'
      : '本机模型可留空';
    if (config.configured) connected(config.model);
    else {
      $('#mode-badge').textContent = '本地工作台 · 待连接模型';
      $('#composer-note').textContent = '先连接模型 API Key，再让 AI 筛选和自动打招呼。';
      $('#sample-label').textContent = '等待连接真实模型';
    }
  } catch {
    $('#composer-note').textContent = '本地服务未连接。请确认使用 recruit demo 启动。';
  }
  try {
    $('#history-open').hidden = false;
    const ui = await api('/api/ui');
    role(ui.role, false);
    $('#platform').value = ui.platform;
    await refreshHistory();
    if (ui.conversationId) await loadConversation(ui.conversationId);
  } catch (error) {
    historyError(error);
  } finally {
    state.ready = true;
  }
}
if (new URLSearchParams(location.search).get('role') === 'recruiter') role('recruiter', false);
$('#send-button').disabled = true;
initialize().finally(() => {
  $('#send-button').disabled = false;
});

$('#login-account').addEventListener('click', () =>
  submit('请打开 BOSS 扫码登录，读取我的实际账号和当前身份。'),
);
$('#auto-greet').addEventListener('click', () => {
  if (state.busy) return;
  $('#message-input').value =
    '请按刚才确定的岗位、城市和数量筛选，展示沟通计划后自动使用平台预制招呼语打招呼，并返回执行回执。条件不完整时先问我。';
  $('#allow-contact').checked = true;
  $('#message-input').focus();
});
