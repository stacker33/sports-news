// Replay the real labelled examples (test/fixtures/eval-real.json) against the current local data and report
// each miss by cause. No network.
//   node scripts/evaluate.mjs
// Causes, in pipeline order:
//   source/query  - never collected (no source or search found it)
//   filter        - collected, then rejected or hidden (junk, not sport, general feed...)
//   identity      - in a story, but the Israeli angle / person was not recognised
//   clustering    - collected and kept, but in no story (merged away or cut)
//   ranking       - in a story, but ranked or labelled differently from the expectation (incl. the story cap)
//   view          - in a story, but not in the expected view
// This is a small hand-labelled set: it shows misses and their causes, not recall or precision.
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = async (p, d) => {
  try {
    return JSON.parse(await readFile(join(ROOT, p), 'utf8'));
  } catch {
    return d;
  }
};

export function evaluate(examples, { items = [], rejected = [], stories = [], storyIds = {}, now = Date.now() }) {
  const byId = new Map(stories.map((s) => [s.id, s]));
  const results = [];
  for (const ex of examples) {
    const has = (t) => String(t || '').includes(ex.match);
    const its = items.filter((i) => has(i.title));
    const rej = rejected.filter((r) => has(r.title));
    // the story an item belongs to (the app gets only 8 sources per story, so use the saved item → story map too)
    const st = stories.find((s) => has(s.title) || (s.sources || []).some((x) => has(x.title))) || its.map((i) => byId.get(storyIds[i.id])).find(Boolean);
    const e = ex.expect || {};
    let cause = null;
    let detail = '';
    const age = (now - Date.parse(ex.observed)) / 3600e3;
    if (e.rejected) {
      const hidden = its.find((i) => i.hiddenWhy === e.rejected);
      if (rej.some((r) => r.why === e.rejected) || hidden) detail = `rejected as ${e.rejected}`;
      else if (st) [cause, detail] = ['filter', `shown, expected rejection (${e.rejected})`];
      else if (!its.length && !rej.length) [cause, detail] = [age > 48 ? 'out-of-window' : 'source/query', 'not seen'];
      else detail = 'not shown';
    } else if (!its.length && !rej.length) {
      [cause, detail] = age > 48 ? ['out-of-window', `observed ${Math.round(age)}h ago`] : ['source/query', 'never collected'];
    } else if (!its.length || its.every((i) => i.hidden)) {
      [cause, detail] = ['filter', `rejected: ${rej[0]?.why || its.find((i) => i.hidden)?.hiddenWhy || '?'}`];
    } else if (!st) {
      // older than every story kept: cut by the story cap (a ranking / capacity miss); otherwise merged away
      const cutoff = Math.min(...stories.map((s) => s.latest || s.first || Infinity));
      if (its.every((i) => i.published < cutoff)) [cause, detail] = ['ranking', 'cut by the story cap (older than every story kept)'];
      else [cause, detail] = ['clustering', 'collected, in no story (merged away)'];
    } else {
      const il = st.israel || st.abroad || st.watchIsrael;
      const checks = [
        ['identity', e.israeliAngle && !il, 'Israeli angle not recognised'],
        ['view', e.view && !(st.v || []).includes(e.view), `not in view ${e.view} (views: ${(st.v || []).join(',') || '-'})`],
        ['ranking', e.minScore != null && (st.ed?.score ?? 0) < e.minScore, `score ${st.ed?.score} < ${e.minScore}`],
        ['ranking', e.maxScore != null && (st.ed?.score ?? 0) > e.maxScore, `score ${st.ed?.score} > ${e.maxScore}`],
        ['ranking', e.local != null && !!st.local !== e.local, `local ${!!st.local}, expected ${e.local}`],
        ['ranking', e.leadStatus && st.ev?.lead?.status !== e.leadStatus, `lead ${st.ev?.lead?.status}, expected ${e.leadStatus}`],
      ];
      const miss = checks.find(([, bad]) => bad);
      if (miss) [cause, detail] = [miss[0], miss[2]];
      else detail = `ok (score ${st.ed?.score ?? '-'}, views ${(st.v || []).join(',')})`;
    }
    results.push({ id: ex.id, ok: !cause, cause, detail, note: ex.note || '' });
  }
  const byCause = {};
  for (const r of results) if (r.cause && r.cause !== 'out-of-window') byCause[r.cause] = (byCause[r.cause] || 0) + 1;
  const judged = results.filter((r) => r.cause !== 'out-of-window');
  return { results, byCause, judged: judged.length, passed: judged.filter((r) => r.ok).length };
}

if (/evaluate\.mjs$/.test(process.argv[1] || '')) {
  const { examples } = await read('test/fixtures/eval-real.json', { examples: [] });
  const state = await read('public/data/state.json', { items: [] });
  const rejected = (await read('public/data/rejected.json', { items: [] })).items;
  const stories = [...(await read('public/data/news.json', { stories: [] })).stories, ...(await read('public/data/news-more.json', { stories: [] })).stories];
  const out = evaluate(examples, { items: state.items, rejected, stories, storyIds: state.storyIds || {}, now: state.savedAt || Date.now() });
  for (const r of out.results) console.log(`${r.ok ? 'ok  ' : r.cause === 'out-of-window' ? 'skip' : 'MISS'} ${r.id.padEnd(26)} ${r.cause ? `[${r.cause}] ` : ''}${r.detail}`);
  console.log(`\n${out.passed}/${out.judged} as expected (${out.results.length - out.judged} out of the data window). Misses by cause: ${JSON.stringify(out.byCause)}`);
  console.log('A small hand-labelled set: it shows misses and causes, not recall or precision.');
}
