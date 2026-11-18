import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixClock12, settleClock12, plus12, zoneOffsetMs, WINDOW_BEFORE_MS } from '../src/feedtime.js';

// Feeds whose clock loses the PM (voetbalkrant, walfoot): the rule corrects only an article that is NEW and whose feed date plus 12 hours lands in
// the last 30 minutes. Times are exact epochs so daylight-saving edges are real.
const H = 3600e3;
const MIN = 60e3;
const BRU = 'Europe/Brussels';
const NOW = Date.UTC(2026, 9, 19, 15, 0, 0); // 2026-10-19 15:00 UTC (summer time in Brussels)

test('a date that was right (a morning article, a few minutes old) is never touched: plus 12 hours would be in the future', () => {
  for (const ageMin of [0, 1, 5, 20, 90, 6 * 60, 11 * 60]) assert.equal(fixClock12(NOW - ageMin * MIN, NOW, BRU), NOW - ageMin * MIN, `${ageMin} min`);
  assert.equal(fixClock12(NOW + 2 * MIN, NOW, BRU), NOW + 2 * MIN, 'a date slightly ahead is clock skew, not a lost PM');
});

test('a lost PM is restored: the article is dated 12 hours (plus its few minutes) too early', () => {
  assert.equal(fixClock12(NOW - 12 * H - 1 * MIN, NOW, BRU), NOW - 1 * MIN);
  assert.equal(fixClock12(NOW - 12 * H - 0 * MIN, NOW, BRU), NOW);
  assert.equal(fixClock12(NOW - 12 * H - 29 * MIN, NOW, BRU), NOW - 29 * MIN);
  assert.equal(fixClock12(NOW - 12 * H + 3 * MIN, NOW, BRU), NOW + 3 * MIN, 'up to 5 minutes ahead is accepted');
});

test('the correction is conservative: dates that do not land in the last 30 minutes stay as the feed gave them', () => {
  const edge = NOW - 12 * H - WINDOW_BEFORE_MS;
  assert.equal(fixClock12(edge, NOW, BRU), NOW - WINDOW_BEFORE_MS, 'exactly at the edge');
  assert.equal(fixClock12(edge - 1 * MIN, NOW, BRU), edge - 1 * MIN, 'a minute beyond: left alone');
  assert.equal(fixClock12(NOW - 12 * H + 6 * MIN, NOW, BRU), NOW - 12 * H + 6 * MIN, 'more than 5 minutes ahead after correcting: left alone');
  assert.equal(fixClock12(NOW - 20 * H, NOW, BRU), NOW - 20 * H, 'a genuinely old article (8 hours after correcting) is not moved');
  assert.equal(fixClock12(NOW - 36 * H, NOW, BRU), NOW - 36 * H);
  assert.equal(fixClock12(NOW - 12 * H - 3 * H, NOW, BRU), NOW - 15 * H, 'an evening article first seen 3 hours late stays wrong rather than guessed');
});

test('invalid input comes back unchanged', () => {
  assert.equal(fixClock12(null, NOW, BRU), null);
  assert.equal(fixClock12(undefined, NOW, BRU), undefined);
  assert.ok(Number.isNaN(fixClock12(NaN, NOW, BRU)));
  assert.equal(fixClock12(NOW - 12 * H, NaN, BRU), NOW - 12 * H);
});

test('daylight saving: the zone offsets, and 12 hours of wall clock across a change (11 or 13 elapsed hours)', () => {
  assert.equal(zoneOffsetMs(Date.UTC(2026, 6, 1, 12), BRU), 2 * H);
  assert.equal(zoneOffsetMs(Date.UTC(2026, 11, 1, 12), BRU), 1 * H);
  assert.equal(zoneOffsetMs(Date.UTC(2026, 9, 25, 0, 59), BRU), 2 * H, 'before the change of 2026-10-25 01:00 UTC');
  assert.equal(zoneOffsetMs(Date.UTC(2026, 9, 25, 1, 0), BRU), 1 * H, 'from the change on');
  // no change between the two instants: one reading
  assert.deepEqual(plus12(Date.UTC(2026, 9, 19, 1), BRU), [Date.UTC(2026, 9, 19, 13)]);
  // autumn change: 12 hours on the wall clock are 13 elapsed hours
  assert.deepEqual(plus12(Date.UTC(2026, 9, 25, 0, 30), BRU), [Date.UTC(2026, 9, 25, 12, 30), Date.UTC(2026, 9, 25, 13, 30)]);
  // spring change: 12 hours on the wall clock are 11 elapsed hours
  assert.deepEqual(plus12(Date.UTC(2026, 2, 29, 0, 30), BRU), [Date.UTC(2026, 2, 29, 12, 30), Date.UTC(2026, 2, 29, 11, 30)]);
  assert.deepEqual(plus12(Date.UTC(2026, 9, 25, 0, 30)), [Date.UTC(2026, 9, 25, 12, 30)], 'without a zone only the flat reading');
});

test('daylight saving, autumn: an evening article of 2026-10-25 (14:30 Brussels, 13:30 UTC) dated 02:30 wall clock before the change is restored', () => {
  const now = Date.UTC(2026, 9, 25, 13, 31);
  const raw = Date.UTC(2026, 9, 25, 0, 30); // 02:30 CEST: 13 elapsed hours before the true time
  assert.equal(fixClock12(raw, now, BRU), Date.UTC(2026, 9, 25, 13, 30));
  assert.equal(fixClock12(raw, now), raw, 'a plain 12-hour shift would miss it (61 minutes): the zone is what finds it');
  const after = Date.UTC(2026, 9, 25, 1, 30); // 02:30 CET, after the change: exactly 12 elapsed hours
  assert.equal(fixClock12(after, now, BRU), Date.UTC(2026, 9, 25, 13, 30));
  assert.equal(fixClock12(after, now), Date.UTC(2026, 9, 25, 13, 30));
});

test('daylight saving, spring: an afternoon article of 2026-03-29 (13:30 Brussels, 11:30 UTC) dated 01:30 wall clock before the change is restored', () => {
  const now = Date.UTC(2026, 2, 29, 11, 31);
  const raw = Date.UTC(2026, 2, 29, 0, 30); // 01:30 CET: 11 elapsed hours before the true time
  assert.equal(fixClock12(raw, now, BRU), Date.UTC(2026, 2, 29, 11, 30));
  assert.equal(fixClock12(raw, now), raw, 'without the zone it would land 59 minutes in the future and be refused');
});

test('a normal day with no change: the zone makes no difference', () => {
  for (const tz of [undefined, BRU, 'Asia/Jerusalem']) assert.equal(fixClock12(NOW - 12 * H - 2 * MIN, NOW, tz), NOW - 2 * MIN);
});

test('settleClock12: the first read of a source is never corrected (everything in the feed is old)', () => {
  const raw = NOW - 12 * H - 1 * MIN;
  assert.deepEqual(settleClock12({ published: raw, now: NOW, tz: BRU, firstRead: true }), { published: raw, feedPublished: null });
});

test('settleClock12: a new article is corrected and the feed\'s own date is kept; a right date is left and keeps nothing', () => {
  const wrong = NOW - 12 * H - 1 * MIN;
  assert.deepEqual(settleClock12({ published: wrong, now: NOW, tz: BRU }), { published: NOW - 1 * MIN, feedPublished: wrong });
  assert.deepEqual(settleClock12({ published: NOW - 2 * MIN, now: NOW, tz: BRU }), { published: NOW - 2 * MIN, feedPublished: null });
  assert.deepEqual(settleClock12({ published: null, now: NOW, tz: BRU }), { published: null, feedPublished: null });
});

test('settleClock12: an article seen before keeps the time it was given, run after run (the feed repeats its wrong date; the correction only fits while it is fresh)', () => {
  const wrong = NOW - 12 * H - 1 * MIN;
  const first = settleClock12({ published: wrong, now: NOW, tz: BRU });
  const prev = { published: first.published, feedPublished: first.feedPublished };
  for (const later of [5 * MIN, 10 * MIN, 45 * MIN, 6 * H]) {
    assert.deepEqual(settleClock12({ published: wrong, now: NOW + later, tz: BRU, prev }), { published: NOW - 1 * MIN, feedPublished: wrong }, `${later / MIN} min later`);
  }
  assert.equal(fixClock12(wrong, NOW + 45 * MIN, BRU), wrong, 'the bare rule alone would lose the correction after 30 minutes, which is why the first time is kept');
  // an article first seen as a right date stays right
  assert.deepEqual(settleClock12({ published: NOW - 3 * MIN, now: NOW + 10 * MIN, tz: BRU, prev: { published: NOW - 3 * MIN } }), { published: NOW - 3 * MIN, feedPublished: null });
  // an article known from another route (e.g. a Google copy with its own date) keeps that date
  assert.deepEqual(settleClock12({ published: wrong, now: NOW, tz: BRU, prev: { published: NOW - 7 * MIN } }), { published: NOW - 7 * MIN, feedPublished: null });
  // a known article whose date was only a guess (unknown) is evaluated afresh
  assert.deepEqual(settleClock12({ published: wrong, now: NOW, tz: BRU, prev: { published: NOW - 12 * H, dateUnknown: true } }), { published: NOW - 1 * MIN, feedPublished: wrong });
});
