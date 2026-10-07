import { test } from 'node:test';
import assert from 'node:assert/strict';
import { alertDue } from '../src/watchdog.js';

test('watchdog alerts at once, then after 2h and 6h, then every 24h', () => {
  const t0 = Date.parse('2026-10-07T09:00:00Z');
  const h = (n) => t0 + n * 3600e3;
  assert.equal(alertDue({}, t0), true); // first: at once
  const after1 = { firstAlert: t0, lastAlert: t0, alerts: 1 };
  assert.equal(alertDue(after1, h(1)), false);
  assert.equal(alertDue(after1, h(2)), true); // 2h
  const after2 = { firstAlert: t0, lastAlert: h(2), alerts: 2 };
  assert.equal(alertDue(after2, h(5)), false);
  assert.equal(alertDue(after2, h(6)), true); // 6h
  const after3 = { firstAlert: t0, lastAlert: h(6), alerts: 3 };
  assert.equal(alertDue(after3, h(20)), false);
  assert.equal(alertDue(after3, h(24)), true); // 24h
  const after4 = { firstAlert: t0, lastAlert: h(24), alerts: 4 };
  assert.equal(alertDue(after4, h(40)), false);
  assert.equal(alertDue(after4, h(48)), true); // then every 24h
});
