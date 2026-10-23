import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { makeDelta } from '../src/delta.js';

const ctx = {};
vm.runInNewContext(readFileSync(new URL('../public/delta.js', import.meta.url), 'utf8'), ctx);
const { applyDelta } = ctx.RadarDelta;
const norm = (o) => JSON.stringify(o, (k, v) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map((x) => [x, v[x]])) : v));
const json = (o) => JSON.parse(JSON.stringify(o));

const A = {
  first: { generatedAt: 1000, more: 2, trends: { a: 1 }, stories: [{ id: 's1', title: 'One', ed: { score: 50 }, link: 'l1', realLink: 'r1' }, { id: 's2', title: 'Two', ed: { score: 40 } }] },
  more: { generatedAt: 1000, stories: [{ id: 's3', title: 'Three', ed: { score: 10 } }, { id: 's4', title: 'Four' }] },
};
const B = {
  first: { generatedAt: 2000, more: 2, trends: { a: 2 }, brief: { ids: ['s5'] }, stories: [{ id: 's5', title: 'Five (new)' }, { id: 's1', title: 'One', ed: { score: 48 }, link: 'l1' }] },
  more: { generatedAt: 2000, stories: [{ id: 's2', title: 'Two', ed: { score: 39 }, sourceCount: 3 }, { id: 's3', title: 'Three', ed: { score: 10 } }] },
};

test('applying what changed gives exactly the new publish: new, removed, changed and moved stories', () => {
  const d = makeDelta(A.first, A.more, B.first, B.more);
  assert.deepEqual(d.removed, ['s4']);
  assert.deepEqual(d.added.map((s) => s.id), ['s5']);
  const p1 = d.patches.find((p) => p.id === 's1');
  assert.deepEqual(p1, { id: 's1', set: { ed: { score: 48 } }, unset: ['realLink'] }); // only what changed
  assert.equal(d.patches.some((p) => p.id === 's3'), false); // unchanged: not sent
  const r = applyDelta(json(A), json(d));
  assert.equal(norm(r.first), norm(B.first));
  assert.equal(norm(r.more), norm(B.more));
});

test('the copy the tab holds is never changed; anything that does not fit gives null (→ full download)', () => {
  const a = json(A);
  const d = makeDelta(A.first, A.more, B.first, B.more);
  applyDelta(a, json(d));
  assert.equal(norm(a), norm(A));
  assert.equal(applyDelta(json(B), json(d)), null); // the tab is not on the previous publish (it missed one)
  assert.equal(applyDelta({ first: { ...json(A.first), stories: [] }, more: null }, json(d)), null); // a story to patch is missing
  assert.equal(applyDelta(json(A), { ...json(d), v: 2 }), null);
  assert.equal(applyDelta(json(A), { ...json(d), top: { ...d.top, generatedAt: 3 } }), null);
  assert.equal(applyDelta(null, json(d)), null);
  assert.equal(makeDelta(null, null, B.first, B.more), null); // no previous publish: no delta
});

test('workflow: this publish is kept for the next run, and restored before it collects', () => {
  const yml = readFileSync(new URL('../.github/workflows/collect.yml', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  assert.match(yml, /name: Copy the new state for the Actions cache[\s\S]*for f in news\.json news-more\.json[\s\S]*\.state-cache\/\$f/);
  const restore = yml.indexOf('name: Restore the previous publish');
  assert.ok(restore > 0 && restore < yml.indexOf('name: Collect\n'));
});
