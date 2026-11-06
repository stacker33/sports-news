import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rising } from '../src/cluster.js';

const now = Date.parse('2026-11-06T12:00:00Z');
const min = 60e3;
const art = (publisher, ago, extra = {}) => ({ publisher, published: now - ago * min, ...extra });

test('picking up speed: 4+ outlets in the last 30 minutes, at least half of all outlets', () => {
  const r = rising([art('Marca', 5), art('AS', 10), art('Sport', 15), art('Mundo Deportivo', 25), art('ESPN', 120)], now);
  assert.deepEqual(r, { rise: { n: 4, at: now } });
});

test('not picking up: only 3 new, one outlet many times, old story with a few new, unknown dates', () => {
  assert.equal(rising([art('Marca', 5), art('AS', 10), art('Sport', 15)], now), null);
  assert.equal(rising([art('Marca', 5), art('Marca', 6), art('marca', 7), art('MARCA', 8)], now), null); // one outlet
  const old = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'].map((p) => art(p, 300));
  assert.equal(rising([...old, art('Marca', 5), art('AS', 10), art('Sport', 15), art('ESPN', 20)], now), null); // 4 of 14
  assert.equal(rising([art('a', 5, { dateUnknown: true }), art('b', 5, { dateUnknown: true }), art('c', 5), art('d', 5), art('e', 5)], now), null);
  // an outlet that published earlier and again now is not new
  assert.equal(rising([art('Marca', 200), art('Marca', 5), art('AS', 10), art('Sport', 15), art('ESPN', 20)], now), null);
});
