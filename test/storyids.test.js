// Stable story ids: a story keeps its id when sources join, merge or split.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assignStoryIds } from '../src/storyids.js';

const it = (id, published) => ({ id, published });

test('a new source (even an earlier one) keeps the story id', () => {
  const r1 = assignStoryIds([[it('a', 1), it('b', 2)], [it('c', 3)]], {});
  const r2 = assignStoryIds([[it('z', 0), it('a', 1), it('b', 2)], [it('c', 3)]], r1.map);
  assert.deepEqual(r2.ids, r1.ids);
});

test('a merge keeps the bigger story id; a split gives the smaller part a new id', () => {
  const r1 = assignStoryIds([[it('a', 1), it('b', 2), it('d', 4)], [it('c', 3)]], {});
  const merged = assignStoryIds([[it('a', 1), it('b', 2), it('d', 4), it('c', 3)]], r1.map);
  assert.deepEqual(merged.ids, ['a']);
  const split = assignStoryIds([[it('a', 1), it('d', 4)], [it('b', 2)]], merged.map);
  assert.equal(split.ids[0], 'a');
  assert.notEqual(split.ids[1], 'a');
});

test('ids are unique in a run', () => {
  const r = assignStoryIds([[it('x', 1)], [it('x', 1)]], {});
  assert.equal(new Set(r.ids).size, 2);
});
