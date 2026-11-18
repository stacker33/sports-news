import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pruneMeta, KEEP_MS } from '../src/metaprune.js';
import { stageTimer } from '../src/timing.js';

const H = 3600e3;
const NOW = Date.UTC(2026, 10, 18, 12, 0, 0);

test('stale trend entries are removed; active ones, recent ones and other kinds of source stay', () => {
  const meta = {
    'trend-stale': { last: NOW - 5 * 24 * H, ok: true },
    'trend-stale-failing': { last: NOW - 3 * 24 * H, ok: false, failStreak: 7 },
    'trend-never': {},
    'trend-recent': { last: NOW - 2 * H, ok: true },
    'trend-edge': { last: NOW - KEEP_MS, ok: true },
    'trend-active': { last: NOW - 9 * 24 * H, ok: true },
    'team-old': { last: NOW - 30 * 24 * H, ok: true },
    'abroad-old': { last: NOW - 30 * 24 * H, ok: true },
    one: { last: NOW - 60e3, ok: true },
    ghanasoccernet: { last: NOW - 30 * 24 * H, ok: false, failStreak: 980 },
  };
  const removed = pruneMeta(meta, new Set(['trend-active', 'one']), NOW);
  assert.equal(removed, 3);
  assert.deepEqual(Object.keys(meta).sort(), ['abroad-old', 'ghanasoccernet', 'one', 'team-old', 'trend-active', 'trend-edge', 'trend-recent']);
  assert.equal(pruneMeta(meta, new Set(['trend-active', 'one']), NOW), 0, 'idempotent');
});

test('the saved record is never grown or rewritten by the cleanup; the entries that stay are the same objects', () => {
  const keep = { last: NOW - H, ok: true, count: 5 };
  const meta = { 'trend-x': keep, 'trend-old': { last: 0 } };
  pruneMeta(meta, new Set(), NOW);
  assert.equal(meta['trend-x'], keep);
  assert.deepEqual(Object.keys(meta), ['trend-x']);
  assert.deepEqual(pruneMeta({}, new Set(), NOW), 0);
});

test('a source due-ness is unchanged by the cleanup: the rule of src/collect.js reads only the entry of that source', () => {
  const due = (meta, id, every, now) => { const m = meta[id]; if (!m) return true; if (m.cooldownUntil && now < m.cooldownUntil) return false; return now - (m.last || 0) >= every * 60000 - 15000; };
  const meta = { a: { last: NOW - 2 * 60000 }, b: { last: NOW - 3 * 60000, cooldownUntil: NOW + 1 }, 'trend-old': { last: NOW - 9 * 24 * H }, 'trend-recent': { last: NOW - 60000 } };
  const before = ['a', 'b', 'trend-recent', 'trend-old', 'trend-new'].map((id) => due(meta, id, 1, NOW));
  pruneMeta(meta, new Set(['a', 'b', 'trend-recent']), NOW);
  const after = ['a', 'b', 'trend-recent', 'trend-old', 'trend-new'].map((id) => due(meta, id, 1, NOW));
  assert.deepEqual(after.slice(0, 3), before.slice(0, 3), 'active sources keep their schedule');
  assert.equal(before[3], true, 'a stale entry is overdue anyway: it was due, and becomes "new", which is due too');
  assert.equal(after[3], true);
});

test('stage timer: laps are measured between marks with a fixed set of keys; a repeated mark adds up; total covers everything', () => {
  let t = 1000;
  const clock = () => t;
  const timer = stageTimer(clock);
  t += 10; timer.mark('fetch');
  t += 5; timer.mark('parse');
  t += 7; timer.mark('fetch');
  t += 3;
  assert.deepEqual(timer.ms(), { fetch: 17, parse: 5 });
  assert.equal(timer.line(), '[timing] {"fetch":17,"parse":5,"total":25}');
});
