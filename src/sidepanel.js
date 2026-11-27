import { searchCorral } from './core/corral.js';
import { resolveLanguage, translate } from './core/i18n.js';
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
const browserLang = chrome.i18n?.getUILanguage?.() || navigator.language || 'en';
const relativeFormatters = {
  zh: new Intl.RelativeTimeFormat('zh-CN', { numeric: 'always' }),
  en: new Intl.RelativeTimeFormat('en', { numeric: 'always' }),
};
const disclosure = new Map();
const pendingSettings = new Set();
const windowId = (await chrome.windows.getCurrent().catch(() => null))?.id;
const viewKeys = { tabs: 'viewTabs', duplicates: 'viewDuplicates', corral: 'viewCorral', settings: 'viewSettings' };
let lang = resolveLanguage('auto', browserLang);
let state;
let view = 'tabs';
let confirmClear = false;
let revision = 0;
let refreshTimer;
let toastTimer;
let busy = false;

function t(key, params) {
  return translate(lang, key, params);
}

function applyChromeCopy() {
  document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
  $('navigation').setAttribute('aria-label', t('navAria'));
  for (const node of document.querySelectorAll('[data-view-label]')) {
    node.textContent = t(viewKeys[node.dataset.viewLabel]);
  }
  search.placeholder = t('searchPlaceholder');
  search.setAttribute('aria-label', t('searchAria'));
  if (!state) $('open-count').textContent = t('loadingTabs');
}

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
  if (!group) return chip(t('ungrouped'));
  const name = group.title || t('untitledGroup');
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
  if (!response?.ok) throw new Error(response?.error ?? t('noBgResponse'));
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
    announce(t('actionFailed', { error: error.message }));
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
    lang = resolveLanguage(state.settings?.language, browserLang);
    applyChromeCopy();
    render();
  } catch (error) {
    if (revision !== request) return;
    if (!state) main.replaceChildren(empty('window', t('readFailedTitle'), t('readFailedHint')));
    else announce(t('refreshFailed', { error: error.message }));
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
    window.id, window.id === state.currentWindowId ? t('currentWindow') : t('windowIndex', { index: index + 1 }),
  ]));
}

function orderedWindows() {
  return [...state.windows].sort((a, b) =>
    Number(b.id === state.currentWindowId) - Number(a.id === state.currentWindowId) || a.id - b.id,
  );
}

function readableUrl(url) {
  if (!url) return t('newTab');
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

const protectionKeys = {
  pinned: 'protectPinned', audible: 'protectAudible', 'tab-lock': 'protectTabLock',
  'group-lock': 'protectGroupLock', 'window-lock': 'protectWindowLock',
  whitelist: 'protectWhitelist', internal: 'protectInternal', paused: 'protectPaused',
  'min-tabs': 'protectMinTabs', navigating: 'protectNavigating',
};

function countdown(ms) {
  if (ms === 0) return t('countdownDue');
  if (ms < 60 * 60_000) return `${Math.ceil(ms / 60_000)}m`;
  if (ms < 24 * 60 * 60_000) return `${Math.ceil(ms / (60 * 60_000))}h`;
  return `${Math.ceil(ms / (24 * 60 * 60_000))}d`;
}

function tabStatus(tab, copies) {
  const policy = state.countdowns[tab.id];
  let status;
  if (tab.active) status = chip(t('statusActive'), 'tone-accent');
  else if (lockReason(tab, state.locks)) status = chip(t('statusLocked'), 'tone-accent', 'lock');
  else if (tab.discarded) status = chip(t('statusSleeping'), '', 'sleep');
  else if (tab.pinned) status = chip(t('statusPinned'), '', 'pin');
  else if (policy?.remainingMs != null) status = chip(countdown(policy.remainingMs));

  if (status) {
    const protectionKey = protectionKeys[policy?.protectionReason];
    status.title = protectionKey ? t(protectionKey) : (
      policy?.nextAction
        ? t(policy.nextAction === 'sleep' ? 'autoSleepHint' : 'autoCloseHint', { time: countdown(policy.remainingMs) })
        : status.textContent
    );
  }
  return element('span', 'row-status', status, copies && chip(`×${copies}`, 'tone-warning'));
}

function lockButton(scope, id, locked, owningWindowId, classes = '') {
  const noun = t({ tab: 'nounTab', group: 'nounGroup', window: 'nounWindow' }[scope]);
  return button({
    label: t(locked ? 'unlockTarget' : 'lockTarget', { noun }), glyph: locked ? 'lock' : 'unlock',
    classes: `icon-button ${locked ? 'is-locked' : ''} ${classes}`,
    key: `lock-${scope}-${id}`,
    run: () => act('TOGGLE_LOCK', { scope, id, windowId: owningWindowId },
      result => t(result.locked ? 'toastLocked' : 'toastUnlocked', { noun })),
  });
}

const sleepFeedback = ({ sleptCount }) => sleptCount ? t('toastSlept', { count: sleptCount }) : t('toastNoneSlept');
const dedupeFeedback = ({ closedCount }) => closedCount ? t('toastDeduped', { count: closedCount }) : t('toastNoneDeduped');

async function jumpToTab(id) {
  try {
    await send('FOCUS_TAB', { id });
  } catch (error) {
    announce(t('jumpFailed', { error: error.message }));
  }
}

function tabRow(tab, { copies, meta, status, actions = true } = {}) {
  const title = tab.title || tab.url || t('newTab');
  const titleNode = element('span', 'row-title ellipsis', title);
  titleNode.title = title;
  const subtitle = element('span', 'row-subtitle ellipsis', readableUrl(tab.url));
  subtitle.title = tab.url ?? '';
  const open = button({ classes: 'row-main', key: `focus-${tab.id}`, label: t('switchToTab', { title }), run: () => jumpToTab(tab.id) });
  open.append(favicon(tab.favIconUrl), element('span', 'row-text', titleNode, subtitle, meta),
    status ?? tabStatus(tab, copies));
  const row = element('div', `row ${tab.active ? 'is-active' : ''} ${actions ? 'has-actions' : ''}`, open);
  if (actions) {
    row.append(element('div', 'row-actions',
      lockButton('tab', tab.id, state.locks.lockedTabIds.includes(tab.id), tab.windowId),
      !tab.active && !tab.discarded ? button({
        label: t('sleepTab'), glyph: 'sleep', classes: 'icon-button', key: `sleep-${tab.id}`,
        run: () => act('SLEEP_TAB', { id: tab.id }, sleepFeedback),
      }) : null,
      button({
        label: t('closeTab'), glyph: 'close', classes: 'icon-button danger', key: `close-${tab.id}`,
        run: () => act('CLOSE_TAB', { id: tab.id }, result =>
          result.archived ? t('toastClosedArchived') : result.closed ? t('toastClosedBlank') : t('toastClosedChanged')),
      }),
    ));
  }
  return row;
}

function disclosureKey(key, searching) {
  return searching ? `search-${key}` : key;
}

function toggleSection(key, defaultOpen, searching, label, ...content) {
  const preference = disclosureKey(key, searching);
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
  return [tab.title, tab.url, state.tabGroups[tab.groupId]?.title || (isGrouped(tab) ? t('untitledGroup') : t('ungrouped'))]
    .some(value => value?.toLowerCase().includes(query));
}

function renderGroup(groupId, rows, row, query) {
  const group = state.tabGroups[groupId] ?? { color: 'grey', windowId: rows[0].windowId };
  const key = `group-${groupId}`;
  const [expanded, toggle] = toggleSection(key, Boolean(query) || !group.collapsed, Boolean(query),
    group.title || t('untitledGroup'), groupLabel(group), element('span', 'count', String(rows.length)));
  const locked = state.locks.lockedGroupIds.includes(groupId) ||
    state.locks.lockedGroupKeys.includes(groupKey(group.windowId, groupId));
  const list = element('div', 'group-rows', ...(expanded ? rows.map(row) : []));
  list.id = key;
  list.dataset.color = group.color ?? 'grey';
  list.hidden = !expanded;
  return element('section', '',
    element('div', 'group-head', toggle,
      button({
        label: t('sleepGroup'), glyph: 'sleep', classes: 'icon-button group-action', key: `sleep-${key}`,
        run: () => act('SLEEP_GROUP', { id: groupId }, sleepFeedback),
      }),
      lockButton('group', groupId, locked, group.windowId, 'group-action'),
    ), list,
  );
}

function renderTabs(query, duplicates) {
  const nodes = [];
  if (duplicates) nodes.push(element('div', 'duplicate-strip',
    element('span', '', icon('duplicate'), t('dupBannerCount', { count: duplicates })),
    button({ text: t('quickDedupe', { count: duplicates }), classes: 'button', key: 'quick-dedupe', run: () => act('DEDUPE_ALL', {}, dedupeFeedback) }),
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
      ? t('summaryWindowsGroups', { windows: visibleWindows.length, groups: totalGroups })
      : t('summaryWindows', { windows: visibleWindows.length });
    nodes.push(element('div', 'tabs-toolbar',
      element('span', '', summary),
      button({
        text: allExpanded ? t('collapseAll') : t('expandAll'),
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
      if (pinned.length) body.append(element('section', '', element('h2', 'section-label', icon('pin'), t('pinnedSection')), ...pinned.map(row)));
      for (const [id, rows] of groups) body.append(renderGroup(id, rows, row, query));
      if (ungrouped.length) body.append(element('section', '', element('h2', 'section-label', t('ungrouped')), ...ungrouped.map(row)));
    }
    nodes.push(element('section', 'window', element('div', 'window-head', toggle,
      lockButton('window', window.id, state.locks.lockedWindowIds.includes(window.id), window.id),
    ), body));
  }
  if (!visibleWindows.length) nodes.push(query
    ? empty('search', t('emptySearchTitle'), t('emptySearchHint'))
    : empty('window', t('emptyTabsTitle'), t('emptyTabsHint')));
  return nodes;
}

function renderDuplicates(count) {
  if (!count) return [empty('duplicate', t('emptyDupTitle'), t('emptyDupHint'))];
  const names = windowNames();
  const header = element('div', 'view-toolbar',
    element('p', '', t('dupSummary', { groups: state.duplicateGroups.length, count })),
    button({ text: t('dedupeAllBtn'), classes: 'button primary', key: 'all-dedupe', run: () => act('DEDUPE_ALL', {}, dedupeFeedback) }),
  );
  return [header, ...state.duplicateGroups.map(group => {
    const url = element('h2', 'cluster-url ellipsis', group.url);
    url.title = group.url;
    return element('section', 'cluster', element('div', 'cluster-head', url, button({
      text: t('dedupeOneBtn'), label: t('dedupeOneLabel', { url: group.url }), classes: 'button', key: `dedupe-${group.url}`,
      run: () => act('DEDUPE_GROUP', { url: group.url }, dedupeFeedback),
    })), ...group.tabs.map(tab => tabRow(tab, {
      actions: false,
      meta: element('span', 'row-meta', groupLabel(state.tabGroups[tab.groupId]), chip(names[tab.windowId] ?? t('otherWindow'))),
      status: tab.id === group.keeperId ? chip(t('keepTag'), 'tone-good') : chip(t('closeTag')),
    })));
  })];
}

function relativeTime(timestamp) {
  const formatter = relativeFormatters[lang] ?? relativeFormatters.en;
  const minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60_000));
  if (minutes === 0) return t('justNow');
  if (minutes < 60) return formatter.format(-minutes, 'minute');
  if (minutes < 1440) return formatter.format(-Math.floor(minutes / 60), 'hour');
  return formatter.format(-Math.floor(minutes / 1440), 'day');
}

function renderCorral(query) {
  const count = state.corral.length;
  if (!count) return [empty('archive', t('emptyCorralTitle'), t('emptyCorralHint'))];
  const clear = confirmClear ? element('div', 'confirm-actions', button({
    text: t('cancel'), classes: 'button', key: 'cancel-clear', run: () => { confirmClear = false; renderMain(); },
  }), button({
    text: t('confirmClear'), classes: 'button danger', key: 'confirm-clear',
    run: () => { confirmClear = false; act('CLEAR_CORRAL', {}, () => t('toastClearedCorral')); },
  })) : button({
    text: t('clearCorral'), classes: 'button', key: 'clear',
    run: () => { confirmClear = true; renderMain(); main.querySelector('[data-focus-key="cancel-clear"]')?.focus(); },
  });
  const toolbar = element('div', 'view-toolbar', confirmClear ? t('confirmClearPrompt') : t('corralCount', { count }), clear);
  const filtered = searchCorral(state.corral, query);
  const reasonKeys = { auto: 'reasonAuto', duplicate: 'reasonDuplicate', manual: 'reasonManual' };
  if (!filtered.length) return [toolbar, empty('search', t('emptyCorralSearchTitle'), t('emptyCorralSearchHint'))];
  return [toolbar, element('section', 'corral-list', ...filtered.map(item => {
    const title = item.title || item.url;
    const restore = button({
      label: t('restoreLabel', { title }), classes: 'row-main', key: `restore-${item.id}`,
      run: () => act('RESTORE_CORRAL_ITEM', { id: item.id }, () => t('toastRestored')),
    });
    const group = item.groupTitle != null || item.groupColor != null
      ? groupLabel({ title: item.groupTitle, color: item.groupColor }) : null;
    restore.append(favicon(item.favIconUrl), element('span', 'row-text',
      element('span', 'row-title ellipsis', title), element('span', 'row-subtitle ellipsis', readableUrl(item.url)),
      element('span', 'row-meta', group, chip(t(reasonKeys[item.reason] ?? 'reasonClosed')), chip(relativeTime(item.closedAt))),
    ), icon('restore'));
    return element('div', 'row', restore, element('div', 'row-actions', button({
      label: t('deleteLabel', { title }), glyph: 'close', classes: 'icon-button danger', key: `delete-${item.id}`,
      run: () => act('DELETE_CORRAL_ITEM', { id: item.id }, () => t('toastDeleted')),
    })));
  }))];
}

function setting(name, title, hint, { unit, min = 1, multiline = false, options = null } = {}) {
  const field = element(options ? 'select' : multiline ? 'textarea' : 'input');
  field.id = name;
  field.dataset.focusKey = `setting-${name}`;
  if (options) {
    for (const [value, text] of options) {
      const opt = element('option', '', text);
      opt.value = value;
      field.append(opt);
    }
  } else if (multiline) {
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
    const value = options ? field.value : multiline ? field.value.split('\n') : unit ? Number(field.value) : field.checked;
    pendingSettings.add(name);
    try {
      state.settings = (await send('UPDATE_SETTINGS', { settings: { [name]: value } })).settings;
      if (name === 'language') {
        lang = resolveLanguage(state.settings.language, browserLang);
        applyChromeCopy();
        render();
      }
      announce(t('saved'));
    } catch (error) {
      announce(t('saveFailed', { error: error.message }));
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
    settingsCard(t('cardGeneral'),
      setting('language', t('settingLanguage'), t('settingLanguageHint'), {
        options: [['auto', t('langAuto')], ['zh', t('langZh')], ['en', t('langEn')]],
      })),
    settingsCard(t('cardUngrouped'),
      setting('ungroupedSleepMinutes', t('settingUngroupedSleep'), t('settingUngroupedSleepHint'), { unit: t('unitMinutes'), min: 0 }),
      setting('ungroupedCloseMinutes', t('settingUngroupedClose'), t('settingUngroupedCloseHint'), { unit: t('unitMinutes') })),
    settingsCard(t('cardGrouped'),
      setting('groupedSleepMinutes', t('settingGroupedSleep'), t('settingGroupedSleepHint'), { unit: t('unitMinutes') }),
      setting('groupedSleepOnly', t('settingGroupedSleepOnly'), t('settingGroupedSleepOnlyHint')),
      setting('groupedCloseHours', t('settingGroupedClose'), t('settingGroupedCloseHint'), { unit: t('unitHours') })),
    settingsCard(t('cardDuplicates'),
      setting('autoDedupeOnOpen', t('settingAutoDedupe'), t('settingAutoDedupeHint')),
      setting('ignoreHash', t('settingIgnoreHash'), t('settingIgnoreHashHint')),
      setting('ignoreQuery', t('settingIgnoreQuery'), t('settingIgnoreQueryHint'))),
    settingsCard(t('cardGuardrails'),
      setting('minOpenTabs', t('settingMinOpenTabs'), t('settingMinOpenTabsHint'), { unit: t('unitTabs'), min: 0 }),
      setting('whitelistDomains', t('settingWhitelist'), t('settingWhitelistHint'), { multiline: true })),
  ];
}

function syncSettings(force = false) {
  if (view !== 'settings') return;
  for (const field of main.querySelectorAll('input, textarea, select')) {
    if (pendingSettings.has(field.id) || (!force && document.activeElement === field)) continue;
    const value = state.settings[field.id];
    if (field.type === 'checkbox') field.checked = value;
    else field.value = Array.isArray(value) ? value.join('\n') : String(value);
  }
  const groupedClose = $('groupedCloseHours');
  if (groupedClose) groupedClose.disabled = state.settings.groupedSleepOnly;
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
  if (view === 'settings' && main.dataset.view === view && main.dataset.lang === lang) {
    syncSettings();
    return;
  }
  const nodes = {
    tabs: () => renderTabs(query, duplicateCount()), duplicates: () => renderDuplicates(duplicateCount()),
    corral: () => renderCorral(query), settings: renderSettings,
  }[view]();
  keepFocus(main, nodes);
  main.dataset.view = view;
  main.dataset.lang = lang;
  main.setAttribute('aria-label', t(viewKeys[view]));
  if (view === 'settings') syncSettings(true);
}

function render() {
  const paused = state.settings.paused;
  $('open-count').textContent = t('openCount', { count: state.tabs.length });
  for (const [id, count] of [['duplicate-count', duplicateCount()], ['corral-count', state.corral.length]]) {
    $(id).hidden = id === 'duplicate-count' && count === 0;
    $(id).textContent = count;
  }
  const headerKey = `${paused}:${lang}`;
  if ($('header-actions').dataset.state !== headerKey) {
    keepFocus($('header-actions'), [
      button({
        text: paused ? t('paused') : t('pause'), label: paused ? t('resumeLabel') : t('pauseLabel'),
        glyph: paused ? 'play' : 'pause', classes: `button ${paused ? 'is-paused' : ''}`, key: 'pause',
        run: () => act('UPDATE_SETTINGS', { settings: { paused: !paused } }, () => paused ? t('toastResumed') : t('toastPaused')),
      }),
      button({
        text: t('sweep'), label: t('sweepLabel'),
        glyph: 'sparkle', classes: 'button primary', key: 'sweep', disabled: paused,
        run: () => act('RUN_SWEEP_NOW', {}, ({ sleptCount, closedCount }) => t('toastSweep', { slept: sleptCount, closed: closedCount })),
      }),
    ]);
    $('header-actions').dataset.state = headerKey;
  }
  renderMain();
}

applyChromeCopy();
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
