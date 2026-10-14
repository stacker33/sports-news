import { test } from 'node:test';
import assert from 'node:assert/strict';
import { briefingTop } from '../src/telegram.js';
import { attachDesk } from '../src/ai.js';

const now = Date.parse('2026-10-13T03:30:00Z'); // 06:30 Israel time
const st = (id, score, he, extra = {}) => ({ id, score, first: now - 6 * 3600e3, sport: 'football', title: he, ai: { he: { title: he } }, tags: [], ...extra });
const cov = [{ k: 'team', id: 't24' }, { k: 'team', id: 't116' }];

test('night summary: one place per event, the result over the preview, no live updates or stream links', () => {
  const top = briefingTop([
    st('preview', 90, 'קובנטרי מארחת את ניוקאסל בפרמייר ליג', { tags: cov }),
    st('result', 60, 'חגיגה בקובנטרי: 1:4 אדיר על ניוקאסל', { tags: cov }),
    st('live', 80, 'דקה 31: לבאנטה - סביליה 1:0'),
    st('stream', 70, 'צפו בשידור: מכבי אשדוד - עירוני נס ציונה'),
    st('jordan', 50, 'חולצה של מייקל ג׳ורדן נמכרה ב-14 מיליון דולר'),
  ], now).map((s) => s.id);
  assert.deepEqual(top, ['result', 'jordan']);
});

test('the AI corrects the sport: hockey read as basketball moves, a non-sport story is collapsed, Israelis keep theirs', () => {
  const mk = (id, sport, extra = {}) => ({ id, sport, _members: [{ id: `m-${id}`, published: 1 }], ...extra });
  const desk = { 'm-wild': { sport: 'other', desk: false }, 'm-actor': { sport: 'none', desk: false }, 'm-il': { sport: 'other', desk: true } };
  const [wild, actor, il] = attachDesk([mk('wild', 'basketball'), mk('actor', 'basketball'), mk('il', 'basketball', { israel: true })], { desk });
  assert.equal(wild.sport, 'other');
  assert.equal(wild.aiDesk, undefined); // the off-beat rules are for football / basketball
  assert.equal(actor.low, true);
  assert.equal(il.sport, 'basketball');
});
