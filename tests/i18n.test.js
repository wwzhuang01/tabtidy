import assert from 'node:assert/strict';
import test from 'node:test';
import { MESSAGES, resolveLanguage, translate } from '../src/core/i18n.js';

test('resolves explicit language and auto browser language', () => {
  assert.equal(resolveLanguage('zh', 'en-US'), 'zh');
  assert.equal(resolveLanguage('en', 'zh-CN'), 'en');
  assert.equal(resolveLanguage('auto', 'zh-CN'), 'zh');
  assert.equal(resolveLanguage('auto', 'zh-TW'), 'zh');
  assert.equal(resolveLanguage('auto', 'en-US'), 'en');
  assert.equal(resolveLanguage('auto', 'ja'), 'en');
  assert.equal(resolveLanguage('invalid', 'zh-Hans'), 'zh');
});

test('zh and en message dictionaries have identical keys', () => {
  const zhKeys = Object.keys(MESSAGES.zh).sort();
  const enKeys = Object.keys(MESSAGES.en).sort();
  assert.deepEqual(enKeys, zhKeys);
});

test('interpolates parameters cleanly in both languages', () => {
  assert.equal(translate('zh', 'openCount', { count: 12 }), '12 个标签页');
  assert.equal(translate('en', 'openCount', { count: 12 }), '12 tabs');
  assert.equal(translate('zh', 'toastSweep', { slept: 2, closed: 3 }), '已休眠 2 个，已收起 3 个');
  assert.equal(translate('en', 'toastSweep', { slept: 2, closed: 3 }), 'Slept 2, archived 3');
});
