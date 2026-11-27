export const EMPTY_LOCKS = Object.freeze({
  lockedTabIds: Object.freeze([]),
  lockedGroupKeys: Object.freeze([]),
  lockedGroupIds: Object.freeze([]),
  lockedWindowIds: Object.freeze([]),
});

export function isGrouped(tab) {
  return Number.isInteger(tab.groupId) && tab.groupId >= 0;
}

export function groupKey(windowId, groupId) {
  return `${windowId}:${groupId}`;
}

export function lockReason(tab, locks = {}) {
  if (locks.lockedTabIds?.includes(tab.id)) return 'tab-lock';
  if (isGrouped(tab) && (
    locks.lockedGroupIds?.includes(tab.groupId) ||
    locks.lockedGroupKeys?.includes(groupKey(tab.windowId, tab.groupId))
  )) return 'group-lock';
  if (locks.lockedWindowIds?.includes(tab.windowId)) return 'window-lock';
  return null;
}
