import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as current from '../src/ai.js';
import * as before from './fixtures/before-rich/ai.js';

// The feature flag AI_RICH_SUMMARIES. OFF (the default) must behave exactly like production before the feature: the same requests (system and user
// text, number, models), the same saved result, the same decisions about who is asked again. test/fixtures/before-rich/ai.js is a frozen copy of the
// production src/ai.js (33ed5c2); the same stories go through both modules and the results are compared.
process.env.AI_API_KEY = 'test';
delete process.env.AI_RICH_SUMMARIES;
const T = Date.parse('2026-11-14T10:00:00Z');
let n = 0;
const art = (publisher, title, extra = {}) => ({ id: `f${++n}`, title, publisher, lang: 'en', published: T + n * 60e3, weight: 1, google: false, ents: [], sport: 'football', ...extra });
const story = (members) => ({ id: members[0].id, title: members[0].title, lang: 'en', first: Math.min(...members.map((m) => m.published)), score: 5, sport: 'football', sourceCount: new Set(members.map((m) => m.publisher)).size, _members: members, tags: [] });

const realFetch = globalThis.fetch;
function mockModel(handler = () => null) {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    const system = body.messages[0].content, user = body.messages[1].content;
    const kind = /story cards/.test(system) ? 'cards' : /numbered sports headlines/.test(system) ? 'heads' : 'summary';
    calls.push({ kind, system, user, model: body.model });
    const err = handler(kind, calls.length);
    if (err) return { ok: false, status: err, text: async () => `HTTP error ${err} quota` };
    const ids = [...user.matchAll(/### id: (\w+)/g)].map((m) => m[1]);
    const content = kind === 'summary'
      ? { stories: ids.map((id) => ({ id, title_he: 'כותרת בעברית לבדיקה', summary_he: 'סיכום בעברית של הסיפור לבדיקה בלבד.', summary_en: 'Test summary.', facts_he: ['עובדה אחת בעברית'] })) }
      : kind === 'cards' ? { items: [] } : { titles: [] };
    return { ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) } }], usage: { total_tokens: 100 } }) };
  };
  return calls;
}
const same = (a, b) => JSON.stringify(a);
// run one sequence of (stories, time) steps through a module with a fresh mock; the state is carried between steps
async function sequence(mod, steps, handler) {
  const calls = mockModel(handler);
  let st = {};
  const shown = [];
  try {
    for (const [stories, t] of steps) {
      const r = await mod.aiSummaries(stories, {}, st, t, new Map(), {});
      st = r.ai;
      shown.push(stories.map((s) => s.ai || null));
    }
  } finally { globalThis.fetch = realFetch; }
  const strip = (o) => JSON.parse(JSON.stringify(o, (k, v) => (k === 'hourly' ? undefined : v)));
  return { calls, st: strip(st), shown };
}
const both = async (build, handler) => {
  const steps = build();
  const a = await sequence(current, JSON.parse(JSON.stringify(steps)), handler); // the same articles, a separate copy for each module
  const b = await sequence(before, JSON.parse(JSON.stringify(steps)), handler);
  return [a, b];
};

const transfer = () => [
  art('The Athletic', 'Real Madrid agree deal for Smith, fee around €40m'),
  art('Marca', 'Real Madrid agree deal for Smith, fee around €40m', { lang: 'es' }),
  art('Sky Sports', 'Smith set for Real Madrid medical, deal worth €50m', { summary: 'The 22-year-old will sign a contract until 2030 after a medical on Monday, according to sources close to the club.' }),
  art('Real Madrid · Official', 'Real Madrid C.F. announce the signing of Smith', { official: true }),
  art('Fabrizio Romano', 'Smith to Real Madrid, here we go', { reporter: true }),
  art('Rugby Daily', 'Pau - Leicester, Champions Cup rugby live from the stadium'), // a stray page
];

test('the flag is off unless it is explicitly turned on', () => {
  for (const v of [undefined, '', '0', 'off', 'false', 'no', 'maybe']) { if (v === undefined) delete process.env.AI_RICH_SUMMARIES; else process.env.AI_RICH_SUMMARIES = v; assert.equal(current.richEnabled(), false, String(v)); }
  for (const v of ['1', 'true', 'ON', 'Yes', ' 1 ']) { process.env.AI_RICH_SUMMARIES = v; assert.equal(current.richEnabled(), true, v); }
  delete process.env.AI_RICH_SUMMARIES;
});

test('OFF: a new multi-outlet story sends exactly the production request and saves exactly the production result', async () => {
  const [a, b] = await both(() => [[[story(transfer())], T + 3600e3]]);
  assert.deepEqual(a.calls.map((c) => [c.kind, c.model, c.system, c.user]), b.calls.map((c) => [c.kind, c.model, c.system, c.user]));
  assert.ok(a.calls.some((c) => c.kind === 'summary'));
  assert.deepEqual(a.st.res, b.st.res);
  assert.equal(Object.values(a.st.res)[0].rv, undefined); // none of the new fields
  assert.equal(Object.values(a.st.res)[0].sig, undefined);
  assert.equal(Object.values(a.st.res)[0].rich, undefined);
  assert.equal(a.st.rich, undefined);
  assert.deepEqual(a.shown, b.shown);
  assert.equal(a.st.used, b.st.used);
  assert.doesNotMatch(a.calls.find((c) => c.kind === 'summary').user, /Sources \(/);
  assert.match(a.calls.find((c) => c.kind === 'summary').user, /Leicester/); // the old input is unfiltered, as before
});

test('OFF: the earlier refresh rule only (the outlet count doubling); a new official source or amount asks for nothing, as before', async () => {
  const base = () => transfer().slice(0, 3);
  // 3 outlets, then 4 with an official source (no doubling), then 7 outlets (doubled and +3 or more) two hours later
  const [a, b] = await both(() => {
    const m3 = base();
    const m4 = [...m3, art('Club', 'Smith signs: official announcement, €60m fee', { official: true })];
    const m7 = [...m4, art('A1', 'Smith joins Real Madrid'), art('A2', 'Smith at Real Madrid'), art('A3', 'Smith Real Madrid move')];
    return [[[story(m3)], T + 3600e3], [[story(m4)], T + 2 * 3600e3], [[story(m7)], T + 5 * 3600e3]];
  });
  const summaries = (x) => x.calls.filter((c) => c.kind === 'summary');
  assert.equal(summaries(a).length, summaries(b).length);
  assert.equal(summaries(a).length, 2); // the first, and the doubling one: nothing for the official source
  assert.deepEqual(summaries(a).map((c) => [c.system, c.user]), summaries(b).map((c) => [c.system, c.user]));
  assert.deepEqual(a.st.res, b.st.res);
  assert.deepEqual(a.shown, b.shown);
});

test('OFF: an earlier v4 summary of a story with 3+ outlets is NOT upgraded; stories of mixed events are still summarised as before', async () => {
  const members = transfer();
  const key = [...members].sort((x, y) => x.published - y.published)[0].id;
  const run = async (mod) => {
    const calls = mockModel();
    try {
      const prev = { res: { [key]: { v: 4, title_he: 'כותרת ישנה', summary_he: 'סיכום ישן', summary_en: 'old', facts: [], n: 6, at: T } } };
      await mod.aiSummaries([story(members)], {}, prev, T + 3600e3, new Map(), {});
      return calls.filter((c) => c.kind === 'summary').length;
    } finally { globalThis.fetch = realFetch; }
  };
  assert.equal(await run(current), 0); // OFF: no automatic upgrade
  assert.equal(await run(before), 0);
  process.env.AI_RICH_SUMMARIES = '1';
  try { assert.equal(await run(current), 1); } finally { delete process.env.AI_RICH_SUMMARIES; } // ON: the upgrade (this is what the flag switches)
  // two kinds of event for one player: with the flag off it is summarised exactly as production does
  const mixed = [
    ...['Smith suffers hamstring injury in training', 'Smith injury: scan result awaited', 'Smith ruled out after hamstring injury', 'Club confirm Smith injury', 'Smith injured, doctors say'].map((t, i) => art(`Inj${i}`, t, { ents: ['p1', 't1'] })),
    ...['Smith suspended for three games', 'Smith fined and suspended by the league', 'Smith ban confirmed by disciplinary panel', 'League punishes Smith with a suspension', 'Smith sanction announced'].map((t, i) => art(`San${i}`, t, { ents: ['p1', 't1'] })),
  ];
  const [a, b] = await both(() => [[[story(mixed)], T + 3600e3]]);
  assert.equal(a.calls.filter((c) => c.kind === 'summary').length, 1);
  assert.deepEqual(a.calls.map((c) => [c.kind, c.system, c.user]), b.calls.map((c) => [c.kind, c.system, c.user]));
  assert.deepEqual(a.st.res, b.st.res);
});

test('OFF: a quota error (429), a rejected answer and a malformed answer leave an earlier summary untouched, exactly like production', async () => {
  const members = transfer().slice(0, 4);
  const key = [...members].sort((x, y) => x.published - y.published)[0].id;
  const prevRes = { v: 4, title_he: 'כותרת קיימת', summary_he: 'סיכום קיים טוב', summary_en: 'good', facts: ['עובדה'], n: 1, at: T };
  const grown = () => story(members); // 4 outlets: the doubling rule asks again
  for (const mode of ['429', 'bad-hebrew', 'garbage', 'timeout']) {
    for (const flag of [undefined, '1']) {
      if (flag) process.env.AI_RICH_SUMMARIES = flag; else delete process.env.AI_RICH_SUMMARIES;
      globalThis.fetch = async (url, init) => {
        const body = JSON.parse(init.body);
        if (!/story cards/.test(body.messages[0].content) && !/numbered/.test(body.messages[0].content)) {
          if (mode === '429') return { ok: false, status: 429, text: async () => 'HTTP 429 quota' };
          if (mode === 'timeout') throw new Error('The operation was aborted due to timeout');
          const content = mode === 'garbage' ? 'this is not json {{{' : JSON.stringify({ stories: [{ id: 's0', title_he: 'only english here', summary_he: 'no hebrew either', summary_en: 'x' }] });
          return { ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content } }] }) };
        }
        return { ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: JSON.stringify({ items: [], titles: [] }) } }] }) };
      };
      try {
        const s = grown();
        const prev = { res: { [key]: { ...prevRes } } };
        const r = await current.aiSummaries([s], {}, prev, T + 3 * 3600e3, new Map(), {});
        assert.equal(r.ai.res[key].summary_he, 'סיכום קיים טוב', `${mode} flag=${flag}`);
        assert.equal(r.ai.res[key].title_he, 'כותרת קיימת');
        assert.equal(s.ai.he.sum, 'סיכום קיים טוב');
      } finally { globalThis.fetch = realFetch; delete process.env.AI_RICH_SUMMARIES; }
    }
  }
});

test('ON: a rejected answer counts as an attempt (a story is not asked again every run) and an empty multi-source answer does not replace a summary that had one', async () => {
  process.env.AI_RICH_SUMMARIES = '1';
  try {
    const members = transfer().slice(0, 5);
    const s = story(members);
    const key = [...members].sort((x, y) => x.published - y.published)[0].id;
    // an earlier v4 summary: upgrade asked, answer rejected (no Hebrew) -> waits 6 hours
    const calls = mockModel();
    const bad = async () => { globalThis.fetch = async (url, init) => { const b = JSON.parse(init.body); const sum = !/story cards/.test(b.messages[0].content) && !/numbered/.test(b.messages[0].content); return { ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: JSON.stringify(sum ? { stories: [{ id: 's0', title_he: 'x', summary_he: 'y' }] } : { items: [], titles: [] }) } }] }) }; }; };
    await bad();
    const prev = { res: { [key]: { v: 4, title_he: 'כותרת קיימת', summary_he: 'סיכום קיים', summary_en: 'old', facts: [], n: 5, at: T } } };
    const r1 = await current.aiSummaries([s], {}, prev, T + 3600e3, new Map(), {});
    assert.equal(r1.ai.res[key].summary_he, 'סיכום קיים');
    assert.ok(r1.ai.res[key].upAt);
    const calls2 = mockModel();
    await current.aiSummaries([s], {}, r1.ai, T + 2 * 3600e3, new Map(), {});
    assert.equal(calls2.filter((c) => c.kind === 'summary').length, 0); // not again within 6 hours
    assert.ok(calls); // (the first mock was only a placeholder)
  } finally { globalThis.fetch = realFetch; delete process.env.AI_RICH_SUMMARIES; }
});
