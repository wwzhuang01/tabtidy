import { normalizeUrl } from './url.js';

export function addCorralItem(items, item, {
  maxCorralItems = 500, ignoreHash = true, ignoreQuery = false,
} = {}) {
  const keyFor = url => normalizeUrl(url, { ignoreHash, ignoreQuery }) ?? url;
  const byUrl = new Map();
  const newestFirst = [item, ...items].sort((a, b) => b.closedAt - a.closedAt);
  for (const entry of newestFirst) {
    const key = keyFor(entry.url);
    const newest = byUrl.get(key);
    if (!newest) {
      byUrl.set(key, entry);
    } else if (newest.groupTitle == null && newest.groupColor == null &&
               (entry.groupTitle != null || entry.groupColor != null)) {
      byUrl.set(key, { ...newest, groupTitle: entry.groupTitle, groupColor: entry.groupColor });
    }
  }
  return [...byUrl.values()].slice(0, maxCorralItems);
}

export function searchCorral(items, query = '') {
  const filter = query.trim().toLowerCase();
  return items
    .filter(item => !filter || [item.title, item.url, item.groupTitle].some(text => text?.toLowerCase().includes(filter)))
    .sort((a, b) => b.closedAt - a.closedAt);
}
