// Evaluation of the multi-source summary input, checks and refresh rule against the old behaviour, on real saved stories
// (test/fixtures/summaries/stories.json.gz: 38 stories of the radar's memory) plus a few synthetic timelines.
// No network, no model: answers of the model are mocked. What it can measure: what the model is GIVEN (coverage, tokens),
// whether invalid citations / numbers are caught, and when a refresh would fire. What it cannot: whether a summary is true.
//
//   node scripts/eval-summaries.mjs
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { storyInput } from '../src/ai.js';
import { selectSources, sourcesBlock, factsOf, validateRich, numericConflicts, signature, shouldRefresh } from '../src/storysum.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const fx = JSON.parse(gunzipSync(readFileSync(join(ROOT, 'test', 'fixtures', 'summaries', 'stories.json.gz'))).toString('utf8'));
const mkStory = (members, label) => ({ label, title: members[0].title, lang: members[0].lang, first: Math.min(...members.map((m) => m.published)), score: 1, sourceCount: new Set(members.map((m) => String(m.publisher).toLowerCase())).size, _members: members.map((m) => ({ ...m })), tags: [] });
const stories = fx.stories.map((s) => mkStory(s.members, s.label));

// a rough token count: Latin text about 4 characters a token, Hebrew about 2, other scripts about 2.5
const tokens = (t) => { let n = 0; for (const ch of String(t)) n += /[A-Za-z0-9\s.,:;'"!?()\-–—€$£%/@#]/.test(ch) ? 0.25 : /[א-ת]/.test(ch) ? 0.5 : 0.4; return Math.round(n); };
const text = (m) => (m.lang === 'en' ? m.title : m.tr?.en || m.title);
const pub = (m) => String(m.publisher).toLowerCase();
const avg = (a) => a.reduce((s, x) => s + x, 0) / (a.length || 1);
const pct = (x) => Math.round(x * 1000) / 10;
const pctl = (a, p) => [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * p))];
const keyFacts = (f) => [...f.money, ...f.dur, ...f.year];

// ---- 1. what the model is given ----
const rows = stories.map((s) => {
  const oldIn = storyInput(s, {}, new Map());
  const sel = selectSources(s._members, {});
  const newIn = `Main headline: ${s.title}\n${sourcesBlock(sel)}`;
  const outlets = new Set(s._members.map(pub));
  const unique = new Set(s._members.flatMap((m) => keyFacts(factsOf(`${text(m)} ${m.summary || ''}`))));
  const have = (inp) => new Set(keyFacts(factsOf(inp)));
  const hOld = have(oldIn), hNew = have(newIn);
  const mentioned = (inp, names) => names.filter((n) => inp.toLowerCase().includes(String(n).toLowerCase())).length;
  const names = [...new Set(s._members.map((m) => m.publisher))];
  const offN = [...new Set(s._members.filter((m) => m.official || m.reporter).map((m) => m.publisher))];
  const descN = [...new Set(s._members.filter((m) => m.summary && m.summary.length > 40).map((m) => m.publisher))];
  return {
    outlets: outlets.size, unique: unique.size, covOld: [...unique].filter((x) => hOld.has(x)).length, covNew: [...unique].filter((x) => hNew.has(x)).length,
    pubOld: mentioned(oldIn, names), pubNew: mentioned(newIn, names), nNames: names.length,
    offN: offN.length, offOld: mentioned(oldIn, offN), offNew: mentioned(newIn, offN),
    descN: descN.length, descOld: mentioned(oldIn, descN), descNew: mentioned(newIn, descN),
    tokOld: tokens(oldIn), tokNew: tokens(newIn), nSel: sel.sel.length, sel,
  };
});
const sum = (k) => rows.reduce((s, r) => s + r[k], 0);
console.log(`1. INPUT, ${rows.length} real stories (${sum('nNames')} outlets in all)`);
console.log(`   outlets the model sees   old ${pct(sum('pubOld') / sum('nNames'))}%   new ${pct(sum('pubNew') / sum('nNames'))}%   (the new input drops copies of a headline another outlet already gave)`);
console.log(`   amounts / durations / years found in the story's texts, present in the input   old ${pct(sum('covOld') / sum('unique'))}%   new ${pct(sum('covNew') / sum('unique'))}%   (of ${sum('unique')})`);
console.log(`   official / journalist sources included   old ${sum('offOld')} of ${sum('offN')}   new ${sum('offNew')} of ${sum('offN')}`);
console.log(`   outlets with a feed description included   old ${sum('descOld')} of ${sum('descN')}   new ${sum('descNew')} of ${sum('descN')}`);
console.log(`   input tokens per story (estimate)   old avg ${Math.round(avg(rows.map((r) => r.tokOld)))} p95 ${pctl(rows.map((r) => r.tokOld), 0.95)}   new avg ${Math.round(avg(rows.map((r) => r.tokNew)))} p95 ${pctl(rows.map((r) => r.tokNew), 0.95)}`);
console.log(`   a request of 5 such stories: input old about ${Math.round(avg(rows.map((r) => r.tokOld)) * 5)} tokens, new about ${Math.round(avg(rows.map((r) => r.tokNew)) * 5)} tokens, plus the instructions (+about 330 tokens once) and about 150 tokens of answer a story; requests per run: 1 and 1`);
const big = rows.filter((r) => r.outlets >= 20);
console.log(`   large clusters (20+ outlets, ${big.length}): sources sent ${avg(big.map((r) => r.nSel)).toFixed(1)} on average, ${Math.round(avg(big.map((r) => r.sel.omitted)))} omitted; copies dropped over all stories: ${rows.reduce((s, r) => s + r.sel.copies, 0)}`);

// ---- 2. attribution: mocked answers with injected errors ----
let given = 0, kept = 0, invented = 0, inventedCaught = 0, wrong = 0, wrongCaught = 0;
for (const r of rows) {
  const sel = r.sel, first = sel.sel[0];
  const honest = sel.sel.slice(0, 3).map((x) => ({ he: x.m.title.replace(/\d+/g, '').slice(0, 80) || 'דיווח', src: [x.sid], kind: 'reported' }));
  const { rich, dropped } = validateRich({ claims: [...honest, { he: 'עובדה', src: ['S99'], kind: 'reported' }, { he: 'הסכום הוא 777 מיליון', src: [first.sid], kind: 'reported' }] }, sel);
  given += honest.length; kept += rich ? rich.claims.length : 0;
  invented++; inventedCaught += dropped.reasons.filter((x) => /invented|no valid source/.test(x)).length ? 1 : 0;
  wrong++; wrongCaught += dropped.reasons.filter((x) => /number/.test(x)).length ? 1 : 0;
}
console.log(`2. ATTRIBUTION (mock model: 3 honest claims + 1 invented source + 1 number that is in no source, per story)`);
console.log(`   honest claims kept ${kept} of ${given}   invented sources caught ${inventedCaught} of ${invented}   unsupported numbers caught ${wrongCaught} of ${wrong}`);

// ---- 3. conflicts ----
const flagged = rows.filter((r) => numericConflicts(r.sel).length);
console.log(`3. CONFLICTS  deterministic amount conflicts on the ${rows.length} real stories: ${flagged.length} (it needs two outlets, each with exactly one amount, differing by more than 5%)`);
const A = { id: 'x1', title: 'Smith to Real Madrid, fee €40m', publisher: 'A', lang: 'en', published: 1, weight: 1, ents: [] };
const B = { id: 'x2', title: 'Smith deal worth €50m', publisher: 'B', lang: 'en', published: 2, weight: 1, ents: [] };
const C = { id: 'x3', title: 'Smith to Madrid, deal confirmed', publisher: 'C', lang: 'en', published: 3, weight: 1, ents: [] };
console.log(`   synthetic €40m vs €50m: ${numericConflicts(selectSources([A, B, C])).length} flagged; the same amount twice: ${numericConflicts(selectSources([A, { ...B, title: 'Smith €40m fee' }, C])).length}`);
const e1 = stories.find((s) => s.label === 'transfer'), e2 = stories.filter((s) => s.label === 'general')[0];
const mixed = selectSources([...e1._members.slice(0, 6), ...e2._members.slice(0, 6)]);
console.log(`   two events wrongly in one story (real articles of two stories): ${numericConflicts(mixed).length} deterministic conflict flagged`);

// ---- 4. when a summary is written again ----
const mem0 = ['Smith linked with Real Madrid, interest reported', 'Real Madrid interested in Smith, sources say', 'Smith on Real Madrid radar'].map((title, i) => ({ id: `b${i}`, title, publisher: `P${i}`, lang: 'en', published: i * 60e3, weight: 1, ents: [] }));
const sig0 = signature(mem0);
const now = 5 * 3600e3;
const red = (t, title, x = {}) => ({ id: `r${t}`, title, publisher: `R${t}`, lang: 'en', published: t * 60e3, weight: 1, ents: [], ...x });
const scen = [];
const tryAdd = (label, extra, truth) => {
  const r = shouldRefresh({ sig: sig0, at: 0, refreshes: [] }, [...mem0, ...extra], {}, now);
  const total = mem0.length + extra.length;
  scen.push({ label, truth, newGo: r.go, oldGo: total >= mem0.length * 2 && total >= mem0.length + 3, why: r.why.join('+') || '-' });
};
tryAdd('a 4th outlet, the same report', [red(4, 'Smith linked with Real Madrid, interest reported')], false);
tryAdd('3 more outlets, the same facts (the old rule fires at 6)', [red(4, 'Smith linked with Real Madrid, interest reported'), red(5, 'Real Madrid interested in Smith, sources say'), red(6, 'Smith on Real Madrid radar')], false);
tryAdd('a rewording of the rumour', [red(4, 'Real Madrid keeping an eye on Smith')], false);
tryAdd('a new fee in one outlet', [red(4, 'Real Madrid offer €45m for Smith')], true);
tryAdd('talks become an agreement', [red(4, 'Real Madrid agree deal for Smith, here we go')], true);
tryAdd('the club announces it (an official source)', [red(4, 'Real Madrid announce Smith', { official: true })], true);
tryAdd('the agent denies it', [red(4, 'Agent denies Smith move: "fake news"')], true);
console.log(`4. REFRESH  (a story with 3 outlets, then one change; "meaningful" is my label: a new amount, a status step, an official source, a denial)`);
let wrongNew = 0, wrongOld = 0;
for (const s of scen) {
  if (s.newGo !== s.truth) wrongNew++;
  if (s.oldGo !== s.truth) wrongOld++;
  console.log(`   ${s.truth ? 'meaningful' : 'redundant '}  new: ${s.newGo ? 'REFRESH (' + s.why + ')' : 'keep'}   old: ${s.oldGo ? 'refresh' : 'keep'}   | ${s.label}`);
}
console.log(`   wrong decisions: new ${wrongNew} of ${scen.length}, old ${wrongOld} of ${scen.length}`);
let oldN = 0, newN = 0, replayed = 0;
const reasons = {};
for (const s of stories.filter((x) => x.sourceCount >= 5)) {
  const mem = [...s._members].sort((a, b) => a.published - b.published);
  if (mem.length < 6) continue;
  replayed++;
  const k = Math.max(3, Math.ceil(mem.length / 4));
  let res = { sig: signature(mem.slice(0, k)), at: mem[k - 1].published, refreshes: [] };
  let oldRes = { n: new Set(mem.slice(0, k).map(pub)).size, at: res.at };
  for (let i = k; i < mem.length; i++) {
    const t = mem[i].published, seen = mem.slice(0, i + 1), cnt = new Set(seen.map(pub)).size;
    if (cnt >= oldRes.n * 2 && cnt >= oldRes.n + 3 && t - oldRes.at > 3600e3) { oldN++; oldRes = { n: cnt, at: t }; }
    const d = shouldRefresh(res, seen, {}, t);
    if (d.go) { newN++; for (const w of d.why) reasons[w] = (reasons[w] || 0) + 1; res = { sig: signature(seen), at: t, refreshes: [...res.refreshes, t] }; }
  }
}
console.log(`   replay of ${replayed} real stories (5+ outlets, articles arriving in time order from a quarter of them): refreshes old rule ${oldN}, new rule ${newN} ${JSON.stringify(reasons)}`);
