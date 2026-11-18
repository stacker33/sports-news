// Can a story the Telegram channel posted become unreachable on the site because of G1? OFFLINE replay on a saved state.
//
// Replays the collector every 30 minutes over the last 24 hours. At each run it builds the Telegram candidates the way
// src/telegram.js does (the legacy list `core`; the main page's top MAIN_TOP by the 50/50 mix, up to 3 hours old, or a scoop up to
// 90 minutes old; a story is posted once, at most PER_RUN a run), remembers them, and then asks of every posted story, at 0 / 1 / 3 / 6 / 12 hours after
// the post: was it in the published files under (a) the legacy cap, (b) G1, (c) G1 with the Telegram pin (src/capselect.js telegramPinIds)?
//
//   node scripts/bench-g1-telegram.mjs --state <state.json> [--hours 24] [--step-min 30] [--json out.json]
//
// The replayed score lacks the watchlist / desk labels / Sport5 check (see scripts/bench-g1.mjs), so which stories are posted is an
// approximation; the question asked of them (is it still on the site) is exact for the replayed lists.
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { loadReplay, H } from './replay-lib.mjs';
import { applyCap, capStories, pinInto, telegramPinIds, TG_PIN_HOURS } from '../src/capselect.js';
import { mainPage, MAIN_TOP, storyKey } from '../src/telegram.js';
import { isScoop } from '../src/editorial.js';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const statePath = arg('--state');
if (!statePath) throw new Error('--state <state.json> is required');
const HOURS = Number(arg('--hours', 24));
const STEP = Number(arg('--step-min', 30)) * 60e3;
const PER_RUN = 4;
const { end, eligibleAt, scoreOf } = loadReplay(statePath, arg('--entities', join(dirname(statePath), 'entities.json')));
const pct = (n, d) => (d ? Math.round((1000 * n) / d) / 10 : null);

const sent = {}; // storyKey -> postedAt (as state.tg.sent)
const posted = []; // { key, id, at, ed }
const runs = []; // per run: sets of item ids visible under each policy
let prevKept = new Set();
const start = end - HOURS * H;
let first = true;
for (let T = start; T <= end + 1; T += STEP) {
  const now = Math.min(T, end);
  const stories = eligibleAt(now);
  const score = new Map();
  const full = new Map();
  for (const s of stories) { s._now = now; const r = scoreOf(s); full.set(s, r); score.set(s, r.score); }
  const g = applyCap(stories, { mode: 'on', max: 1200, now, scoreOf: (s) => full.get(s), prevKept });
  prevKept = new Set(g.published.map((s) => s.id));
  // Telegram reads the legacy list, with the editorial score on it
  const core = g.core;
  for (const s of core) s.ed = { score: score.get(s) };
  const keyOf = new Map(core.map((s) => [s, storyKey(s)]));
  if (!first) {
    const page = mainPage(core, now);
    const pos = new Map(page.map((s, i) => [s, i]));
    const top = new Set(page.slice(0, MAIN_TOP));
    const fresh = core.filter((s) => !sent[keyOf.get(s)] && !s.dateUnknown && pos.has(s) && ((top.has(s) && now - s.first < 3 * H) || (isScoop(s) && now - s.first < 90 * 60e3))).sort((a, b) => pos.get(a) - pos.get(b));
    for (const s of fresh.slice(0, PER_RUN)) { sent[keyOf.get(s)] = now; posted.push({ key: keyOf.get(s), id: s.id, at: now, mainRank: pos.get(s) + 1 }); }
  } else for (const s of core) sent[keyOf.get(s)] ??= 0; // the first run marks, it does not post
  first = false;
  // the pin, as src/collect.js computes it: stories (any in the eligible list) the channel posted in the last 12 hours
  const pins = telegramPinIds(g.union, sent, (s) => s._members.map((m) => m.id), now, { core: new Set(g.core) });
  const pinned = pinInto(g, pins, 1200);
  const itemIds = (list) => new Set(list.flatMap((s) => s._members.map((m) => m.id)));
  runs.push({ T: now, legacy: itemIds(g.core), g1: itemIds(g.published), g1pin: itemIds(pinned), pinCount: pins.length, pinSize: pinned.length, pinAdded: pinned.filter((s) => !g.published.includes(s)).length });
}
const horizons = [0, 1, 3, 6, 11, 12, 24]; // posts older than 12 h stay only while the old cap would still show them
const out = { state: statePath, runs: runs.length, stepMin: STEP / 60e3, posted: posted.length, pinHours: TG_PIN_HOURS, byHorizon: {}, pin: { maxStoriesPinned: Math.max(...runs.map((r) => r.pinCount)), medianStoriesPinned: runs.map((r) => r.pinCount).sort((a, b) => a - b)[Math.floor(runs.length / 2)], maxPublishedSize: Math.max(...runs.map((r) => r.pinSize)), pinnedThatG1WouldNotHaveKept: runs.reduce((a, r) => a + r.pinAdded, 0) } };
for (const h of horizons) {
  const row = { observed: 0, legacy: 0, g1: 0, g1WithPin: 0, onlyG1Lost: 0 };
  for (const p of posted) {
    const r = runs.find((x) => x.T >= p.at + h * H - 1);
    if (!r || r.T > end) continue;
    row.observed++;
    const l = r.legacy.has(p.key), g = r.g1.has(p.key), gp = r.g1pin.has(p.key);
    if (l) row.legacy++;
    if (g) row.g1++;
    if (gp) row.g1WithPin++;
    if (l && !g) row.onlyG1Lost++;
  }
  out.byHorizon[`${h} h after the post`] = { ...row, legacyPct: pct(row.legacy, row.observed), g1Pct: pct(row.g1, row.observed), g1WithPinPct: pct(row.g1WithPin, row.observed) };
}
console.log(JSON.stringify(out, null, 1));
if (arg('--json')) writeFileSync(arg('--json'), JSON.stringify(out, null, 1));
