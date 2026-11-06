import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tallyDay, weeklyReport, sourceReportStep } from '../src/sourcereport.js';

const at = (iso) => Date.parse(iso);
const m = (sourceId, publisher, t) => ({ sourceId, publisher, published: at(t) });
const names = { a: 'Scoop FC', b: 'Big Paper', c: 'Other Paper', n: 'Noise Blog' };
const nameOf = (id) => names[id];

test('tally: confirmed, first, alone, Sport5, 👎 and articles that never reach the site', () => {
  const stories = [
    { id: 's1', first: at('2026-11-05T08:00:00Z'), s5: { at: 1 }, _members: [m('a', 'Scoop', '2026-11-05T08:00:00Z'), m('b', 'Big', '2026-11-05T09:00:00Z'), m('c', 'Other', '2026-11-05T10:00:00Z')] },
    { id: 's2', first: at('2026-11-05T12:00:00Z'), _members: [m('n', 'Noise', '2026-11-05T12:00:00Z')] },
    { id: 'old', first: at('2026-11-03T12:00:00Z'), _members: [m('n', 'Noise', '2026-11-03T12:00:00Z')] }, // another day
  ];
  const items = [...stories.flatMap((s) => s._members), m('c', 'Other', '2026-11-05T13:00:00Z')];
  const t = tallyDay('2026-11-05', { stories, items, nameOf, votes: { s2: { up: [], down: ['d1', 'd2'] } } });
  assert.deepEqual(t['Scoop FC'], { got: 1, shown: 1, conf: 1, first: 1, alone: 0, s5: 1, down: 0 });
  assert.deepEqual(t['Big Paper'], { got: 1, shown: 1, conf: 1, first: 0, alone: 0, s5: 1, down: 0 });
  assert.deepEqual(t['Noise Blog'], { got: 1, shown: 1, conf: 0, first: 0, alone: 1, s5: 0, down: 2 });
  assert.equal(t['Other Paper'].got, 2);
});

test('report: scoops, reliable, maybe noise, 👎, silent; small sources are not judged', () => {
  const day = { 'Scoop FC': { got: 40, shown: 20, conf: 12, first: 6, alone: 2, s5: 3, down: 0 }, 'Noise Blog': { got: 50, shown: 15, conf: 0, first: 0, alone: 14, s5: 0, down: 4 }, 'Dead Feed': { got: 60, shown: 0, conf: 0, first: 0, alone: 0, s5: 0, down: 0 }, Tiny: { got: 3, shown: 3, conf: 0, first: 0, alone: 3, s5: 0, down: 0 } };
  const msg = weeklyReport({ '2026-11-05': day });
  assert.match(msg, /סקופים[^]*Scoop FC: 6 פעמים ראשונים/);
  assert.match(msg, /אמינים[^]*Scoop FC: 60% מ-20 ידיעות/);
  assert.match(msg, /אולי רעש[^]*Noise Blog: 93% לבד מ-15 ידיעות/);
  assert.match(msg, /👎[^]*Noise Blog: 4 👎/);
  assert.match(msg, /Dead Feed: 60 ידיעות, 0 באתר/);
  assert.doesNotMatch(msg, /Tiny/);
  assert.match(msg, /שום מקור לא הוסר/);
});

test('step: yesterday tallied once after 07:00; Sunday report once, only with 3+ days', () => {
  const data = { stories: [], items: [], nameOf };
  const early = sourceReportStep(at('2026-11-05T03:00:00Z'), {}, data); // 05:00 Israel
  assert.deepEqual(early.srcReport.days, {});
  const thu = sourceReportStep(at('2026-11-05T06:00:00Z'), {}, data); // 08:00 Israel, Thursday
  assert.ok(thu.srcReport.days['2026-11-04']);
  assert.equal(thu.message, null);
  const days = { '2026-11-04': {}, '2026-11-05': {}, '2026-11-06': {} };
  const sun = sourceReportStep(at('2026-11-08T06:00:00Z'), { days }, data); // Sunday 08:00
  assert.match(sun.message, /דוח מקורות שבועי/);
  assert.equal(sourceReportStep(at('2026-11-08T07:00:00Z'), sun.srcReport, data).message, null); // once
  assert.equal(sourceReportStep(at('2026-11-08T06:00:00Z'), { days: { '2026-11-07': {} } }, data).message, null); // 1-2 days wait
  const many = Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`2026-10-${10 + i}`, {}]));
  assert.equal(Object.keys(sourceReportStep(at('2026-11-05T06:00:00Z'), { days: many }, data).srcReport.days).length, 8);
});
