import { test } from 'vitest';
import assert from 'node:assert/strict';
import { exactFirst } from '../../src/content/search-exact-core';

const on = { enabled: true, category: 'video', order: 'totalrank' };
const item = (bvid, title) => ({ bvid, title });
const target = item('BV1kuxM6bE2A', 'Photoshop 头发丝抠图完整教程');
const first = item('BV1CoxY6YE4y', '另一部视频');
const last = item('BV1111111111', '其他标题');
const original = Object.freeze([Object.freeze(first), Object.freeze(target), Object.freeze(last)]);

test('complete title moves the known target; unrelated relative order and object identity remain', () => {
  const result = exactFirst(original, target.title, on);
  assert.deepEqual(result, [target, first, last]); assert.equal(result[0], target);
  assert.deepEqual(original, [first, target, last]);
});
test('disabled, non-video categories, and explicit native orders preserve every item', () => {
  for (const context of [{ ...on, enabled: false }, { ...on, category: 'all' },
    { ...on, category: 'user' }, { ...on, order: 'pubdate' }, { ...on, order: 'click' }])
    assert.deepEqual(exactFirst(original, target.title, context), original);
});
test('ambiguous queries, partial title, empty query, and short exact titles remain unchanged', () => {
  for (const q of ['', ' ', 'Photoshop', '头发丝抠图', 'PS', 'PS5', 'C++', '.NET', '教程'])
    assert.deepEqual(exactFirst(original, q, on), original);
  const items = [first, item('BV1111111111', 'PS5')];
  assert.deepEqual(exactFirst(items, 'PS5', on), items);
});
test('only exact BV moves; BV payload case is significant', () => {
  assert.deepEqual(exactFirst(original, ' BV1kuxM6bE2A ', on), [target, first, last]);
  assert.deepEqual(exactFirst(original, 'BV1kuxM6be2A', on), original);
  assert.deepEqual(exactFirst(original, 'BV1kuxM6bE2A 教程', on), original);
});
test('normalization accepts width, Latin case and whitespace, preserving meaningful punctuation/versions', () => {
  const items = [item('BV1111111111', 'C 入门完整教程'), item('BV2222222222', 'C++ 入门完整教程'),
    item('BV3333333333', '.NET 8.0 完整教程'), item('BV4444444444', '.NET 9.0 完整教程')];
  assert.equal(exactFirst(items, 'Ｃ＋＋  入门完整教程', on)[0], items[1]);
  assert.equal(exactFirst(items, ' .net\t8.0  完整教程 ', on)[0], items[2]);
  assert.equal(exactFirst(items, '.net 9.0 完整教程', on)[0], items[3]);
  assert.deepEqual(exactFirst(items, 'C 入门', on), items);
});
test('duplicate complete titles retain original order; no candidate disappears or is fabricated', () => {
  const second = item('BV2222222222', target.title);
  const items = [first, second, last, target];
  const result = exactFirst(items, target.title, on);
  assert.deepEqual(result, [second, target, first, last]); assert.equal(result.length, items.length);
});
test('exact match can already be first; repeat application is stable', () => {
  const once = exactFirst(original, target.title, on);
  assert.deepEqual(exactFirst(once, target.title, on), once);
});
test('missing target and empty candidates leave the candidate set unchanged', () => {
  assert.deepEqual(exactFirst(original, '不存在的视频完整标题', on), original);
  assert.deepEqual(exactFirst([], target.title, on), []);
});
test('clear enhancement is lossless because the original snapshot is not mutated', () => {
  exactFirst(original, target.title, on);
  assert.deepEqual(exactFirst(original, target.title, { ...on, enabled: false }), [first, target, last]);
});
