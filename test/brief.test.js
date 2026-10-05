import { test } from 'node:test';
import assert from 'node:assert/strict';
import { briefingTop, morningBrief } from '../src/telegram.js';

// 2026-10-05 07:30 Israel time (UTC+3)
const now = Date.parse('2026-10-05T04:30:00Z');
const story = (id, score, extra = {}) => ({ id, score, first: now - 3 * 3600e3, sport: 'football', ...extra });

test('the brief is world first: at most 3 Israeli stories, nothing older than the night', () => {
  const stories = [
    ...Array.from({ length: 6 }, (_, i) => story(`il${i}`, 100 - i, { israel: true })),
    ...Array.from({ length: 9 }, (_, i) => story(`w${i}`, 50 - i)),
    story('old', 999, { first: now - 14 * 3600e3 }),
    story('nodate', 999, { dateUnknown: true }),
  ];
  const top = briefingTop(stories, now).map((s) => s.id);
  assert.equal(top.length, 10);
  assert.equal(top.filter((id) => id.startsWith('il')).length, 3);
  assert.ok(!top.includes('old') && !top.includes('nodate'));
});

test('the site brief is fixed once a day, from 07:00 until noon', () => {
  const stories = Array.from({ length: 5 }, (_, i) => story(`w${i}`, 50 - i));
  const b = morningBrief(stories, null, now);
  assert.equal(b.day, '2026-10-05');
  assert.deepEqual(b.ids, ['w0', 'w1', 'w2', 'w3', 'w4']);
  // later the same morning: same list even if the ranking changed
  assert.equal(morningBrief([story('new', 999), ...stories], b, now + 3600e3), b);
  // before 07:00 and from noon: nothing
  assert.equal(morningBrief(stories, null, Date.parse('2026-10-05T03:30:00Z')), null);
  assert.equal(morningBrief(stories, b, Date.parse('2026-10-05T09:10:00Z')), null);
});
