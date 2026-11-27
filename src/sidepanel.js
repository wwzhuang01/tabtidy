import { searchCorral } from './core/corral.js';
import { groupKey, isGrouped, lockReason } from './core/locks.js';

const icons = {
  search: '<circle cx="10.5" cy="10.5" r="5.5"/><path d="m15 15 4 4"/>',
  pause: '<path d="M9 5v14M15 5v14"/>',
  play: '<path d="m8 5 11 7-11 7Z"/>',
  sparkle: '<path d="M12 3l2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3Z"/>',
  chevron: '<path d="m9 6 6 6-6 6"/>',
  window: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18"/>',
  lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 1 1 8 0v3m-4 4v3"/>',
  unlock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 7.8-1.2m-3.8 8.2v3"/>',
  sleep: '<path d="M20.7 14.7A9 9 0 0 1 9.3 3.3 9.2 9.2 0 1 0 20.7 14.7Z"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  pin: '<path d="m15 3 6 6-4 1-3 3v4l-7-7h4l3-3 1-4ZM10 14l-6 6"/>',
  page: '<circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4" ry="9"/><path d="M3 12h18"/>',
  duplicate: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
  archive: '<rect x="3" y="4" width="18" height="5" rx="1"/><path d="M5 9v10h14V9m-9 5h4"/>',
  restore: '<path d="M9 8h6a5 5 0 0 1 0 10h-2M10 4 6 8l4 4"/>',
  expandAll: '<path d="m7 9 5-5 5 5M7 15l5 5 5-5"/>',
  collapseAll: '<path d="m7 4 5 5 5-5M7 20l5-5 5 5"/>',
};

const $ = id => document.getElementById(id);
const main = $('content');
const search = $('search');
const relative = new Intl.RelativeTimeFormat('zh-CN', { numeric: 'always' });
const disclosure = new Map();
const pendingSettings = new Set();
const windowId = (await chrome.windows.getCurrent().catch(() => null))?.id;
const views = { tabs: '标签页', duplicates: '重复', corral: '回收站', settings: '设置' };
let state;
let view = 'tabs';
let confirmClear = false;
let revision = 0;
let refreshTimer;
let toastTimer;
let busy = false;

function element(tag, classes, ...children) {
  const node = document.createElement(tag);
  if (classes) node.className = classes;
  node.append(...children.filter(child => child != null));
  return node;
}

function icon(name, extraClass = '') {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', `icon ${extraClass}`);
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.65');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = icons[name]; // Static extension-owned SVG paths.
  return svg;
}

function button({ text, label = text, glyph, run, classes = '', key, disabled = false }) {
  const node = element('button', classes, glyph && icon(glyph), text);
  node.type = 'button';
  node.disabled = disabled;
  if (label) {
    node.title = label;
    node.setAttribute('aria-label', label);
  }
  if (key) node.dataset.focusKey = key;
  node.addEventListener('click', run);
  return node;
}

function chip(text, tone = '', glyph) {
  return element('span', `tag ${tone}`, glyph && icon(glyph), text);
}

function groupLabel(group) {
  if (!group) return chip('未分组');
  const name = group.title || '未命名分组';
  const label = element('span', 'group-label', element('span', 'group-dot'), element('span', 'ellipsis', name));
  label.title = name;
  label.dataset.color = group.color ?? 'grey';
  return label;
}

function announce(message) {
  const toast = $('toast');
  toast.textContent = message;
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.hidden = true; }, 3000);
}

async function send(type, fields = {}) {
  const response = await chrome.runtime.sendMessage({ type, currentWindowId: windowId, ...fields });
  if (!response?.ok) throw new Error(response?.error ?? '后台服务无响应');
  return response.data;
}

async function act(type, fields, feedback) {
  if (busy) return;
  busy = true;
  try {
    const result = await send(type, fields);
    if (feedback) announce(feedback(result));
    await refresh();
  } catch (error) {
    announce(`操作失败 · ${error.message}`);
  } finally {
    busy = false;
  }
}

async function refresh() {
  const request = ++revision;
  try {
    const next = await send('GET_STATE');
    if (revision !== request) return;
    state = next;
    render();
  } catch (error) {
    if (revision !== request) return;
    if (!state) main.replaceChildren(empty('window', '无法读取标签页', '重新打开 TabTidy 后再试。'));
    else announce(`刷新失败 · ${error.message}`);
  } finally {
    if (revision === request) main.setAttribute('aria-busy', 'false');
  }
}

function queueRefresh() {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(refresh, 100);
}

function windowNames() {
  return Object.fromEntries(orderedWindows().map((window, index) => [
    window.id, window.id === state.currentWindowId ? '当前窗口' : `窗口 ${index + 1}`,
  ]));
}

function orderedWindows() {
  return [...state.windows].sort((a, b) =>
    Number(b.id === state.currentWindowId) - Number(a.id === state.currentWindowId) || a.id - b.id,
  );
}

function readableUrl(url) {
  if (!url) return '新标签页';
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return parsed.host + (parsed.pathname === '/' ? '' : parsed.pathname) + parsed.search;
    }
  } catch { /* Use the original text. */ }
  return url;
}

function favicon(url) {
  const fallback = icon('page');
  const node = element('span', 'favicon', fallback);
  if (typeof url !== 'string' || !/^(https?:|chrome:|chrome-extension:|data:image\/)/i.test(url)) return node;
  const image = element('img');
  image.alt = '';
  image.referrerPolicy = 'no-referrer';
  image.loading = 'lazy';
  image.addEventListener('load', () => {
    fallback.style.visibility = 'hidden';
    image.classList.add('is-loaded');
  });
  image.addEventListener('error', () => image.remove());
  image.src = url;
  node.append(image);
  return node;
}

const protections = {
  pinned: '已固定', audible: '正在播放声音', 'tab-lock': '标签页已锁定',
  'group-lock': '分组已锁定', 'window-lock': '窗口已锁定',
  whitelist: '白名单保护', internal: '浏览器内部页面', paused: '自动整理已暂停',
  'min-tabs': '已达到最少标签页数量', navigating: '正在打开页面',
};

function countdown(ms) {
  if (ms === 0) return '待整理';
  if (ms < 60 * 60_000) return `${Math.ceil(ms / 60_000)}m`;
  if (ms < 24 * 60 * 60_000) return `${Math.ceil(ms / (60 * 60_000))}h`;
  return `${Math.ceil(ms / (24 * 60 * 60_000))}d`;
}

function tabStatus(tab, copies) {
  const policy = state.countdowns[tab.id];
  let status;
  if (tab.active) status = chip('活跃', 'tone-accent');
  else if (lockReason(tab, state.locks)) status = chip('锁定', 'tone-accent', 'lock');
  else if (tab.discarded) status = chip('已休眠', '', 'sleep');
  else if (tab.pinned) status = chip('固定', '', 'pin');
  else if (policy?.remainingMs != null) status = chip(countdown(policy.remainingMs));

  if (status) {
    const action = policy?.nextAction === 'sleep' ? '休眠' : '关闭';
    status.title = protections[policy?.protectionReason] ?? (
      policy?.nextAction ? `自动${action} · ${countdown(policy.remainingMs)}` : status.textContent
    );
  }
  return element('span', 'row-status', status, copies && chip(`×${copies}`, 'tone-warning'));
}

function lockButton(scope, id, locked, owningWindowId, classes = '') {
  const noun = { tab: '标签页', group: '分组', window: '窗口' }[scope];
  return button({
    label: `${locked ? '解锁' : '锁定'}${noun}`, glyph: locked ? 'lock' : 'unlock',
    classes: `icon-button ${locked ? 'is-locked' : ''} ${classes}`,
    key: `lock-${scope}-${id}`,
    run: () => act('TOGGLE_LOCK', { scope, id, windowId: owningWindowId },
      result => `已${result.locked ? '锁定' : '解锁'}${noun}`),
  });
}

const sleepFeedback = ({ sleptCount }) => sleptCount ? `已休眠 ${sleptCount} 个标签页` : '没有可休眠的标签页';
const dedupeFeedback = ({ closedCount }) => closedCount ? `已去重 ${closedCount} 个标签页，可从回收站恢复` : '没有可关闭的重复标签页';

async function jumpToTab(id) {
  try {
    await send('FOCUS_TAB', { id });
  } catch (error) {
    announce(`切换失败 · ${error.message}`);
  }
}

function tabRow(tab, { copies, meta, status, actions = true } = {}) {
  const title = tab.title || tab.url || '新标签页';
  const titleNode = element('span', 'row-title ellipsis', title);
  titleNode.title = title;
  const subtitle = element('span', 'row-subtitle ellipsis', readableUrl(tab.url));
  subtitle.title = tab.url ?? '';
  const open = button({ classes: 'row-main', key: `focus-${tab.id}`, label: `切换到 ${title}`, run: () => jumpToTab(tab.id) });
  open.append(favicon(tab.favIconUrl), element('span', 'row-text', titleNode, subtitle, meta),
    status ?? tabStatus(tab, copies));
  const row = element('div', `row ${tab.active ? 'is-active' : ''} ${actions ? 'has-actions' : ''}`, open);
  if (actions) {
    row.append(element('div', 'row-actions',
      lockButton('tab', tab.id, state.locks.lockedTabIds.includes(tab.id), tab.windowId),
      !tab.active && !tab.discarded ? button({
        label: '休眠标签页', glyph: 'sleep', classes: 'icon-button', key: `sleep-${tab.id}`,
        run: () => act('SLEEP_TAB', { id: tab.id }, sleepFeedback),
      }) : null,
      button({
        label: '关闭标签页', glyph: 'close', classes: 'icon-button danger', key: `close-${tab.id}`,
        run: () => act('CLOSE_TAB', { id: tab.id }, result =>
          result.archived ? '已关闭，可从回收站恢复' : result.closed ? '已关闭空白标签页' : '标签页已变化，请重试'),
      }),
    ));
  }
  return row;
}

function toggleSection(key, defaultOpen, searching, label, ...content) {
  const preference = searching ? `search-${key}` : key;
  const expanded = disclosure.get(preference) ?? defaultOpen;
  const toggle = button({ classes: 'disclosure', key: `toggle-${key}`, label,
    run: () => { disclosure.set(preference, !expanded); renderMain(); } });
  toggle.append(icon('chevron', 'chevron'), ...content);
  toggle.setAttribute('aria-expanded', String(expanded));
  toggle.setAttribute('aria-controls', key);
  return [expanded, toggle];
}

function empty(glyph, title, hint) {
  return element('div', 'empty', icon(glyph), element('strong', '', title), element('p', '', hint));
}

function filterTab(tab, query) {
  return [tab.title, tab.url, state.tabGroups[tab.groupId]?.title || (isGrouped(tab) ? '未命名分组' : '未分组')]
    .some(value => value?.toLowerCase().includes(query));
}

function renderGroup(groupId, rows, row, query) {
  const group = state.tabGroups[groupId] ?? { color: 'grey', windowId: rows[0].windowId };
  const key = `group-${groupId}`;
  const [expanded, toggle] = toggleSection(key, Boolean(query) || !group.collapsed, Boolean(query),
    group.title || '未命名分组', groupLabel(group), element('span', 'count', String(rows.length)));
  const locked = state.locks.lockedGroupIds.includes(groupId) ||
    state.locks.lockedGroupKeys.includes(groupKey(group.windowId, groupId));
  const list = element('div', 'group-rows', ...(expanded ? rows.map(row) : []));
  list.id = key;
  list.dataset.color = group.color ?? 'grey';
  list.hidden = !expanded;
  return element('section', '',
    element('div', 'group-head', toggle,
      button({
        label: '休眠本组', glyph: 'sleep', classes: 'icon-button group-action', key: `sleep-${key}`,
        run: () => act('SLEEP_GROUP', { id: groupId }, sleepFeedback),
      }),
      lockButton('group', groupId, locked, group.windowId, 'group-action'),
    ), list,
  );
}

function disclosureKey(key, searching) {
  return searching ? `search-${key}` : key;
}

function renderTabs(query, duplicates) {
  const nodes = [];
  if (duplicates) nodes.push(element('div', 'duplicate-strip',
    element('span', '', icon('duplicate'), `${duplicates} 个重复标签页`),
    button({ text: `一键去重 (${duplicates})`, classes: 'button', key: 'quick-dedupe', run: () => act('DEDUPE_ALL', {}, dedupeFeedback) }),
  ));

  const searching = Boolean(query);
  const names = windowNames();
  const copiesById = new Map(state.duplicateGroups.flatMap(group => group.tabs.map(tab => [tab.id, group.tabs.length])));
  const row = tab => tabRow(tab, { copies: copiesById.get(tab.id) });
  const visibleWindows = orderedWindows()
    .map(window => {
      const tabs = state.tabs.filter(tab => tab.windowId === window.id && filterTab(tab, query));
      const groupIds = [...new Set(tabs.filter(tab => !tab.pinned && isGrouped(tab)).map(tab => tab.groupId))];
      return { window, tabs, groupIds };
    })
    .filter(entry => entry.tabs.length > 0);

  const totalGroups = visibleWindows.reduce((sum, entry) => sum + entry.groupIds.length, 0);
  if (visibleWindows.length > 1 || totalGroups > 0) {
    const allExpanded = visibleWindows.every(({ window, groupIds }) => {
      const winOpen = disclosure.get(disclosureKey(`window-${window.id}`, searching))
        ?? (searching || window.id === state.currentWindowId);
      if (!winOpen) return false;
      return groupIds.every(groupId =>
        disclosure.get(disclosureKey(`group-${groupId}`, searching))
          ?? (searching || !state.tabGroups[groupId]?.collapsed));
    });
    const summary = totalGroups
      ? `${visibleWindows.length} 个窗口 · ${totalGroups} 个分组`
      : `${visibleWindows.length} 个窗口`;
    nodes.push(element('div', 'tabs-toolbar',
      element('span', '', summary),
      button({
        text: allExpanded ? '全部收起' : '全部展开',
        glyph: allExpanded ? 'collapseAll' : 'expandAll',
        classes: 'button subtle',
        key: 'toggle-all-windows',
        run: () => {
          const next = !allExpanded;
          for (const { window, groupIds } of visibleWindows) {
            if (next) {
              disclosure.set(disclosureKey(`window-${window.id}`, searching), true);
              for (const groupId of groupIds) disclosure.set(disclosureKey(`group-${groupId}`, searching), true);
            } else if (visibleWindows.length > 1) {
              disclosure.set(disclosureKey(`window-${window.id}`, searching), false);
            } else {
              for (const groupId of groupIds) disclosure.set(disclosureKey(`group-${groupId}`, searching), false);
            }
          }
          renderMain();
        },
      }),
    ));
  }

  for (const { window, tabs } of visibleWindows) {
    const key = `window-${window.id}`;
    const [expanded, toggle] = toggleSection(key, searching || window.id === state.currentWindowId, searching,
      names[window.id], icon('window'), element('span', 'ellipsis', names[window.id]),
      element('span', 'count', String(tabs.length)));
    const body = element('div', 'window-body');
    body.id = key;
    body.hidden = !expanded;
    if (expanded) {
      tabs.sort((a, b) => a.index - b.index);
      const pinned = [], ungrouped = [];
      const groups = new Map();
      for (const tab of tabs) {
        if (tab.pinned) pinned.push(tab);
        else if (!isGrouped(tab)) ungrouped.push(tab);
        else {
          if (!groups.has(tab.groupId)) groups.set(tab.groupId, []);
          groups.get(tab.groupId).push(tab);
        }
      }
      if (pinned.length) body.append(element('section', '', element('h2', 'section-label', icon('pin'), '已固定'), ...pinned.map(row)));
      for (const [id, rows] of groups) body.append(renderGroup(id, rows, row, query));
      if (ungrouped.length) body.append(element('section', '', element('h2', 'section-label', '未分组'), ...ungrouped.map(row)));
    }
    nodes.push(element('section', 'window', element('div', 'window-head', toggle,
      lockButton('window', window.id, state.locks.lockedWindowIds.includes(window.id), window.id),
    ), body));
  }
  if (!visibleWindows.length) nodes.push(query
    ? empty('search', '没有匹配的标签页', '试试网址、分组名或更短的关键词。')
    : empty('window', '暂无打开的标签页', '打开网页后，标签页会按窗口显示在这里。'));
  return nodes;
}

function renderDuplicates(count) {
  if (!count) return [empty('duplicate', '没有重复标签页', '打开相同网址时，重复项会显示在这里。')];
  const names = windowNames();
  const header = element('div', 'view-toolbar',
    element('p', '', `共发现 ${state.duplicateGroups.length} 组、${count} 个多余标签`),
    button({ text: '一键全部去重', classes: 'button primary', key: 'all-dedupe', run: () => act('DEDUPE_ALL', {}, dedupeFeedback) }),
  );
  return [header, ...state.duplicateGroups.map(group => {
    const url = element('h2', 'cluster-url ellipsis', group.url);
    url.title = group.url;
    return element('section', 'cluster', element('div', 'cluster-head', url, button({
      text: '去重', label: `为 ${group.url} 去重`, classes: 'button', key: `dedupe-${group.url}`,
      run: () => act('DEDUPE_GROUP', { url: group.url }, dedupeFeedback),
    })), ...group.tabs.map(tab => tabRow(tab, {
      actions: false,
      meta: element('span', 'row-meta', groupLabel(state.tabGroups[tab.groupId]), chip(names[tab.windowId] ?? '其他窗口')),
      status: tab.id === group.keeperId ? chip('保留', 'tone-good') : chip('将关闭'),
    })));
  })];
}

function relativeTime(timestamp) {
  const minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60_000));
  if (minutes === 0) return '刚刚';
  if (minutes < 60) return relative.format(-minutes, 'minute');
  if (minutes < 1440) return relative.format(-Math.floor(minutes / 60), 'hour');
  return relative.format(-Math.floor(minutes / 1440), 'day');
}

function renderCorral(query) {
  const count = state.corral.length;
  if (!count) return [empty('archive', '回收站是空的', 'TabTidy 关闭的标签页会保存到这里，点击即可恢复。')];
  const clear = confirmClear ? element('div', 'confirm-actions', button({
    text: '取消', classes: 'button', key: 'cancel-clear', run: () => { confirmClear = false; renderMain(); },
  }), button({
    text: '确认清空', classes: 'button danger', key: 'confirm-clear',
    run: () => { confirmClear = false; act('CLEAR_CORRAL', {}, () => '已清空回收站'); },
  })) : button({
    text: '清空回收站', classes: 'button', key: 'clear',
    run: () => { confirmClear = true; renderMain(); main.querySelector('[data-focus-key="cancel-clear"]')?.focus(); },
  });
  const toolbar = element('div', 'view-toolbar', confirmClear ? '永久删除这些记录？' : `${count} 条记录`, clear);
  const filtered = searchCorral(state.corral, query);
  const reasons = { auto: '自动收起', duplicate: '去重', manual: '手动关闭' };
  if (!filtered.length) return [toolbar, empty('search', '没有匹配的回收记录', '试试网址、原分组名或更短的关键词。')];
  return [toolbar, element('section', 'corral-list', ...filtered.map(item => {
    const title = item.title || item.url;
    const restore = button({
      label: `恢复 ${title}`, classes: 'row-main', key: `restore-${item.id}`,
      run: () => act('RESTORE_CORRAL_ITEM', { id: item.id }, () => '已恢复标签页'),
    });
    const group = item.groupTitle != null || item.groupColor != null
      ? groupLabel({ title: item.groupTitle, color: item.groupColor }) : null;
    restore.append(favicon(item.favIconUrl), element('span', 'row-text',
      element('span', 'row-title ellipsis', title), element('span', 'row-subtitle ellipsis', readableUrl(item.url)),
      element('span', 'row-meta', group, chip(reasons[item.reason] ?? '已关闭'), chip(relativeTime(item.closedAt))),
    ), icon('restore'));
    return element('div', 'row', restore, element('div', 'row-actions', button({
      label: `永久删除 ${title}`, glyph: 'close', classes: 'icon-button danger', key: `delete-${item.id}`,
      run: () => act('DELETE_CORRAL_ITEM', { id: item.id }, () => '已移除记录'),
    })));
  }))];
}

function setting(name, title, hint, { unit, min = 1, multiline = false } = {}) {
  const field = element(multiline ? 'textarea' : 'input');
  field.id = name;
  if (multiline) {
    field.rows = 3;
    field.placeholder = 'localhost';
    field.spellcheck = false;
  } else if (unit) {
    field.type = 'number';
    field.min = String(min);
    field.step = '1';
  } else {
    field.type = 'checkbox';
    field.className = 'switch';
    field.setAttribute('role', 'switch');
  }
  const label = element('label', 'setting-name', title);
  label.htmlFor = name;
  const help = element('span', 'setting-hint', hint);
  help.id = `${name}-hint`;
  field.setAttribute('aria-describedby', help.id);
  field.addEventListener('change', async () => {
    if (!field.reportValidity() || (unit && field.value === '')) {
      field.value = state.settings[name];
      return;
    }
    const value = multiline ? field.value.split('\n') : unit ? Number(field.value) : field.checked;
    pendingSettings.add(name);
    try {
      state.settings = (await send('UPDATE_SETTINGS', { settings: { [name]: value } })).settings;
      announce('已保存');
    } catch (error) {
      announce(`保存失败 · ${error.message}`);
    } finally {
      pendingSettings.delete(name);
      syncSettings(true);
      queueRefresh();
    }
  });
  return element('div', multiline ? 'setting stack' : 'setting',
    element('span', 'setting-text', label, help),
    unit ? element('span', 'setting-value', field, unit) : field,
  );
}

function settingsCard(title, ...fields) {
  return element('section', 'settings-card', element('h2', '', title), ...fields);
}

function renderSettings() {
  return [
    settingsCard('普通标签页',
      setting('ungroupedSleepMinutes', '闲置后自动休眠', '释放内存，标签页仍留在窗口；设为 0 可关闭。', { unit: '分钟', min: 0 }),
      setting('ungroupedCloseMinutes', '闲置后自动关闭', '超过此时间后，从窗口收起到回收站。', { unit: '分钟' })),
    settingsCard('分组标签页',
      setting('groupedSleepMinutes', '闲置后自动休眠', '释放内存，标签页仍留在原分组。', { unit: '分钟' }),
      setting('groupedSleepOnly', '分组内标签页仅休眠', '开启后，分组中的标签页不会因闲置而关闭。'),
      setting('groupedCloseHours', '闲置后自动关闭', '超过此时间后移入回收站，恢复时保留分组信息。', { unit: '小时' })),
    settingsCard('重复标签页',
      setting('autoDedupeOnOpen', '打开重复页面时自动跳转', '转到已有页面，并将新打开的副本移入回收站。'),
      setting('ignoreHash', '忽略 # 锚点', '将同页的不同位置视为重复，适合飞书文档等。'),
      setting('ignoreQuery', '忽略 ? 查询参数', '同一页面带有不同查询参数时也视为重复。')),
    settingsCard('安全护栏',
      setting('minOpenTabs', '至少保留的标签页', '合计所有常规 Chrome 窗口中的标签页，包括固定标签页。', { unit: '个', min: 0 }),
      setting('whitelistDomains', '白名单域名', '每行一个域名或网址关键词，例如 localhost。', { multiline: true })),
  ];
}

function syncSettings(force = false) {
  if (view !== 'settings') return;
  for (const field of main.querySelectorAll('input, textarea')) {
    if (pendingSettings.has(field.id) || (!force && document.activeElement === field)) continue;
    const value = state.settings[field.id];
    if (field.type === 'checkbox') field.checked = value;
    else field.value = Array.isArray(value) ? value.join('\n') : String(value);
  }
  $('groupedCloseHours').disabled = state.settings.groupedSleepOnly;
}

function duplicateCount() {
  return state.duplicateGroups.reduce((sum, group) => sum + group.tabs.length - 1, 0);
}

function keepFocus(container, nodes) {
  const active = document.activeElement;
  const key = container.contains(active) ? active.dataset.focusKey : null;
  container.replaceChildren(...nodes);
  if (key) container.querySelector(`[data-focus-key="${CSS.escape(key)}"]`)?.focus({ preventScroll: true });
}

function renderMain() {
  if (!state) return;
  const query = search.value.trim().toLowerCase();
  if (view === 'settings' && main.dataset.view === view) {
    syncSettings();
    return;
  }
  const nodes = {
    tabs: () => renderTabs(query, duplicateCount()), duplicates: () => renderDuplicates(duplicateCount()),
    corral: () => renderCorral(query), settings: renderSettings,
  }[view]();
  keepFocus(main, nodes);
  main.dataset.view = view;
  main.setAttribute('aria-label', views[view]);
  if (view === 'settings') syncSettings();
}

function render() {
  const paused = state.settings.paused;
  $('open-count').textContent = `${state.tabs.length} 个标签页`;
  for (const [id, count] of [['duplicate-count', duplicateCount()], ['corral-count', state.corral.length]]) {
    $(id).hidden = id === 'duplicate-count' && count === 0;
    $(id).textContent = count;
  }
  if ($('header-actions').dataset.paused !== String(paused)) {
    keepFocus($('header-actions'), [
      button({
        text: paused ? '已暂停' : '暂停', label: paused ? '恢复自动整理' : '暂停自动整理',
        glyph: paused ? 'play' : 'pause', classes: `button ${paused ? 'is-paused' : ''}`, key: 'pause',
        run: () => act('UPDATE_SETTINGS', { settings: { paused: !paused } }, () => paused ? '已恢复自动整理' : '已暂停自动整理'),
      }),
      button({
        text: '立即整理', label: '立即检查闲置标签页，按设置休眠或移入回收站',
        glyph: 'sparkle', classes: 'button primary', key: 'sweep', disabled: paused,
        run: () => act('RUN_SWEEP_NOW', {}, ({ sleptCount, closedCount }) => `已休眠 ${sleptCount} 个，已收起 ${closedCount} 个`),
      }),
    ]);
    $('header-actions').dataset.paused = String(paused);
  }
  renderMain();
}

$('search-box').prepend(icon('search'));
search.addEventListener('input', renderMain);
$('navigation').addEventListener('click', event => {
  const next = event.target.closest('button')?.dataset.view;
  if (!next || next === view) return;
  view = next;
  confirmClear = false;
  search.value = '';
  $('search-area').hidden = view === 'duplicates' || view === 'settings';
  for (const item of $('navigation').querySelectorAll('button')) {
    if (item.dataset.view === view) item.setAttribute('aria-current', 'page');
    else item.removeAttribute('aria-current');
  }
  window.scrollTo(0, 0);
  renderMain();
});
document.addEventListener('keydown', event => {
  if ($('search-area').hidden || event.isComposing) return;
  const editable = event.target.closest?.('input, textarea, [contenteditable]');
  if (event.key === '/' && !editable && !event.ctrlKey && !event.metaKey && !event.altKey) {
    event.preventDefault();
    search.focus();
  }
  if (event.key === 'Escape' && search.value) {
    event.preventDefault();
    search.value = '';
    renderMain();
  }
});

for (const event of [
  chrome.tabs.onCreated, chrome.tabs.onRemoved, chrome.tabs.onUpdated, chrome.tabs.onMoved,
  chrome.tabs.onActivated, chrome.tabs.onAttached, chrome.tabs.onDetached, chrome.tabs.onReplaced,
  chrome.tabGroups.onCreated, chrome.tabGroups.onRemoved, chrome.tabGroups.onUpdated, chrome.tabGroups.onMoved,
  chrome.windows.onFocusChanged, chrome.windows.onCreated, chrome.windows.onRemoved, chrome.storage.onChanged,
]) {
  event?.addListener(queueRefresh);
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) queueRefresh(); });
setInterval(() => { if (!document.hidden && view !== 'settings') queueRefresh(); }, 30_000);
search.focus();
await refresh();
