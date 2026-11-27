import { addCorralItem } from './core/corral.js';
import { resolveLanguage, translate } from './core/i18n.js';
import { EMPTY_LOCKS, groupKey, isGrouped, lockReason } from './core/locks.js';
import { evaluateTab, isInternalPage, matchesWhitelist, sanitizeSettings } from './core/policy.js';
import { duplicateKey, findDuplicateGroups, pickKeeperTab } from './core/url.js';

function bgError(settings, key) {
  const browserLang = chrome.i18n?.getUILanguage?.() ?? '';
  return new Error(translate(resolveLanguage(settings?.language, browserLang), key));
}

const SWEEP_ALARM = 'tabtidy-sweep';
const OPEN_GUARD_MS = 30_000;
const recentActivity = new Map();
const restoredTabs = new Set();
let queue = Promise.resolve();

function enqueue(task) {
  const result = queue.then(task);
  queue = result.catch(error => console.warn('TabTidy:', error));
  return result;
}

async function readStore() {
  const data = await chrome.storage.local.get(['settings', 'locks', 'lastActiveMap', 'corral']);
  return {
    settings: sanitizeSettings(data.settings),
    locks: { ...EMPTY_LOCKS, ...data.locks },
    lastActiveMap: data.lastActiveMap ?? {},
    corral: data.corral ?? [],
  };
}

async function ensureAlarm() {
  const alarm = await chrome.alarms.get(SWEEP_ALARM);
  if (alarm?.periodInMinutes !== 1) {
    await chrome.alarms.create(SWEEP_ALARM, { periodInMinutes: 1 });
  }
}

async function initialize() {
  await ensureAlarm();
  const [{ initialized }, tabs, store] = await Promise.all([
    chrome.storage.session.get('initialized'), chrome.tabs.query({}), readStore(),
  ]);
  const now = Date.now();
  const lastActiveMap = Object.fromEntries(tabs.map(tab => [
    tab.id, Math.max(initialized ? store.lastActiveMap[tab.id] ?? 0 : 0, tab.lastAccessed ?? 0) || now,
  ]));
  // Chrome IDs belong to the current browser session, including group and window IDs.
  const locks = initialized ? store.locks : EMPTY_LOCKS;
  await chrome.storage.local.set({ lastActiveMap, locks, settings: store.settings, corral: store.corral });
  await chrome.storage.session.set({ initialized: true });
}

async function snapshot(currentWindowId) {
  const [store, windows, groups] = await Promise.all([
    readStore(),
    chrome.windows.getAll({ populate: true, windowTypes: ['normal'] }),
    chrome.tabGroups.query({}),
  ]);
  const tabs = windows.flatMap(window => window.tabs);
  const focused = windows.find(window => window.focused);
  const current = windows.find(window => window.id === currentWindowId) ?? focused ?? windows[0];
  const tabGroups = Object.fromEntries(groups.map(group => [group.id, group]));
  for (const tab of tabs) {
    store.lastActiveMap[tab.id] = Math.max(
      store.lastActiveMap[tab.id] ?? 0, recentActivity.get(tab.id) ?? 0, tab.lastAccessed ?? 0,
    ) || Date.now();
  }
  const context = {
    currentWindowId: current?.id, focusedWindowId: focused?.id, tabGroups,
    lastActiveMap: store.lastActiveMap, locks: store.locks,
  };
  return {
    ...store, ...context, tabs,
    windows: windows.map(({ tabs: windowTabs, ...window }) => window),
    duplicateGroups: findDuplicateGroups(tabs, store.settings, context),
  };
}

function idleStatus(tab, state, now, openTabCount) {
  const lastActiveAt = Math.max(recentActivity.get(tab.id) ?? 0, state.lastActiveMap[tab.id] ?? 0, tab.lastAccessed ?? 0);
  return evaluateTab(tab, {
    now, lastActiveMap: { [tab.id]: lastActiveAt || now }, settings: state.settings,
    locks: state.locks, openTabCount,
  });
}

async function getState(currentWindowId) {
  const state = await snapshot(currentWindowId);
  const now = Date.now();
  const countdowns = Object.fromEntries(state.tabs.map(tab => [
    tab.id, idleStatus(tab, state, now, state.tabs.length),
  ]));
  return { ...state, countdowns, now };
}

function trackActivity(tabId, at = Date.now()) {
  recentActivity.set(tabId, Math.max(at, recentActivity.get(tabId) ?? 0));
}

async function saveActivity(tabId, at) {
  const { lastActiveMap = {} } = await chrome.storage.local.get('lastActiveMap');
  const timestamp = Math.max(at, lastActiveMap[tabId] ?? 0);
  if (timestamp !== lastActiveMap[tabId]) {
    lastActiveMap[tabId] = timestamp;
    await chrome.storage.local.set({ lastActiveMap });
  }
}

async function transferTabState(previousId, nextId) {
  const { locks, lastActiveMap } = await readStore();
  const previousAt = lastActiveMap[previousId];
  const locked = locks.lockedTabIds.includes(previousId);
  if (previousAt === undefined && !locked) return;
  if (previousAt !== undefined) {
    lastActiveMap[nextId] = Math.max(lastActiveMap[nextId] ?? 0, previousAt);
    delete lastActiveMap[previousId];
  }
  if (locked) {
    locks.lockedTabIds = [...new Set(locks.lockedTabIds.map(id => id === previousId ? nextId : id))];
  }
  await chrome.storage.local.set({ locks, lastActiveMap });
}

async function getTab(id) {
  if (!Number.isInteger(id)) return null;
  return chrome.tabs.get(id).catch(() => null);
}

async function focusTab(id) {
  const tab = await chrome.tabs.update(id, { active: true });
  await chrome.windows.update(tab.windowId, { focused: true });
}

// Stage the recovery entry before removal so a worker restart cannot lose the URL.
async function archiveAndClose(tab, reason, state, canClose = () => true) {
  if (!tab?.url) return false;
  const group = isGrouped(tab) ? await chrome.tabGroups.get(tab.groupId).catch(() => null) : null;
  const previous = state.corral;
  const next = addCorralItem(previous, {
    id: crypto.randomUUID(), url: tab.url, title: tab.title || tab.url, favIconUrl: tab.favIconUrl,
    closedAt: Date.now(), reason, groupTitle: group?.title ?? (group ? '' : undefined),
    groupColor: group?.color,
  }, state.settings);
  await chrome.storage.local.set({ corral: next });
  try {
    const live = await getTab(tab.id);
    if (live?.url === tab.url && live.groupId === tab.groupId && await canClose(live)) {
      await chrome.tabs.remove(tab.id);
      state.corral = next;
      return true;
    }
  } catch (error) {
    console.warn('TabTidy could not close tab', tab.id, error);
  }
  await chrome.storage.local.set({ corral: previous });
  return false;
}

async function sleepTab(id, canSleep = () => true) {
  const tab = await getTab(id);
  if (!tab || tab.active || tab.discarded || !canSleep(tab)) return false;
  const discarded = await chrome.tabs.discard(id).catch(() => null);
  if (!discarded?.discarded) return false;
  // Chrome can replace the underlying tab when it discards its contents.
  if (Number.isInteger(discarded.id) && discarded.id !== id) await transferTabState(id, discarded.id);
  return true;
}

async function sweep() {
  const state = await snapshot();
  const totals = { sleptCount: 0, closedCount: 0 };
  if (state.settings.paused) return totals;

  const now = Date.now();
  const oldestFirst = [...state.tabs].sort((a, b) => state.lastActiveMap[a.id] - state.lastActiveMap[b.id]);
  for (const tab of oldestFirst) {
    const count = state.tabs.length - totals.closedCount;
    const { action } = idleStatus(tab, state, now, count);
    if (action === 'sleep') {
      if (await sleepTab(tab.id, live => idleStatus(live, state, now, count).action === 'sleep')) {
        totals.sleptCount++;
      }
    }
    if (action === 'close') {
      const live = await getTab(tab.id);
      if (!live || idleStatus(live, state, now, count).action !== 'close') continue;
      const closed = await archiveAndClose(live, 'auto', state, async candidate => {
        const windows = await chrome.windows.getAll({ populate: true, windowTypes: ['normal'] });
        const currentCount = windows.reduce((total, window) => total + window.tabs.length, 0);
        const latest = windows.find(window => window.id === candidate.windowId)?.tabs.find(tab => tab.id === candidate.id);
        return latest?.url === candidate.url && latest.groupId === candidate.groupId &&
          idleStatus(latest, state, now, currentCount).action === 'close';
      });
      if (closed) totals.closedCount++;
    }
  }
  return totals;
}

function matchesDuplicate(tab, url, settings) {
  return tab && (!tab.pendingUrl || tab.pendingUrl === tab.url) && duplicateKey(tab.url, settings) === url;
}

async function dedupe(currentWindowId, url) {
  const state = await snapshot(currentWindowId);
  let closedCount = 0;
  for (const group of state.duplicateGroups) {
    if (url !== undefined && group.url !== url) continue;
    for (const copy of group.tabs.slice(1)) {
      const live = await getTab(copy.id);
      if (!matchesDuplicate(live, group.url, state.settings)) continue;
      const closed = await archiveAndClose(live, 'duplicate', state, async candidate => {
        const keeper = await getTab(group.keeperId);
        return matchesDuplicate(keeper, group.url, state.settings) && matchesDuplicate(candidate, group.url, state.settings);
      });
      if (closed) closedCount++;
    }
  }
  return { closedCount };
}

async function openCandidates() {
  const { candidates = {} } = await chrome.storage.session.get('candidates');
  const cutoff = Date.now() - OPEN_GUARD_MS;
  return Object.fromEntries(Object.entries(candidates).filter(([, openedAt]) => openedAt >= cutoff));
}

async function registerNewTab(tab, at) {
  await saveActivity(tab.id, at);
  if (restoredTabs.delete(tab.id)) return;
  // A populated title and committed URL on creation usually indicate a native clone or session restore.
  if (duplicateKey(tab.url) && tab.title && (!tab.pendingUrl || tab.pendingUrl === tab.url)) return;
  const { settings } = await readStore();
  if (!settings.autoDedupeOnOpen || settings.paused) return;
  const candidates = await openCandidates();
  candidates[tab.id] = at;
  await chrome.storage.session.set({ candidates });
}

async function interceptDuplicate(id, at) {
  const candidates = await openCandidates();
  const openedAt = candidates[id];
  if (openedAt === undefined) return;
  const tab = await getTab(id);
  if (tab?.status !== 'complete' || !duplicateKey(tab.url)) return;
  delete candidates[id];
  await chrome.storage.session.set({ candidates });

  const state = await snapshot(tab.windowId);
  const { settings } = state;
  const url = duplicateKey(tab.url, settings);
  const protectedCopy = candidate => settings.paused || !settings.autoDedupeOnOpen ||
    candidate.pinned || candidate.audible || isGrouped(candidate) || lockReason(candidate, state.locks) ||
    isInternalPage(candidate.url) || matchesWhitelist(candidate.url, settings.whitelistDomains);
  if (!url || protectedCopy(tab)) return;
  const alternatives = state.tabs.filter(other =>
    other.id !== id && !candidates[other.id] && matchesDuplicate(other, url, settings),
  );
  const keeper = pickKeeperTab(alternatives, state);
  if (!keeper || state.tabs.filter(other => other.windowId === tab.windowId).length <= 1) return;
  // The tab may have committed and navigated again while events were queued.
  if ((recentActivity.get(id) ?? 0) > at) return;
  await focusTab(keeper.id);
  await archiveAndClose(tab, 'duplicate', state, async live => {
    const original = await getTab(keeper.id);
    const siblings = await chrome.tabs.query({ windowId: live.windowId });
    return siblings.length > 1 && (recentActivity.get(id) ?? 0) <= at &&
      !protectedCopy(live) && matchesDuplicate(live, url, settings) &&
      matchesDuplicate(original, url, settings);
  });
}

async function restoreItem(id, currentWindowId) {
  const { corral, settings } = await readStore();
  const item = corral.find(entry => entry.id === id);
  if (!item) throw bgError(settings, 'errCorralMissing');
  if (/^javascript:/i.test(item.url)) throw bgError(settings, 'errCannotRestore');
  const current = Number.isInteger(currentWindowId)
    ? await chrome.windows.get(currentWindowId).catch(() => null)
    : null;
  const window = current ?? await chrome.windows.getLastFocused({ windowTypes: ['normal'] });
  const tab = await chrome.tabs.create({ windowId: window.id, url: item.url, active: false });
  restoredTabs.add(tab.id);
  try {
    if (item.groupTitle != null || item.groupColor != null) {
      const groups = await chrome.tabGroups.query({ windowId: tab.windowId });
      const existing = item.groupTitle
        ? groups.find(group => group.title === item.groupTitle)
        : groups.find(group => !group.title && group.color === item.groupColor);
      if (existing) {
        await chrome.tabs.group({ tabIds: tab.id, groupId: existing.id });
      } else {
        const groupId = await chrome.tabs.group({ tabIds: tab.id, createProperties: { windowId: tab.windowId } });
        await chrome.tabGroups.update(groupId, {
          title: item.groupTitle ?? '', color: item.groupColor ?? 'grey',
        });
      }
    }
    await focusTab(tab.id);
  } catch (error) {
    await chrome.tabs.remove(tab.id).catch(() => {});
    throw error;
  }
  await chrome.storage.local.set({ corral: corral.filter(entry => entry.id !== id) });
  return { tabId: tab.id };
}

async function toggleLock(scope, id, windowId) {
  const { locks, settings } = await readStore();
  const key = { tab: 'lockedTabIds', group: 'lockedGroupIds', window: 'lockedWindowIds' }[scope];
  if (!key || !Number.isInteger(id)) throw bgError(settings, 'errInvalidLock');
  const legacyKey = groupKey(windowId, id);
  const wasLocked = locks[key].includes(id) || (scope === 'group' && locks.lockedGroupKeys.includes(legacyKey));
  locks[key] = wasLocked ? locks[key].filter(value => value !== id) : [...locks[key], id];
  if (scope === 'group') locks.lockedGroupKeys = locks.lockedGroupKeys.filter(value => value !== legacyKey);
  await chrome.storage.local.set({ locks });
  return { locked: !wasLocked };
}

async function handleMessage(message) {
  const { type, id, currentWindowId } = message;
  switch (type) {
    case 'GET_STATE': return getState(currentWindowId);
    case 'CLOSE_TAB': {
      const tab = await getTab(id);
      const state = await readStore();
      if (!tab?.url && tab) {
        await chrome.tabs.remove(tab.id);
        return { closed: true, archived: false };
      }
      const closed = await archiveAndClose(tab, 'manual', state);
      return { closed, archived: closed };
    }
    case 'SLEEP_TAB': return { sleptCount: Number(await sleepTab(id)) };
    case 'SLEEP_GROUP': {
      const tabs = await chrome.tabs.query({ groupId: id });
      let sleptCount = 0;
      for (const tab of tabs) sleptCount += Number(await sleepTab(tab.id, live => live.groupId === id));
      return { sleptCount };
    }
    case 'DEDUPE_ALL': return dedupe(currentWindowId);
    case 'DEDUPE_GROUP':
      if (typeof message.url !== 'string') {
        const { settings } = await readStore();
        throw bgError(settings, 'errMissingUrl');
      }
      return dedupe(currentWindowId, message.url);
    case 'TOGGLE_LOCK': return toggleLock(message.scope, id, message.windowId);
    case 'RESTORE_CORRAL_ITEM': return restoreItem(id, currentWindowId);
    case 'DELETE_CORRAL_ITEM': {
      const { corral } = await readStore();
      await chrome.storage.local.set({ corral: corral.filter(entry => entry.id !== id) });
      return {};
    }
    case 'CLEAR_CORRAL': await chrome.storage.local.set({ corral: [] }); return {};
    case 'RUN_SWEEP_NOW': return sweep();
    case 'UPDATE_SETTINGS': {
      const store = await readStore();
      const settings = sanitizeSettings({ ...store.settings, ...message.settings });
      await chrome.storage.local.set({ settings });
      return { settings };
    }
    default: {
      const { settings } = await readStore();
      throw bgError(settings, 'errUnknownAction');
    }
  }
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id || !message?.type) return false;
  const task = message.type === 'FOCUS_TAB' ? focusTab(message.id) : enqueue(() => handleMessage(message));
  task.then(
    data => respond({ ok: true, data }),
    error => respond({ ok: false, error: error.message }),
  );
  return true;
});

for (const event of [chrome.runtime.onInstalled, chrome.runtime.onStartup]) {
  event.addListener(() => {
    enqueue(() => chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }));
  });
}
chrome.alarms.onAlarm.addListener(({ name }) => {
  if (name === SWEEP_ALARM) enqueue(sweep);
});

chrome.tabs.onCreated.addListener(tab => {
  const at = Date.now();
  trackActivity(tab.id, at);
  enqueue(() => registerNewTab(tab, at));
});
chrome.tabs.onActivated.addListener(({ tabId }) => {
  const at = Date.now();
  trackActivity(tabId, at);
  enqueue(() => saveActivity(tabId, at));
});
chrome.tabs.onUpdated.addListener((id, change) => {
  const navigated = typeof change.url === 'string';
  if (!navigated && change.status !== 'complete') return;
  const at = Date.now();
  if (navigated) trackActivity(id, at);
  enqueue(async () => {
    if (navigated) await saveActivity(id, at);
    await interceptDuplicate(id, at);
  });
});
chrome.windows.onFocusChanged.addListener(id => {
  if (id === chrome.windows.WINDOW_ID_NONE) return;
  const at = Date.now();
  // Request the active tab while the focus event is fresh, even if a sweep is in flight.
  const active = chrome.tabs.query({ windowId: id, active: true }).then(([tab]) => {
    if (tab) trackActivity(tab.id, at);
    return tab;
  }).catch(() => null);
  enqueue(async () => {
    const tab = await active;
    if (tab) await saveActivity(tab.id, at);
  });
});
chrome.tabs.onReplaced.addListener((addedId, removedId) => {
  const at = recentActivity.get(removedId);
  if (at !== undefined) trackActivity(addedId, at);
  recentActivity.delete(removedId);
  enqueue(() => transferTabState(removedId, addedId));
});
chrome.tabs.onRemoved.addListener(id => {
  recentActivity.delete(id);
  enqueue(async () => {
    restoredTabs.delete(id);
    const { locks, lastActiveMap } = await readStore();
    delete lastActiveMap[id];
    locks.lockedTabIds = locks.lockedTabIds.filter(value => value !== id);
    await chrome.storage.local.set({ locks, lastActiveMap });
    const candidates = await openCandidates();
    if (id in candidates) {
      delete candidates[id];
      await chrome.storage.session.set({ candidates });
    }
  });
});
chrome.tabGroups.onRemoved.addListener(group => {
  enqueue(async () => {
    // Moving a group to another window can emit a removal while its ID still exists.
    if (await chrome.tabGroups.get(group.id).catch(() => null)) return;
    const { locks } = await readStore();
    locks.lockedGroupIds = locks.lockedGroupIds.filter(value => value !== group.id);
    locks.lockedGroupKeys = locks.lockedGroupKeys.filter(value => value !== groupKey(group.windowId, group.id));
    await chrome.storage.local.set({ locks });
  });
});
chrome.windows.onRemoved.addListener(id => {
  enqueue(async () => {
    const { locks } = await readStore();
    locks.lockedWindowIds = locks.lockedWindowIds.filter(value => value !== id);
    await chrome.storage.local.set({ locks });
  });
});

enqueue(initialize);
