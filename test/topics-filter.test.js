import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextUserSearches, userSearchSources, TOPIC_DAYS, FOLLOW_HOURS } from '../src/trends.js';
import { markLow } from '../src/editorial.js';

test('a "my topics" search is kept for days while renewed; a plain follow ends after 6 hours', () => {
  const t0 = Date.parse('2026-10-12T08:00:00Z');
  let st = nextUserSearches({}, [{ q: 'Avdija', topic: true }, { q: 'Lavi' }], t0);
  assert.equal(st.avdija.topic, true);
  st = nextUserSearches(st, [], t0 + (FOLLOW_HOURS + 1) * 3600e3);
  assert.ok(st.avdija && !st.lavi); // the follow expired, the topic did not
  // renewed daily: still there after a week
  for (let d = 1; d <= 7; d++) st = nextUserSearches(st, [{ q: 'Avdija', topic: true }], t0 + d * 864e5);
  assert.ok(st.avdija);
  // not renewed (deleted): gone after TOPIC_DAYS
  st = nextUserSearches(st, [], t0 + (7 + TOPIC_DAYS) * 864e5 + 1);
  assert.ok(!st.avdija);
});

test('a topic searches Hebrew, English and four European languages', () => {
  const langs = userSearchSources({ avdija: { since: 0, topic: true } }).map((s) => s.lang).sort();
  assert.deepEqual(langs, ['de', 'en', 'es', 'fr', 'he', 'it']);
  assert.equal(userSearchSources({ lavi: { since: 0 } }).length, 2); // a plain follow: Hebrew + English
});

test('tickets, polls and live streams are flagged low in any language, unless an Israeli is in them', () => {
  assert.equal(markLow({ title: 'Στο πλευρό του Κώστα Λίμα ο ΠΣΑΠΠ – Αγόρασε εισιτήρια για το ματς' }).low, true);
  assert.equal(markLow({ title: 'Assista em direto ao treino do Sporting' }).low, true);
  assert.equal(markLow({ title: 'Sondaggio: chi deve giocare titolare?' }).low, true);
  assert.equal(markLow({ title: 'Barcelona sign new striker' }).low, undefined);
  assert.equal(markLow({ title: 'Buy tickets: Maccabi in Madrid', israel: true }).low, undefined);
});
