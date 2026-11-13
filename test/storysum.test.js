import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectSources, sourcesBlock, factsOf, validateRich, numericConflicts, withNumericConflicts, signature, shouldRefresh, refreshReasons, richForUi, richRecord, stageOf, denies, MAX_SOURCES, REFRESH_MIN_MS } from '../src/storysum.js';
import { aiSummaries } from '../src/ai.js';

const T = Date.parse('2026-11-14T10:00:00Z');
let n = 0;
const art = (publisher, title, extra = {}) => ({ id: `a${++n}`, title, publisher, lang: 'en', published: T + n * 60e3, weight: 1, google: false, ents: [], sport: 'football', ...extra });
const story = (members, extra = {}) => ({ id: members[0].id, title: members[0].title, lang: 'en', first: Math.min(...members.map((m) => m.published)), score: 5, sport: 'football', sourceCount: new Set(members.map((m) => m.publisher)).size, _members: members, tags: [], ...extra });

// a realistic transfer: several outlets, one copy, one official, one different fee
const transfer = () => [
  art('The Athletic', 'Real Madrid agree deal for Smith, fee around €40m'),
  art('Marca', 'Real Madrid agree deal for Smith, fee around €40m', { lang: 'es' }), // a copy
  art('Sky Sports', 'Smith set for Real Madrid medical, deal worth €50m including add-ons', { summary: 'The 22-year-old will sign a contract until 2030 after a medical on Monday, according to sources close to the club.' }),
  art('Real Madrid · Official', 'Real Madrid C.F. announce the signing of Smith', { official: true }),
  art('Fabrizio Romano', 'Smith to Real Madrid, here we go', { reporter: true }),
];

test('facts are read from a text: amounts, durations, years, scores', () => {
  const f = factsOf('Deal worth €40m, contract until 2030, out for 6 weeks, won 3-0, fee 1,000,000 euros, 25 מיליון יורו');
  assert.ok(f.money.has('m:40000000') && f.money.has('m:25000000'));
  assert.ok(f.year.has('y:2030'));
  assert.ok(f.dur.has('d:6:week'));
  assert.ok(f.score.has('s:0-3'));
  assert.ok(f.digits.has('1000000'));
});

test('source selection: one per outlet, copies dropped, official and reporter kept, stable ids in time order, within budget', () => {
  const sel = selectSources(transfer());
  const names = sel.sel.map((x) => x.m.publisher);
  assert.ok(names.includes('Real Madrid · Official') && names.includes('Fabrizio Romano') && names.includes('Sky Sports'));
  assert.equal(names.filter((p) => p === 'Marca').length + names.filter((p) => p === 'The Athletic').length, 1); // the copy is not sent twice
  assert.equal(sel.copies, 1);
  assert.deepEqual(sel.sel.map((x) => x.sid), sel.sel.map((_, i) => `S${i + 1}`));
  for (let i = 1; i < sel.sel.length; i++) assert.ok(sel.sel[i].m.published >= sel.sel[i - 1].m.published);
  assert.match(sourcesBlock(sel), /^S1 \(/);
});

test('a large cluster is cut to the budget but keeps the official source, the earliest report and the unique numbers', () => {
  const many = Array.from({ length: 30 }, (_, i) => art(`Outlet${i}`, `Smith to Real Madrid story number ${i} with different words about ${['medical', 'fans', 'shirt', 'agent', 'contract', 'rival'][i % 6]} ${i}`));
  many.push(art('Real Madrid · Official', 'Real Madrid announce Smith', { official: true }));
  many.push(art('Unique Fee Outlet', 'Smith deal for €77m revealed'));
  const sel = selectSources(many);
  assert.ok(sel.sel.length <= MAX_SOURCES);
  assert.ok(sel.sel.some((x) => x.official));
  assert.ok(sel.sel.some((x) => x.m.publisher === 'Unique Fee Outlet'));
  assert.ok(sel.sel.some((x) => x.m === many[0])); // the earliest
  assert.equal(sel.total, 32);
  assert.equal(sel.omitted, sel.total - sel.sel.length - sel.copies);
});

test('validation: invented sources, unsupported numbers and conflicts without evidence are rejected', () => {
  const sel = selectSources(transfer());
  const sid = (pub) => sel.sel.find((x) => x.m.publisher === pub).sid;
  const sky = sid('Sky Sports'), off = sid('Real Madrid · Official');
  const { rich, dropped } = validateRich({
    claims: [
      { he: 'הסכום המדווח הוא 50 מיליון יורו', src: [sky], kind: 'reported' }, // 50 is in Sky's headline
      { he: 'הסכום הוא 90 מיליון יורו', src: [sky], kind: 'reported' }, // 90 is nowhere
      { he: 'ריאל חתמה עליו', src: ['S99'], kind: 'official' }, // invented source
      { he: 'עובדה אמיתית', src: [sky, 'S99'], kind: 'reported' }, // one valid id and one invented: the claim is rejected, not trimmed
      { he: 'הדיווח הרשמי', src: [sky], kind: 'official' }, // official kind from a non-official source → "reported"
      { he: 'המועדון הודיע על החתמה', src: [off], kind: 'official' },
    ],
    added: [{ src: sky, he: 'החוזה עד 2030' }, { src: sky, he: 'החוזה עד 2035' }],
    conflicts: [
      { topic_he: 'סכום', positions: [{ src: sky, he: '50 מיליון' }, { src: sid('The Athletic') || sky, he: '40 מיליון' }] },
      { topic_he: 'אין סתירה', positions: [{ src: sky, he: 'ניסוח אחר' }, { src: off, he: 'ניסוח שלישי' }] },
    ],
  }, sel);
  assert.equal(dropped.claims, 3); // the 90, the invented id, the mixed one
  assert.equal(rich.claims.length, 3);
  assert.equal(rich.claims.find((c) => c.he === 'הדיווח הרשמי').kind, 'reported');
  assert.equal(rich.claims.find((c) => c.he === 'המועדון הודיע על החתמה').kind, 'official');
  assert.equal(rich.added.length, 1); // 2035 is not in the cited source
  assert.equal(rich.conflicts.length, 1);
  assert.ok(dropped.reasons.some((r) => r.startsWith('conflicts:no differing number')));
  assert.equal(validateRich({ claims: [{ he: 'x', src: ['S9'] }] }, sel).rich, null);
});

test('conflicts: two different amounts in two outlets are flagged without a model; one outlet with two amounts is not', () => {
  const sel = selectSources(transfer());
  assert.equal(numericConflicts(sel).length, 1);
  const none = selectSources([art('A', 'Smith deal €40m'), art('B', 'Smith fee €40m agreed'), art('C', 'Smith fee €40 million, salary €9m and a €120m clause')]);
  assert.equal(numericConflicts(none).length, 0);
  const merged = withNumericConflicts({ claims: [], added: [], conflicts: [] }, sel);
  assert.equal(merged.conflicts[0].det, 1);
  assert.match(merged.conflicts[0].positions[0].he, /מיליון/);
});

test('refresh: only new facts bring a story back, never a new outlet saying the same', () => {
  const members = [art('A', 'Smith linked with Real Madrid, interest reported'), art('B', 'Real Madrid interested in Smith, sources say'), art('C', 'Smith on Real Madrid radar')];
  const res = { sig: signature(members), at: T, refreshes: [] };
  const now = T + 5 * 3600e3;
  // a fourth outlet with the same headline, and a fifth with a rewording: nothing new
  assert.deepEqual(shouldRefresh(res, [...members, art('D', 'Smith linked with Real Madrid, interest reported')], {}, now), { go: false, why: [] });
  assert.equal(shouldRefresh(res, [...members, art('E', 'Real Madrid keeping an eye on Smith')], {}, now).go, false);
  // an amount
  assert.deepEqual(shouldRefresh(res, [...members, art('F', 'Real Madrid offer €45m for Smith')], {}, now).why, ['number', 'status'].filter((w) => refreshReasons(res.sig, signature([...members, art('F', 'Real Madrid offer €45m for Smith')])).includes(w)));
  // status: rumour → agreed; official source; denial
  assert.ok(shouldRefresh(res, [...members, art('G', 'Real Madrid agree deal for Smith, here we go')], {}, now).why.includes('status'));
  assert.ok(shouldRefresh(res, [...members, art('Club', 'Smith signs', { official: true })], {}, now).why.includes('official'));
  assert.ok(shouldRefresh(res, [...members, art('H', 'Agent denies Smith is leaving: "fake news"')], {}, now).why.includes('denial'));
  assert.equal(stageOf('officially announced'), 4);
  assert.ok(denies('Club denies reports'));
});

test('refresh is throttled and idempotent', () => {
  const members = [art('A', 'Smith linked with Real Madrid'), art('B', 'Smith rumours Real Madrid'), art('C', 'Real Madrid eye Smith')];
  const grown = [...members, art('Club', 'Smith signs', { official: true })];
  const res = { sig: signature(members), at: T, refreshes: [] };
  assert.equal(shouldRefresh(res, grown, {}, T + 10 * 60e3).throttled, true); // too soon
  assert.equal(shouldRefresh(res, grown, {}, T + REFRESH_MIN_MS + 1).go, true);
  assert.equal(shouldRefresh({ ...res, refreshes: [T + 1, T + 2] }, grown, {}, T + 3 * 3600e3).throttled, true); // twice a day at most
  // once written again with the new signature, the same data asks for nothing
  assert.equal(shouldRefresh({ sig: signature(grown), at: T + 3600e3, refreshes: [T + 3600e3] }, grown, {}, T + 9 * 3600e3).go, false);
  assert.equal(shouldRefresh({ at: T }, grown, {}, T + 9 * 3600e3).go, false); // a legacy summary has no signature: the upgrade queue handles it
});

test('the page data: citations become outlet names; a summary without rich data is untouched', () => {
  const sel = selectSources(transfer());
  const sky = sel.sel.find((x) => x.m.publisher === 'Sky Sports').sid;
  const rich = richRecord({ claims: [{ he: 'עובדה', src: [sky], kind: 'reported' }], added: [], conflicts: [] }, sel, T, ['number']);
  const ui = richForUi({ rich, at: T });
  assert.deepEqual(ui.claims[0].s, ['Sky Sports']);
  assert.equal(ui.basis.text, 'headlines + feed descriptions only');
  assert.ok(ui.sources.every((x) => x.n));
  assert.equal(richForUi({ title_he: 'x' }), null);
});

// ---------- the model call, mocked ----------
const realFetch = globalThis.fetch;
function mockModel(handler) {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    const system = body.messages[0].content, user = body.messages[1].content;
    const kind = /story cards/.test(system) ? 'cards' : /numbered sports headlines/.test(system) ? 'heads' : 'summary';
    calls.push({ kind, system, user, model: body.model });
    const r = handler(kind, user, calls.length);
    if (r instanceof Error) return { ok: false, status: r.status || 500, text: async () => r.message };
    return { ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: JSON.stringify(r) } }], usage: { total_tokens: 1000 } }) };
  };
  return calls;
}
const sidOf = (user, pub) => (user.match(new RegExp(`(S\\d+) \\(${pub}`)) || [])[1];
const goodAnswer = (kind, user) => {
  if (kind === 'cards') return { items: [] };
  if (kind === 'heads') return { titles: [] };
  const sky = sidOf(user, 'Sky Sports'), off = sidOf(user, 'Real Madrid · Official');
  return { stories: [{ id: 's0', title_he: 'ריאל מדריד סוגרת את החתמת סמית', summary_he: 'ריאל מדריד הודיעה רשמית על החתמת סמית, ולפי סקיי ספורטס הסכום הוא 50 מיליון יורו.', summary_en: 'Real Madrid announced Smith.', facts_he: ['חוזה עד 2030'],
    claims: [{ he: 'המועדון הודיע על החתמת סמית', src: [off], kind: 'official' }, { he: 'לפי סקיי ספורטס הסכום 50 מיליון יורו והחוזה עד 2030', src: [sky], kind: 'reported' }, { he: 'הסכום 99 מיליון', src: [sky], kind: 'reported' }, { he: 'עובדה בלי מקור', src: ['S42'], kind: 'reported' }],
    added: [{ src: sky, he: 'הבדיקות הרפואיות ביום שני' }], conflicts: [] }] };
};

test('multi-source summary: one request, sources recorded, invalid claims dropped, a second identical run asks nothing', async () => {
  process.env.AI_API_KEY = 'test';
  const members = transfer();
  const s = story(members);
  const calls = mockModel(goodAnswer);
  try {
    const sums = {};
    const r1 = await aiSummaries([s], sums, {}, T + 3600e3);
    const summaryCalls = calls.filter((c) => c.kind === 'summary');
    assert.equal(summaryCalls.length, 1); // the same single request a run always made
    assert.match(summaryCalls[0].user, /Sources \(\d of 5 outlets; headlines and feed descriptions only\)/);
    assert.match(summaryCalls[0].system, /"Sources:" list/);
    const res = Object.values(r1.ai.res)[0];
    assert.equal(res.rv, 1);
    assert.equal(res.rich.claims.length, 2); // the 99 and the invented source were dropped
    assert.equal(res.rich.claims[0].kind, 'official');
    assert.ok(res.rich.sel.every((x) => x.id && x.pub && x.sid));
    assert.equal(r1.ai.rich.droppedClaims, 2);
    assert.equal(s.ai.he.rich.claims[0].s[0], 'Real Madrid · Official');
    assert.equal(s.ai.he.sum.startsWith('ריאל מדריד הודיעה'), true);
    // the same data again, a later run: nothing to ask
    calls.length = 0;
    await aiSummaries([s], sums, r1.ai, T + 5 * 3600e3);
    assert.equal(calls.filter((c) => c.kind === 'summary').length, 0);
  } finally { globalThis.fetch = realFetch; }
});

test('a redundant outlet adds no request; a new official source or a new amount does, once', async () => {
  process.env.AI_API_KEY = 'test';
  const base = [art('A', 'Jones linked with Chelsea, interest reported'), art('B', 'Chelsea interested in Jones, sources say'), art('C', 'Jones on Chelsea radar')];
  const calls = mockModel((kind, user) => (kind === 'summary' ? { stories: [{ id: 's0', title_he: 'צ׳לסי מתעניינת בג׳ונס', summary_he: 'צ׳לסי מתעניינת בג׳ונס לפי הדיווחים.', summary_en: 'Chelsea interested.', claims: [{ he: 'צ׳לסי מתעניינת', src: [sidOf(user, 'A')], kind: 'rumor' }] }] } : { items: [], titles: [] }));
  try {
    const sums = {};
    const s0 = story(base);
    const r1 = await aiSummaries([s0], sums, {}, T + 3600e3);
    calls.length = 0;
    // redundant: the same report from a 4th outlet, 2 hours later
    const s1 = story([...base, art('D', 'Jones linked with Chelsea, interest reported')]);
    const r2 = await aiSummaries([s1], sums, r1.ai, T + 3 * 3600e3);
    assert.equal(calls.filter((c) => c.kind === 'summary').length, 0);
    // an official source arrives: one request
    const s2 = story([...s1._members, art('Chelsea · Official', 'Chelsea announce Jones signing', { official: true })]);
    const r3 = await aiSummaries([s2], sums, r2.ai, T + 4 * 3600e3);
    assert.equal(calls.filter((c) => c.kind === 'summary').length, 1);
    const saved = (await aiSummaries([s2], sums, r3.ai, T + 4.2 * 3600e3)).ai;
    assert.equal(calls.filter((c) => c.kind === 'summary').length, 1); // and then nothing more for the same facts
    assert.ok(Object.values(saved.res)[0].refreshes.length === 1);
  } finally { globalThis.fetch = realFetch; }
});

test('quota error: the earlier summary stays, nothing is made up, the error is recorded', async () => {
  process.env.AI_API_KEY = 'test';
  const members = transfer();
  const s = story(members);
  mockModel(goodAnswer);
  let prev;
  try {
    prev = (await aiSummaries([s], {}, {}, T + 3600e3)).ai;
  } finally { globalThis.fetch = realFetch; }
  const before = JSON.stringify(Object.values(prev.res)[0]);
  const grown = story([...members, art('Late Official', 'Real Madrid confirm Smith contract €60m', { official: true })]);
  mockModel(() => Object.assign(new Error('You exceeded your current quota, please check your plan'), { status: 429 }));
  try {
    const r = await aiSummaries([grown], {}, prev, T + 6 * 3600e3);
    assert.match(r.ai.error, /429/);
    assert.equal(JSON.stringify(Object.values(r.ai.res)[0]), before); // untouched
    assert.equal(grown.ai.he.sum, Object.values(prev.res)[0].summary_he); // the page keeps the old summary
  } finally { globalThis.fetch = realFetch; }
});

test('a story with one or two outlets behaves as before: the old input, no sources block, no rich data', async () => {
  process.env.AI_API_KEY = 'test';
  const s = story([art('Solo', 'Smith scores twice in cup win', { summary: 'The striker scored twice as his side won the cup tie on Tuesday evening.' }), art('Duo', 'Smith double sinks rivals')]);
  const calls = mockModel((kind) => (kind === 'summary' ? { stories: [{ id: 's0', title_he: 'סמית כבש פעמיים', summary_he: 'סמית כבש פעמיים בניצחון בגביע.', summary_en: 'Smith scored twice.' }] } : { items: [], titles: [] }));
  try {
    const r = await aiSummaries([s], {}, {}, T + 3600e3);
    const c = calls.find((x) => x.kind === 'summary');
    assert.doesNotMatch(c.user, /Sources \(/);
    assert.doesNotMatch(c.system, /"Sources:" list/);
    assert.equal(Object.values(r.ai.res)[0].rich, undefined);
    assert.equal(s.ai.he.rich, undefined);
  } finally { globalThis.fetch = realFetch; }
});

test('an earlier v4 summary of a story that now has 3+ outlets is upgraded once, after new stories', async () => {
  process.env.AI_API_KEY = 'test';
  const old = story(transfer());
  const fresh = story([art('Z', 'Brand new story about nothing in particular here')], { score: 1 });
  const key = [...old._members].sort((a, b) => a.published - b.published)[0].id;
  const prev = { res: { [key]: { v: 4, title_he: 'כותרת ישנה', summary_he: 'סיכום ישן', summary_en: 'old', facts: [], n: 5, at: T } } };
  const calls = mockModel(goodAnswer);
  try {
    await aiSummaries([old, fresh], {}, prev, T + 3600e3);
    const c = calls.find((x) => x.kind === 'summary');
    assert.ok(c.user.indexOf('Brand new story') < c.user.indexOf('Sources ('), 'the new story comes first');
    assert.equal(calls.filter((x) => x.kind === 'summary').length, 1);
  } finally { globalThis.fetch = realFetch; }
});

test('real saved stories (fixture of 38): the selection stays within its limits and keeps what matters', async () => {
  const { readFileSync } = await import('node:fs');
  const { gunzipSync } = await import('node:zlib');
  const fx = JSON.parse(gunzipSync(readFileSync(new URL('./fixtures/summaries/stories.json.gz', import.meta.url))).toString('utf8'));
  assert.ok(fx.stories.length >= 30);
  let invented = 0;
  for (const st of fx.stories) {
    const members = st.members.map((m) => ({ ...m }));
    const sel = selectSources(members, {});
    assert.ok(sel.sel.length >= 1 && sel.sel.length <= MAX_SOURCES, st.title);
    assert.equal(new Set(sel.sel.map((x) => x.sid)).size, sel.sel.length);
    for (const o of members.filter((m) => m.official).slice(0, 1)) assert.ok(sel.sel.some((x) => x.m.publisher === o.publisher) || members.filter((m) => m.official).length > 2, 'an official source is kept');
    // the block never names a source that is not in the story
    for (const x of sel.sel) assert.ok(members.includes(x.m) || members.some((m) => m.id === x.m.id));
    if (validateRich({ claims: [{ he: 'x', src: ['S99'] }] }, sel).rich === null) invented++;
  }
  assert.equal(invented, fx.stories.length);
});

test('a story with 3 outlets whose sources collapse to one is not upgraded again and again', async () => {
  process.env.AI_API_KEY = 'test';
  // three outlets, one headline: after copies are dropped fewer than two sources remain, so the plain input is used
  const same = ['A', 'B', 'C'].map((p) => art(p, 'Smith signs new deal with the club until 2030 officially announced today'));
  const s = story(same);
  const calls = mockModel((kind) => (kind === 'summary' ? { stories: [{ id: 's0', title_he: 'סמית חתם', summary_he: 'סמית חתם חוזה חדש עד 2030.', summary_en: 'Smith signed.' }] } : { items: [], titles: [] }));
  try {
    const r1 = await aiSummaries([s], {}, {}, T + 3600e3);
    const res = Object.values(r1.ai.res)[0];
    assert.equal(res.rv, 1);
    assert.equal(res.rich, null);
    calls.length = 0;
    await aiSummaries([s], {}, r1.ai, T + 8 * 3600e3);
    assert.equal(calls.filter((c) => c.kind === 'summary').length, 0);
  } finally { globalThis.fetch = realFetch; }
});
