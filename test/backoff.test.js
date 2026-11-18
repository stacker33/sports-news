import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRetryAfter, failureKind, cooldownMs, recordFailure, BASE_MS, RATE_CAP_MS, RETRY_AFTER_CAP_MS, ACCESS_CAP_MS } from '../src/backoff.js';

const MIN = 60e3;
const H = 60 * MIN;
const NOW = Date.UTC(2026, 10, 18, 12, 0, 0);
const http = (status, retryAfter = null) => Object.assign(new Error(`HTTP ${status}`), { status, retryAfter });

test('Retry-After: seconds, an HTTP date, nonsense, and a bound on absurd values', () => {
  assert.equal(parseRetryAfter('120'), 120e3);
  assert.equal(parseRetryAfter(' 0 '), 0);
  assert.equal(parseRetryAfter(new Date(NOW + 90 * MIN).toUTCString(), NOW), 90 * MIN);
  assert.equal(parseRetryAfter(new Date(NOW - 5 * MIN).toUTCString(), NOW), 0, 'a date in the past: no wait');
  assert.equal(parseRetryAfter('soon'), null);
  assert.equal(parseRetryAfter(''), null);
  assert.equal(parseRetryAfter(null), null);
  assert.equal(parseRetryAfter('99999999999'), 30 * 864e5, 'bounded');
});

test('what kind of failure: 429 is a rate limit, 401 / 403 / 404 / 410 are access, everything else is transient', () => {
  assert.equal(failureKind(http(429)), 'rate');
  for (const s of [401, 403, 404, 410]) assert.equal(failureKind(http(s)), 'access', String(s));
  for (const s of [500, 502, 503, 504, 520]) assert.equal(failureKind(http(s)), 'transient', String(s));
  assert.equal(failureKind(new Error('The operation was aborted due to timeout')), 'transient');
  assert.equal(failureKind(new Error('fetch failed')), 'transient');
  assert.equal(failureKind(new Error('Invalid XML')), 'transient');
  assert.equal(failureKind({ message: 'HTTP 403' }), 'access', 'from the text, as in a record saved before this change');
  assert.equal(failureKind({ message: 'HTTP 404, page backup empty' }), 'access');
  assert.equal(failureKind({ message: 'HTTP 429' }), 'rate');
  assert.equal(failureKind(undefined), 'transient');
});

test('transient failures keep the flat 15-minute cooldown, however many', () => {
  for (const streak of [1, 2, 10, 500]) assert.equal(cooldownMs({ kind: 'transient', streak, failingForMs: 99 * H }), BASE_MS);
});

test('rate limits double up to 3 hours; Retry-After is respected up to 12 hours and never shortens the doubling', () => {
  const w = (streak, retryAfterMs) => cooldownMs({ kind: 'rate', streak, failingForMs: 0, retryAfterMs });
  assert.deepEqual([1, 2, 3, 4, 5, 6, 20].map((n) => w(n) / MIN), [15, 30, 60, 120, 180, 180, 180]);
  assert.equal(w(1, 2 * H), 2 * H, 'the server asked for 2 hours');
  assert.equal(w(1, 5 * MIN), 15 * MIN, 'a shorter Retry-After does not shorten the wait');
  assert.equal(w(5, 10 * MIN), 3 * H);
  assert.equal(w(1, 30 * H), RETRY_AFTER_CAP_MS, 'a day-long Retry-After is bounded to 12 hours');
  assert.equal(w(1, 0), 15 * MIN);
});

test('access failures: a new source or a short failure keeps 15 minutes; after 3 failures over an hour the wait doubles up to 24 hours, never more', () => {
  const w = (streak, failingForMs) => cooldownMs({ kind: 'access', streak, failingForMs });
  assert.equal(w(1, 0), 15 * MIN);
  assert.equal(w(2, 15 * MIN), 15 * MIN);
  assert.equal(w(3, 30 * MIN), 15 * MIN, 'three failures but under an hour: not penalised yet');
  assert.equal(w(3, 61 * MIN), 30 * MIN);
  assert.deepEqual([3, 4, 5, 6, 7, 8, 9, 10, 50].map((n) => w(n, 99 * H) / MIN), [30, 60, 120, 240, 480, 960, 1440, 1440, 1440]);
  assert.equal(w(1e9, 1e12), ACCESS_CAP_MS);
});

test('recordFailure: a 403 from the first failure on - the wait grows, the source is asked about once a day at the end, never switched off', () => {
  let meta;
  let now = NOW;
  const asks = [];
  const end = NOW + 7 * 24 * H;
  while (now < end) {
    asks.push(now);
    meta = recordFailure(meta, http(403), now);
    now = Math.max(meta.cooldownUntil, now + 5 * MIN); // the collector runs every 5 minutes and skips a source until its cooldown has passed
    now = Math.ceil((now - NOW) / (5 * MIN)) * 5 * MIN + NOW;
  }
  assert.ok(asks.length <= 20, `${asks.length} requests in 7 days (the flat cooldown made ${7 * 24 * 4})`);
  assert.ok(meta.cooldownUntil - meta.last <= ACCESS_CAP_MS && Number.isFinite(meta.cooldownUntil), 'never longer than 24 hours: never disabled');
  assert.equal(meta.failKind, 'access');
  assert.equal(meta.ok, false);
  const gaps = asks.slice(1).map((t, i) => t - asks[i]);
  assert.ok(gaps.slice(0, 2).every((g) => g <= 20 * MIN), 'the first retries are as quick as before');
  assert.ok(gaps.at(-1) >= 12 * H, 'the last ones about daily');
});

test('recordFailure: a different kind of failure starts a new streak; a transient one never escalates', () => {
  let m = recordFailure(undefined, http(403), NOW);
  m = recordFailure(m, http(403), NOW + 20 * MIN);
  m = recordFailure(m, http(403), NOW + 80 * MIN); // third failure, over an hour: now it waits longer
  assert.equal(m.kindStreak, 3);
  assert.equal(m.cooldownUntil - (NOW + 80 * MIN), 30 * MIN);
  const r = recordFailure(m, http(429, 3 * H), NOW + 2 * H);
  assert.equal(r.failKind, 'rate');
  assert.equal(r.kindStreak, 1);
  assert.equal(r.cooldownUntil - (NOW + 2 * H), 3 * H, 'Retry-After respected');
  assert.equal(r.failStreak, 4, 'the overall count of consecutive failures keeps counting (health display)');
  let t;
  for (let i = 0; i < 200; i++) t = recordFailure(t, http(503), NOW + i * 15 * MIN);
  assert.equal(t.cooldownUntil - t.last, BASE_MS);
});

test('recordFailure: records saved before this change (no kind, no streak) are read from failStreak and the error text', () => {
  const dead = { last: NOW - 15 * MIN, ok: false, error: 'HTTP 403', failStreak: 980, cooldownUntil: NOW - 1, okOnce: true };
  const r = recordFailure(dead, http(403), NOW);
  assert.equal(r.cooldownUntil - NOW, 24 * H, 'a source that has failed 980 times goes straight to the long wait');
  assert.equal(r.failStreak, 981);
  assert.equal(r.okOnce, true, 'the rest of the record is kept');
  const fresh = { last: NOW - 15 * MIN, ok: false, error: 'HTTP 403', failStreak: 1, cooldownUntil: NOW - 1 };
  assert.equal(recordFailure(fresh, http(403), NOW).cooldownUntil - NOW, 15 * MIN, 'one old failure is not penalised');
  assert.equal(recordFailure({ ok: false, error: 'HTTP 503', failStreak: 500 }, http(503), NOW).cooldownUntil - NOW, 15 * MIN);
});

test('recovery: after a success the caller replaces the record, so the next failure starts from the start (and a healthy record is never penalised)', () => {
  const healthy = { last: NOW, ok: true, okOnce: true, count: 20, lastOk: NOW, failStreak: 0 };
  const r = recordFailure(healthy, http(403), NOW + 5 * MIN);
  assert.equal(r.kindStreak, 1);
  assert.equal(r.cooldownUntil - (NOW + 5 * MIN), 15 * MIN, 'the first failure of a healthy feed waits the old 15 minutes');
  assert.equal(r.lastOk, NOW);
  // a new source (never read) that fails twice and then answers
  let n = recordFailure(undefined, http(404), NOW);
  n = recordFailure(n, http(404), NOW + 15 * MIN);
  assert.equal(n.cooldownUntil - (NOW + 15 * MIN), 15 * MIN);
});

test('a due check on the record: a failing source is skipped until its cooldown passes, a healthy one is never skipped', () => {
  const due = (m, now) => !m || !(m.cooldownUntil && now < m.cooldownUntil); // the rule of src/collect.js
  const m = recordFailure(recordFailure(recordFailure(undefined, http(403), NOW), http(403), NOW + 20 * MIN), http(403), NOW + 80 * MIN);
  assert.equal(due(m, NOW + 100 * MIN), false);
  assert.equal(due(m, NOW + 80 * MIN + 30 * MIN + 1), true);
  assert.equal(due({ last: NOW, ok: true, failStreak: 0 }, NOW + MIN), true);
});

test('constants: the bounds', () => {
  assert.equal(BASE_MS, 15 * MIN);
  assert.equal(RATE_CAP_MS, 3 * H);
  assert.equal(RETRY_AFTER_CAP_MS, 12 * H);
  assert.equal(ACCESS_CAP_MS, 24 * H);
});
