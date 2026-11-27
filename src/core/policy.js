import { LANGUAGES } from './i18n.js';
import { isGrouped, lockReason } from './locks.js';

const MINUTE = 60_000;
export const DEFAULT_SETTINGS = Object.freeze({
  paused: false,
  language: 'auto',
  ungroupedSleepMinutes: 15,
  ungroupedCloseMinutes: 60,
  groupedSleepMinutes: 30,
  groupedSleepOnly: false,
  groupedCloseHours: 24,
  minOpenTabs: 5,
  ignoreHash: true,
  ignoreQuery: false,
  autoDedupeOnOpen: false,
  whitelistDomains: Object.freeze([]),
  maxCorralItems: 500,
});

export function sanitizeSettings(settings = {}) {
  return Object.fromEntries(Object.entries(DEFAULT_SETTINGS).map(([key, fallback]) => {
    const value = settings[key];
    if (key === 'language') {
      return [key, LANGUAGES.includes(value) ? value : fallback];
    }
    if (key === 'whitelistDomains') {
      return [key, Array.isArray(value)
        ? [...new Set(value.filter(pattern => typeof pattern === 'string').map(pattern => pattern.trim().toLowerCase()).filter(Boolean))]
        : fallback];
    }
    if (typeof fallback === 'number') {
      const minimum = key === 'minOpenTabs' || key === 'ungroupedSleepMinutes' ? 0 : 1;
      return [key, Number.isSafeInteger(value) && value >= minimum ? value : fallback];
    }
    return [key, typeof value === 'boolean' ? value : fallback];
  }));
}

export function matchesWhitelist(rawUrl, patterns = []) {
  const url = (rawUrl ?? '').toLowerCase();
  let hostname = '';
  try { hostname = new URL(url).hostname; } catch { /* Match raw text below. */ }
  return patterns.some(value => {
    const pattern = value.trim().toLowerCase();
    return pattern && (hostname.includes(pattern) || url.includes(pattern));
  });
}

export function isInternalPage(url) {
  return /^(?:chrome(?:-extension|-untrusted)?|edge|devtools|about):/i.test(url ?? '');
}

export function evaluateTab(tab, {
  now, lastActiveMap = {}, settings = DEFAULT_SETTINGS, locks = {}, openTabCount = Infinity,
} = {}) {
  const lastActive = lastActiveMap[tab.id] ?? tab.lastActiveAt ?? tab.lastAccessed ?? now;
  const idle = Math.max(0, now - lastActive);
  const group = isGrouped(tab);
  const closeAt = group
    ? (settings.groupedSleepOnly ? Infinity : settings.groupedCloseHours * 60 * MINUTE)
    : settings.ungroupedCloseMinutes * MINUTE;
  const sleepMinutes = group ? settings.groupedSleepMinutes : settings.ungroupedSleepMinutes;
  const sleepAt = !tab.discarded && sleepMinutes > 0 ? sleepMinutes * MINUTE : Infinity;
  const canClose = openTabCount > settings.minOpenTabs;
  const reason = tab.active ? 'active'
    : tab.pinned ? 'pinned'
    : tab.audible ? 'audible'
    : lockReason(tab, locks)
      ?? (matchesWhitelist(tab.url, settings.whitelistDomains) ? 'whitelist' : null)
      ?? (isInternalPage(tab.url) ? 'internal' : null)
      ?? (tab.pendingUrl && tab.pendingUrl !== tab.url ? 'navigating' : null)
      ?? (!tab.url ? 'no-url' : null)
      ?? (settings.paused ? 'paused' : null);
  const blocked = protectionReason => ({
    action: 'none', remainingMs: null, nextAction: null, protectionReason,
  });
  if (reason) return blocked(reason);

  const closeDue = canClose && closeAt <= idle;
  const sleepDue = sleepAt <= idle;
  if (closeDue || sleepDue) {
    const action = closeDue ? 'close' : 'sleep';
    return { action, remainingMs: 0, nextAction: action, protectionReason: null };
  }

  const nextCloseAt = canClose ? closeAt : Infinity;
  const nextAt = Math.min(nextCloseAt, sleepAt);
  if (!Number.isFinite(nextAt)) {
    return blocked(!canClose && Number.isFinite(closeAt) ? 'min-tabs' : null);
  }
  return {
    action: 'none', remainingMs: nextAt - idle,
    nextAction: nextCloseAt <= sleepAt ? 'close' : 'sleep', protectionReason: null,
  };
}
