import { isGrouped, lockReason } from './locks.js';

export function normalizeUrl(rawUrl, {
  ignoreHash = true,
  ignoreTrailingSlash = true,
  ignoreQuery = false,
} = {}) {
  if (typeof rawUrl !== 'string' || !rawUrl.trim()) return null;
  try {
    const url = new URL(rawUrl.trim());
    if (ignoreHash) url.hash = '';
    if (ignoreQuery) url.search = '';
    // Modify the serialized path so the URL parser cannot reinsert a root slash.
    if (!ignoreTrailingSlash || !url.pathname.startsWith('/') || !url.pathname.endsWith('/')) return url.href;
    const suffixAt = url.href.search(/[?#]/);
    const pathEnd = suffixAt === -1 ? url.href.length : suffixAt;
    const prefix = url.href.slice(0, pathEnd);
    // Keep the third slash that makes file:/// a valid absolute file URL.
    if (url.protocol === 'file:' && /^\/(?:[a-z]:\/)?$/i.test(url.pathname)) return url.href;
    return prefix.replace(/\/+$/, '') + url.href.slice(pathEnd);
  } catch {
    return null;
  }
}

const blankUrls = new Set(['chrome://newtab', 'chrome://new-tab-page', 'edge://newtab', 'about:blank']);

export function duplicateKey(rawUrl, options) {
  const base = normalizeUrl(rawUrl, { ignoreQuery: true });
  return base && !blankUrls.has(base) ? normalizeUrl(rawUrl, options) : null;
}

export function pickKeeperTab(tabs, context = {}) {
  const { focusedWindowId, currentWindowId, tabGroups = {}, locks = {}, lastActiveMap = {} } = context;
  function rank(tab) {
    return [
      Number(Boolean(tab.active) && tab.windowId === (focusedWindowId ?? currentWindowId)),
      Number(Boolean(tab.active)),
      Number(Boolean(tab.pinned)),
      Number(Boolean(lockReason(tab, locks))),
      Number(isGrouped(tab)),
      Number(isGrouped(tab) && Boolean((tabGroups[tab.groupId]?.title ?? tab.groupTitle)?.trim())),
      lastActiveMap[tab.id] ?? tab.lastActiveAt ?? tab.lastAccessed ?? 0,
      -(tab.index ?? Infinity),
      -(tab.id ?? Infinity),
    ];
  }

  let keeper;
  let best;
  for (const tab of tabs) {
    const score = rank(tab);
    const difference = best ? score.findIndex((value, index) => value !== best[index]) : -1;
    if (!best || (difference !== -1 && score[difference] > best[difference])) {
      keeper = tab;
      best = score;
    }
  }
  return keeper;
}

export function findDuplicateGroups(tabs, options, context) {
  const byUrl = new Map();
  for (const tab of tabs) {
    if (tab.pendingUrl && tab.pendingUrl !== tab.url) continue;
    const url = duplicateKey(tab.url, options);
    if (!url) continue;
    if (!byUrl.has(url)) byUrl.set(url, []);
    byUrl.get(url).push(tab);
  }
  return [...byUrl]
    .filter(([, copies]) => copies.length > 1)
    .map(([url, copies]) => {
      const keeper = pickKeeperTab(copies, context);
      return { url, keeperId: keeper.id, tabs: [keeper, ...copies.filter(tab => tab !== keeper)] };
    });
}
