import assert from 'node:assert/strict';
import test from 'node:test';
import { addCorralItem, searchCorral } from '../src/core/corral.js';

const item = (id, extra = {}) => ({
  id, closedAt: id * 1000, title: `Page ${id}`, url: `https://example.com/${id}`, reason: 'manual', ...extra,
});

test('deduplicates on normalized URL, keeping newest metadata and prior group details', () => {
  const original = item(1, { url: 'https://example.com/notes/#toc', groupTitle: '监控', groupColor: 'blue' });
  const latest = item(2, { url: 'https://example.com/notes', reason: 'duplicate' });
  const items = [original];
  assert.deepEqual(addCorralItem(items, latest), [{ ...latest, groupTitle: '监控', groupColor: 'blue' }]);
  assert.deepEqual(items, [original]);
  const regrouped = item(3, { url: latest.url, groupTitle: '', groupColor: 'orange' });
  assert.deepEqual(addCorralItem([original], regrouped), [regrouped]);
  assert.deepEqual(addCorralItem([latest], original), [{ ...latest, groupTitle: '监控', groupColor: 'blue' }]);
});

test('honors URL settings and sorts and caps recovery history', () => {
  const a = item(1, { url: 'https://example.com/?q=1' });
  const b = item(2, { url: 'https://example.com/?q=2' });
  assert.deepEqual(addCorralItem([a], b), [b, a]);
  assert.deepEqual(addCorralItem([a], b, { ignoreQuery: true }), [b]);
  assert.deepEqual(addCorralItem([item(1), item(4), item(2)], item(3), { maxCorralItems: 2 }), [item(4), item(3)]);
  const many = Array.from({ length: 500 }, (_, index) => item(index));
  assert.equal(addCorralItem(many, item(500)).length, 500);
});

test('searches titles, URLs and original group names newest-first', () => {
  const first = item(1, { title: 'A release', url: 'https://release.example.com' });
  const second = item(2, { title: 'Docs', groupTitle: 'Release 监控' });
  const third = item(3, { title: 'Search' });
  const items = [first, third, second];
  assert.deepEqual(searchCorral(items, ' RELEASE '), [second, first]);
  assert.deepEqual(searchCorral(items, 'release.example.com'), [first]);
  assert.deepEqual(searchCorral(items, '监控'), [second]);
  assert.deepEqual(searchCorral(items), [third, second, first]);
  assert.deepEqual(searchCorral(items, 'unmatched'), []);
});
