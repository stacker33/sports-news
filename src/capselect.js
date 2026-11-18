// Which 1,200 stories the radar publishes (the "cap").
//
// legacy (today): Israeli / abroad stories first, then the newest by last-article time (`capStories`).
// pool (CAP_G1=on): the same total and the same Israeli-first rule, but the other slots hold what the slider can show.
//   The front end re-sorts the published stories by the slider mix and shows the first 300 (120 from slider 70) of the Top, Football
//   and Basketball tabs (public/app.js rankMix, visibleStories, inTab). So the pool is the union of exactly those lists at the slider
//   positions 0, 25, 50, 75 and 100, plus the Israeli monitoring tab at its default slider (it shows stories only Israeli sites carry, and it
//   sorts by popularity, not by the editorial score), taken in turn (the best story of every list first) until 1,200 are chosen. The formulas are the
//   page's own (the existing editorialRank score, 50/50 mixes, freshness half-life 6 h): no new ranking rule. They are copied here, so
//   test/pool-drift.test.js runs the page's own functions and fails when the page and this file disagree.
//   Replay of the saved state of 2026-10-19: docs/sorting-aware.md and docs/g1-cap.md.
//
// CAP_G1 = off (default) | shadow | on
//   off     nothing changes
//   shadow  the pool is computed and logged (overlap with the legacy list, recall of the slider lists, churn, time) but NOT published
//   on      the files hold the pool. Telegram, summaries, translations, the morning brief, trends and the source report still read
//           exactly the list the legacy cap would have built, so a story that only the pool admits is display-only: no notification,
//           no model call, no brief place (see applyCap). Any failure falls back to the legacy cap (src/collect.js).

export const SLIDER_POSITIONS = [0, 25, 50, 75, 100]; // 0 = newest ... 100 = editorial rank (public/app.js: slider)
export const POOL_TABS = ['top', 'football', 'basketball']; // the tabs that sort by the editorial score (EDITORIAL_TABS)
export const FRESH_HALF_H = 6; // public/app.js rankMix: freshN = exp(-(now - first) / (6 * 3600e3))
export const LIST_SIZE = 300; // public/app.js visibleStories: list.slice(0, mixVal() >= 70 ? 120 : 300)
export const LIST_SIZE_HIGH = 120;
export const HIGH_FROM = 70;
export const DEFAULT_POSITION = 50; // public/app.js state.mixF
export const ILMON_POSITION = 40; // public/app.js state.mix: the default slider of the tabs outside EDITORIAL_TABS (Israeli monitoring)
export const STICKY_RANKS = 3; // a story the previous run published counts as this many places better when the pool is trimmed

export const capG1Mode = (env = process.env) => {
  const v = String(env.CAP_G1 || '').trim().toLowerCase();
  return /^(1|true|on|yes)$/.test(v) ? 'on' : v === 'shadow' ? 'shadow' : 'off';
};

// Keep at most `max` stories (sorted newest first): Israeli-angle stories first, then the newest; order kept
export function capStories(stories, max) {
  if (stories.length <= max) return stories;
  const keep = new Set(stories.filter((s) => s.israel || s.abroad || s.watchIsrael).slice(0, max));
  for (const s of stories) if (keep.size < max) keep.add(s);
  return stories.filter((s) => keep.has(s));
}

export const isIsraeli = (s) => !!(s.israel || s.abroad || s.watchIsrael); // public/app.js israeliAngle

// ---------- the page's lists ----------
export const listSize = (position) => (position >= HIGH_FROM ? LIST_SIZE_HIGH : LIST_SIZE);
// public/app.js inTab for the three tabs, after storiesFor() has taken out the stories only Israeli sites carry (foreignOnly)
export function tabAccepts(tab, s, israeliOnly = false) {
  if (israeliOnly) return false;
  if (tab === 'top') return s.sport !== 'other' || !!s.big;
  if (tab === 'football') return !isIsraeli(s) && s.sport === 'football';
  if (tab === 'basketball') return !isIsraeli(s) && s.sport === 'basketball';
  return false;
}
export const offbeat = (s) => !s.local && !s.low && !s.minor; // OFFBEAT_TABS: collapsed at the bottom, never in the list
export const freshness = (s, now) => Math.exp(-(now - s.first) / (FRESH_HALF_H * 3600e3));
// the page's rankMix in an editorial tab: w x editorial score / 100 + (1 - w) x freshness; w = slider / 100.
// A non-finite value (a story with a missing field) sorts last and never breaks the order.
export function mixAt(position, score, fresh) {
  const w = position / 100;
  const v = w * (score / 100) + (1 - w) * fresh;
  return Number.isFinite(v) ? v : -1;
}
export const mixValue = (s, score, now) => mixAt(DEFAULT_POSITION, score, freshness(s, now));

// A total order: higher mix first, then the later last article, then the smaller story id. Same input, same output, whatever the
// order of the input or of any Map / Set.
const byValue = (a, b) => b.v - a.v || (b.s.latest || 0) - (a.s.latest || 0) || (a.s.id < b.s.id ? -1 : a.s.id > b.s.id ? 1 : 0);

// the list the page would show on `tab` at slider `position`, from these stories. info: Map(story -> { ed, fresh, israeliOnly })
export function listFor(stories, info, tab, position) {
  const rows = [];
  for (const s of stories) {
    const i = info.get(s);
    if (tabAccepts(tab, s, i.israeliOnly) && offbeat(s)) rows.push({ s, v: mixAt(position, i.ed, i.fresh) });
  }
  return rows.sort(byValue).slice(0, listSize(position)).map((r) => r.s);
}

// the Israeli monitoring tab (public/app.js inTab 'ilmon': the story has an Israeli-origin report or an Israeli subject, no foreignOnly step, no
// off-beat collapse). Outside EDITORIAL_TABS rankMix sorts by popularity: log(1 + pop) / log(1 + the list's largest pop), mixed with freshness.
export function listForIlmon(stories, info, position = ILMON_POSITION) {
  const list = stories.filter((s) => info.get(s).ilmon);
  const pop = (s) => s.pop ?? s.score;
  const maxPop = Math.log1p(Math.max(1, ...list.map(pop)));
  const w = position / 100;
  const rows = list.map((s) => {
    const v = w * (Math.log1p(pop(s)) / maxPop) + (1 - w) * info.get(s).fresh;
    return { s, v: Number.isFinite(v) ? v : -1 };
  });
  return rows.sort(byValue).slice(0, listSize(position)).map((r) => r.s);
}

// scoreOf(story) -> the editorial score, or { score, israeliOnly, ilmon } (israeliOnly: only Israeli sites carry it, so the Top / Football /
// Basketball tabs leave it out and only the Israeli monitoring tab shows it; ilmon: the Israeli monitoring tab lists it)
function infoOf(stories, scoreOf, now) {
  const info = new Map();
  for (const s of stories) {
    const r = scoreOf(s);
    const score = Number(typeof r === 'object' && r ? r.score : r);
    info.set(s, { ed: Number.isFinite(score) ? score : 0, fresh: freshness(s, now), israeliOnly: !!(typeof r === 'object' && r?.israeliOnly), ilmon: !!(typeof r === 'object' && r?.ilmon) });
  }
  return info;
}

// stories: the eligible stories, newest first (as `capStories` receives them); prevKept: ids the previous run published
// -> { keep: Set<story>, ranked: [story] (the chosen non-Israeli stories, best first), lists: [{ tab, position, items }] }
export function selectPool(stories, { max, now, scoreOf, prevKept = new Set() }) {
  if (stories.length <= max) return { keep: new Set(stories), ranked: [], lists: [] };
  const keep = new Set(stories.filter(isIsraeli).slice(0, max)); // the Israeli tier, exactly as today
  const info = infoOf(stories, scoreOf, now);
  const lists = [];
  for (const tab of POOL_TABS) for (const position of SLIDER_POSITIONS) lists.push({ tab, position, items: listFor(stories, info, tab, position) });
  lists.push({ tab: 'ilmon', position: ILMON_POSITION, items: listForIlmon(stories, info) });
  // each story's best place in any list; lists are taken in turn: place 1 of every list, then place 2 ...
  const best = new Map();
  lists.forEach((L, li) => L.items.forEach((s, r) => {
    const b = best.get(s);
    if (!b || r < b.r || (r === b.r && li < b.li)) best.set(s, { r, li });
  }));
  const cands = [...best.entries()]
    .filter(([s]) => !keep.has(s))
    .map(([s, b]) => ({ s, r: b.r - (prevKept.has(s.id) ? STICKY_RANKS : 0), li: b.li }))
    .sort((a, b) => a.r - b.r || a.li - b.li || (b.s.latest || 0) - (a.s.latest || 0) || (a.s.id < b.s.id ? -1 : a.s.id > b.s.id ? 1 : 0));
  const ranked = [];
  for (const c of cands) if (keep.size < max) { keep.add(c.s); ranked.push(c.s); }
  if (keep.size < max) {
    // the lists did not fill the cap: top up with the best of the rest at the default slider position
    const rest = stories.filter((s) => !keep.has(s)).map((s) => ({ s, v: mixAt(DEFAULT_POSITION, info.get(s).ed, info.get(s).fresh) + (prevKept.has(s.id) ? 0.02 : 0) })).sort(byValue);
    for (const r of rest) if (keep.size < max) { keep.add(r.s); ranked.push(r.s); }
  }
  return { keep, ranked, lists };
}

const jaccard = (a, b) => {
  let i = 0;
  for (const x of a) if (b.has(x)) i++;
  return a.size + b.size - i ? i / (a.size + b.size - i) : 1;
};

// how much of every list the page can build is in a set of stories: mean and worst over all tabs and slider positions, and per tab
function recallOf(lists, set) {
  const per = {};
  const all = [];
  for (const L of lists) {
    if (!L.items.length) continue;
    const r = L.items.filter((s) => set.has(s)).length / L.items.length;
    all.push(r);
    (per[L.tab] ||= []).push(r);
  }
  const m = (a) => Math.round((a.reduce((x, y) => x + y, 0) / a.length) * 1000) / 10;
  return { mean: all.length ? m(all) : null, min: all.length ? Math.round(Math.min(...all) * 1000) / 10 : null, ...Object.fromEntries(Object.entries(per).map(([t, a]) => [t, m(a)])) };
}

// mode off | shadow | on. Returns:
//   union      every story that needs enriching (evidence, rank, summaries, links): the legacy list plus, in `on`, the pool
//   core       the list the legacy cap builds: what Telegram, summaries, brief, trends read (unchanged by the flag)
//   published  what goes into news.json / news-more.json
//   keptIds    ids to remember for the next run's trim bonus (null when off)
//   stats      numbers for the log (null when off)
export function applyCap(stories, { mode = 'off', max, now, scoreOf, prevKept = new Set() }) {
  const legacy = capStories(stories, max);
  if (mode === 'off') return { union: legacy, core: legacy, published: legacy, keptIds: null, stats: null };
  const t0 = process.hrtime.bigint();
  const sel = selectPool(stories, { max, now, scoreOf, prevKept });
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  const pool = stories.filter((s) => sel.keep.has(s));
  if (pool.length !== Math.min(max, stories.length)) throw new Error(`the pool has ${pool.length} stories, expected ${Math.min(max, stories.length)}`); // the caller falls back to the legacy cap
  const L = new Set(legacy);
  const G = new Set(pool);
  const prev = new Set(prevKept);
  const ids = new Set(pool.map((s) => s.id));
  const stats = {
    eligible: stories.length,
    legacy: legacy.length,
    pool: pool.length,
    overlap: pool.filter((s) => L.has(s)).length,
    added: pool.filter((s) => !L.has(s)).length,
    dropped: legacy.filter((s) => !G.has(s)).length,
    israeli: pool.filter(isIsraeli).length,
    recallLegacy: recallOf(sel.lists, L),
    recallPool: recallOf(sel.lists, G),
    enteredSinceLastRun: prev.size ? [...ids].filter((id) => !prev.has(id)).length : null,
    leftSinceLastRun: prev.size ? [...prev].filter((id) => !ids.has(id)).length : null,
    jaccardWithLastRun: prev.size ? Math.round(jaccard(ids, prev) * 1000) / 1000 : null,
    selectMs: Math.round(ms),
  };
  const keptIds = [...ids];
  if (mode === 'shadow') return { union: legacy, core: legacy, published: legacy, keptIds, stats };
  const union = stories.filter((s) => L.has(s) || G.has(s));
  return { union, core: union.filter((s) => L.has(s)), published: union.filter((s) => G.has(s)), keptIds, stats, ranked: sel.ranked, poolSet: G };
}

// The morning brief is built from the `core` list; a story it names must exist in the published files. Add those that the pool did not
// keep and drop the same number of the lowest-priority non-Israeli pool stories, so the total stays exactly `max`.
export function pinInto(result, ids, max) {
  if (!result.ranked || !ids?.length) return result.published;
  const have = new Set(result.published.map((s) => s.id));
  const need = result.union.filter((s) => ids.includes(s.id) && !have.has(s.id));
  if (!need.length) return result.published;
  const pinned = new Set(ids);
  const victims = new Set();
  for (let i = result.ranked.length - 1; i >= 0 && victims.size < need.length; i--) {
    const r = result.ranked[i];
    if (have.has(r.id) && !pinned.has(r.id) && !isIsraeli(r)) victims.add(r);
  }
  const add = new Set(need.slice(0, victims.size));
  return result.union.filter((s) => (result.poolSet.has(s) && !victims.has(s)) || add.has(s));
}

// Stories the Telegram channel posted recently must stay reachable on the site (the alert links to the source article and to the
// site, and an editor looks the story up there). Bounded: only the last TG_PIN_HOURS hours of posts, at most TG_PIN_MAX stories,
// newest first, and only stories that are still eligible this run (older ones are not kept alive). They are added to the published
// list by `pinInto`, which gives up the same number of the lowest-priority non-Israeli stories, so the cap stays at 1,200.
// sent = state.tg.sent ({ storyKey: postedAt }); keysOf(story) = the keys the story may be filed under: Telegram files a story under its
// earliest article, and a late-indexed older article can change that, so the caller passes every article id of the story and the
// newest matching post time counts (a string is accepted for a single key)
// Retention rule (both bounds are hard):
//   - a story posted in the last TG_PIN_HOURS (12, the channel's own memory of what it posted) stays, while it is eligible;
//   - a story posted in the last TG_PIN_CORE_HOURS (36, the story window) also stays while the OLD cap would still publish it (it is
//     in `core`), so the pool never hides a posted story the old cap still showed;
//   - at most TG_PIN_MAX stories, the most recently posted first.
export const TG_PIN_HOURS = 12;
export const TG_PIN_CORE_HOURS = 36;
export const TG_PIN_MAX = 60;
export function telegramPinIds(stories, sent, keysOf, now, { hours = TG_PIN_HOURS, core = null, coreHours = TG_PIN_CORE_HOURS, max = TG_PIN_MAX } = {}) {
  const out = [];
  if (!sent) return out;
  for (const s of stories) {
    const keys = keysOf(s);
    let t = 0;
    for (const k of typeof keys === 'string' ? [keys] : keys) if (sent[k] > t) t = sent[k];
    const window = core && core.has(s) ? coreHours : hours;
    if (t && now - t < window * 3600e3 && t <= now + 60e3) out.push({ id: s.id, t });
  }
  return out.sort((a, b) => b.t - a.t || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)).slice(0, max).map((x) => x.id);
}

// Is this story left out of the Top / Football / Basketball tabs because only Israeli sites carry it? The page's foreignOnly drops a story
// that has an Israeli-outlet source unless the collector gave it a foreign report (fv), and the collector gives one only when some
// article of the story comes from a non-Israeli outlet. ev = storyEvidence(...) (ev.il = Israeli outlets), roles = its link -> [origin, role]
export const israeliOnlyStory = (ev, members, roles) => (ev?.il || 0) > 0 && !members.some((m) => roles[m.link]?.[0] !== 'il');
