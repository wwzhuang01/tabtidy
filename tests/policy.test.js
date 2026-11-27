import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_SETTINGS, evaluateTab, sanitizeSettings } from '../src/core/policy.js';

const minute = 60_000;
const now = 2000 * minute;
const base = { id: 5, windowId: 2, groupId: -1, url: 'https://example.com/notes' };
function evaluate(idle, tab = {}, settings = {}, locks = {}, openTabCount = 10) {
  return evaluateTab({ ...base, ...tab }, {
    now, lastActiveMap: { 5: now - idle * minute }, settings: { ...DEFAULT_SETTINGS, ...settings }, locks, openTabCount,
  });
}

test('ungrouped tabs sleep after 15 minutes, stay discarded, and close after 60 minutes', () => {
  assert.deepEqual(evaluate(5), {
    action: 'none', remainingMs: 10 * minute, nextAction: 'sleep', protectionReason: null,
  });
  assert.deepEqual(evaluate(15), { action: 'sleep', remainingMs: 0, nextAction: 'sleep', protectionReason: null });
  assert.deepEqual(evaluate(36, { discarded: true }), {
    action: 'none', remainingMs: 24 * minute, nextAction: 'close', protectionReason: null,
  });
  assert.deepEqual(evaluate(60, { discarded: true }), { action: 'close', remainingMs: 0, nextAction: 'close', protectionReason: null });
  assert.deepEqual(evaluate(60), { action: 'close', remainingMs: 0, nextAction: 'close', protectionReason: null });
});

test('ungrouped sleep can be disabled with 0 or bypassed when close comes first', () => {
  assert.deepEqual(evaluate(36, {}, { ungroupedSleepMinutes: 0 }), {
    action: 'none', remainingMs: 24 * minute, nextAction: 'close', protectionReason: null,
  });
  assert.equal(evaluate(60, {}, { ungroupedSleepMinutes: 0 }).action, 'close');
  assert.deepEqual(evaluate(36, {}, { ungroupedSleepMinutes: 90, ungroupedCloseMinutes: 60 }), {
    action: 'none', remainingMs: 24 * minute, nextAction: 'close', protectionReason: null,
  });
  assert.equal(evaluate(60, {}, { ungroupedSleepMinutes: 90, ungroupedCloseMinutes: 60 }).action, 'close');
});

test('grouped tabs sleep after 30 minutes, stay discarded, and close after 24 hours', () => {
  const group = { groupId: 3 };
  assert.equal(evaluate(29, group).remainingMs, minute);
  assert.equal(evaluate(30, group).action, 'sleep');
  assert.deepEqual(evaluate(30, { ...group, discarded: true }), {
    action: 'none', remainingMs: (1440 - 30) * minute, nextAction: 'close', protectionReason: null,
  });
  assert.equal(evaluate(1440, { ...group, discarded: true }).action, 'close');
  assert.equal(evaluate(1440, group).action, 'close');
});

test('sleep-only mode sleeps grouped tabs without ever closing them', () => {
  const settings = { groupedSleepOnly: true };
  assert.equal(evaluate(1900, { groupId: 3 }, settings).action, 'sleep');
  assert.deepEqual(evaluate(1900, { groupId: 3, discarded: true }, settings), {
    action: 'none', remainingMs: null, nextAction: null, protectionReason: null,
  });
  assert.equal(evaluate(1900, {}, settings).action, 'close');
});

test('at the open tab floor sleep remains eligible while closing is protected', () => {
  assert.equal(evaluate(70, {}, {}, {}, 5).action, 'sleep');
  assert.equal(evaluate(70, { discarded: true }, {}, {}, 5).protectionReason, 'min-tabs');
  assert.equal(evaluate(70, {}, { ungroupedSleepMinutes: 0 }, {}, 5).protectionReason, 'min-tabs');
  assert.equal(evaluate(70, {}, {}, {}, 6).action, 'close');
  assert.equal(evaluate(1440, { groupId: 3 }, {}, {}, 5).action, 'sleep');
  assert.equal(evaluate(1440, { groupId: 3, discarded: true }, {}, {}, 5).action, 'none');
});

test('paused, active, pinned, audible, locked, whitelisted and internal tabs are protected', () => {
  const guards = [
    ['active', { active: true }], ['pinned', { pinned: true }], ['audible', { audible: true }],
    ['tab-lock', {}, {}, { lockedTabIds: [5] }], ['group-lock', {}, {}, { lockedGroupIds: [3] }],
    ['group-lock', {}, {}, { lockedGroupKeys: ['2:3'] }], ['window-lock', {}, {}, { lockedWindowIds: [2] }],
    ['whitelist', { url: 'http://localhost:8080' }, { whitelistDomains: ['LOCALHOST'] }],
    ['whitelist', {}, { whitelistDomains: ['/notes'] }],
    ['internal', { url: 'chrome://extensions' }], ['internal', { url: 'chrome-extension://tabtidy/app.html' }],
    ['internal', { url: 'devtools://devtools' }], ['internal', { url: 'about:blank' }],
    ['navigating', { pendingUrl: 'https://new.example.com' }],
    ['paused', {}, { paused: true }],
  ];
  for (const [reason, tab, settings, locks] of guards) {
    for (const idle of [31, 1500]) {
      assert.deepEqual(evaluate(idle, { groupId: 3, ...tab }, settings, locks), {
        action: 'none', remainingMs: null, nextAction: null, protectionReason: reason,
      });
    }
  }
});

test('missing timestamps begin at now and configured limits change thresholds', () => {
  assert.equal(evaluateTab(base, { now }).remainingMs, 15 * minute);
  assert.equal(evaluate(-1).remainingMs, 15 * minute);
  assert.equal(evaluate(10, {}, { ungroupedSleepMinutes: 10 }).action, 'sleep');
  assert.equal(evaluate(15, {}, { ungroupedCloseMinutes: 15 }).action, 'close');
  assert.equal(evaluate(15, { groupId: 3 }, { groupedSleepMinutes: 15 }).action, 'sleep');
  assert.equal(evaluate(120, { groupId: 3 }, { groupedCloseHours: 2 }).action, 'close');
});

test('sanitizes storage settings and normalizes whitelist input', () => {
  const settings = sanitizeSettings({
    ungroupedSleepMinutes: 0, groupedCloseHours: -1, minOpenTabs: 0, ignoreHash: 'false', unknown: true,
    whitelistDomains: [' LocalHost ', 'localhost', null, '  ', 'example.com'],
  });
  assert.equal(settings.ungroupedSleepMinutes, 0);
  assert.equal(sanitizeSettings({ ungroupedSleepMinutes: -1 }).ungroupedSleepMinutes, 15);
  assert.equal(settings.groupedCloseHours, 24);
  assert.equal(settings.minOpenTabs, 0);
  assert.equal(settings.ignoreHash, true);
  assert.equal(settings.unknown, undefined);
  assert.deepEqual(settings.whitelistDomains, ['localhost', 'example.com']);
});
