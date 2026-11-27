import assert from 'node:assert/strict';
import test from 'node:test';
import { findDuplicateGroups, normalizeUrl, pickKeeperTab } from '../src/core/url.js';

test('normalizes host, default port, hash and trailing slash', () => {
  assert.equal(normalizeUrl(' HTTPS://ExAmple.com:443/articles/#part '), 'https://example.com/articles');
  assert.equal(normalizeUrl('https://example.com/'), 'https://example.com');
  assert.equal(normalizeUrl('https://example.com/a/?page=1#part'), 'https://example.com/a?page=1');
  assert.equal(normalizeUrl('https://example.com/a/#part', { ignoreTrailingSlash: false, ignoreHash: false }), 'https://example.com/a/#part');
});

test('retains queries by default and can ignore them independently of fragments', () => {
  assert.equal(normalizeUrl('https://example.com/?q=x'), 'https://example.com?q=x');
  assert.equal(normalizeUrl('https://example.com/?q=x#part', { ignoreQuery: true, ignoreHash: false }), 'https://example.com#part');
});

test('handles browser and file URLs, opaque paths and invalid URLs', () => {
  assert.equal(normalizeUrl('chrome://settings/#content'), 'chrome://settings');
  assert.equal(normalizeUrl('edge://settings/'), 'edge://settings');
  assert.equal(normalizeUrl('about:blank#part'), 'about:blank');
  assert.equal(normalizeUrl('file:///tmp/project/'), 'file:///tmp/project');
  assert.equal(normalizeUrl('file:///'), 'file:///');
  assert.equal(normalizeUrl('file:///C:/'), 'file:///C:/');
  assert.equal(normalizeUrl('data:text/plain,ending/'), 'data:text/plain,ending/');
  for (const invalid of [null, 42, '   ', 'not a URL', 'https://', '/relative/path']) {
    assert.equal(normalizeUrl(invalid), null);
  }
});

const tab = (id, extra = {}) => ({
  id, windowId: 1, groupId: -1, index: id, url: 'https://example.com/', ...extra,
});

test('groups normalized duplicates, skips blank and pending tabs, and puts the keeper first', () => {
  const tabs = [
    tab(1), tab(2, { url: 'https://example.com#part', active: true }),
    tab(3, { url: 'https://example.com/?q=x' }),
    tab(4, { url: 'chrome://newtab/' }), tab(5, { url: 'chrome://newtab/#part' }),
    tab(6, { url: 'about:blank' }), tab(7, { url: 'about:blank#part' }),
    tab(8, { url: undefined }), tab(9, { pendingUrl: 'https://elsewhere.test' }),
  ];
  assert.deepEqual(findDuplicateGroups(tabs), [
    { url: 'https://example.com', keeperId: 2, tabs: [tabs[1], tabs[0]] },
  ]);
  assert.deepEqual(findDuplicateGroups(tabs, { ignoreQuery: true })[0].tabs.map(tab => tab.id), [2, 1, 3]);
  assert.deepEqual(findDuplicateGroups(tabs, { ignoreHash: false }), []);
});

test('ranks focused active > active > pinned > lock > named group > group > recency', () => {
  const candidates = [
    tab(1, { lastActiveAt: 700 }),
    tab(2, { groupId: 31, lastActiveAt: 600 }),
    tab(3, { groupId: 32, lastActiveAt: 500 }),
    tab(4, { lastActiveAt: 400 }),
    tab(5, { pinned: true, lastActiveAt: 300 }),
    tab(6, { active: true, windowId: 2, lastActiveAt: 200 }),
    tab(7, { active: true, windowId: 3, lastActiveAt: 100 }),
  ];
  const context = { focusedWindowId: 3, tabGroups: { 32: { title: '监控' } }, locks: { lockedTabIds: [4] } };
  for (let count = candidates.length; count > 0; count--) {
    assert.equal(pickKeeperTab(candidates.slice(0, count), context).id, count);
  }
  assert.equal(pickKeeperTab(candidates.slice(-2), { currentWindowId: 2 }).id, 6);
});

test('treats group and window locks as keeper protection and uses lowest index as tie-break', () => {
  const loose = tab(1, { lastActiveAt: 100, index: 4 });
  const grouped = tab(2, { groupId: 8 });
  const otherWindow = tab(3, { windowId: 4 });
  assert.equal(pickKeeperTab([grouped, otherWindow], { locks: { lockedWindowIds: [4] } }).id, 3);
  assert.equal(pickKeeperTab([loose, grouped], { locks: { lockedGroupKeys: ['1:8'] } }).id, 2);
  const lowerIndex = tab(10, { index: 2 });
  assert.equal(pickKeeperTab([loose, lowerIndex], { lastActiveMap: { 1: 100, 10: 100 } }).id, 10);
  assert.equal(pickKeeperTab([loose, lowerIndex], { lastActiveMap: { 1: 101, 10: 100 } }).id, 1);
  assert.equal(pickKeeperTab([]), undefined);
});
