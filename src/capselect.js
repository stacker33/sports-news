// Which 1,200 stories the radar publishes (the "cap").
//
// legacy (today): Israeli / abroad stories first, then the newest by last-article time (`capStories`).
// G1 (CAP_G1=on): the same total and the same Israeli-first rule, but the other slots go to the stories with the highest
// value of the app's default sorting mix, 50% editorial rank + 50% freshness (public/app.js rankMix with state.mixF = 50),
// using the existing editorialRank score (src/rank.js), not a new metric. Replay of the saved state of 2026-10-19:
// docs/missed-news-cap-verdict.md and docs/g1-cap.md.
//
// CAP_G1 = off (default) | shadow | on
//   off     nothing changes
//   shadow  the G1 selection is computed and logged (overlap with the legacy list, churn, time) but NOT published
//   on      the files hold the G1 list. Telegram, summaries, translations, the morning brief, trends and the source report
//           still read exactly the list the legacy cap would have built, so a story that only G1 admits is display-only:
//           no notification, no model call, no brief place (see applyCap)

export const MAX_MIX = 0.5; // weight of the editorial score in the mix; the rest is freshness
export const FRESH_HALF_H = 6; // public/app.js: freshN = exp(-(now - first) / 6h)
export const KEEP_BONUS = 0.02; // a story kept by the previous run is worth this much more in the mix (the boundary does not flip)

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

export const isIsraeli = (s) => !!(s.israel || s.abroad || s.watchIsrael);

// the app's default mix for one story; a non-finite value (a story with a missing field) sorts last, never breaks the order
export function mixValue(s, score, now) {
  const fresh = Math.exp(-(now - s.first) / (FRESH_HALF_H * 3600e3));
  const v = MAX_MIX * (score / 100) + (1 - MAX_MIX) * fresh;
  return Number.isFinite(v) ? v : -1;
}

// A total order: higher mix first, then the later last article, then the smaller story id. Same input, same output, whatever the
// order of the input or of any Map / Set.
const byMix = (a, b) => b.v - a.v || (b.s.latest || 0) - (a.s.latest || 0) || (a.s.id < b.s.id ? -1 : a.s.id > b.s.id ? 1 : 0);

// stories: the eligible stories, newest first (as `capStories` receives them)
// scoreOf(story) -> editorial score 0..100 (the radar's editorialRank); prevKept: ids the previous run published
// -> { keep: Set<story>, ranked: [{ s, v }] (the non-Israeli stories, best first) }
export function selectG1(stories, { max, now, scoreOf, prevKept = new Set(), bonus = KEEP_BONUS }) {
  if (stories.length <= max) return { keep: new Set(stories), ranked: [] };
  const keep = new Set(stories.filter(isIsraeli).slice(0, max)); // the Israeli tier, exactly as today
  const rest = stories.filter((s) => !keep.has(s)).map((s) => {
    let sc = Number(scoreOf(s));
    if (!Number.isFinite(sc)) sc = 0;
    return { s, v: mixValue(s, sc, now) + (prevKept.has(s.id) ? bonus : 0) };
  });
  rest.sort(byMix);
  for (const r of rest) if (keep.size < max) keep.add(r.s);
  return { keep, ranked: rest };
}

const jaccard = (a, b) => {
  let i = 0;
  for (const x of a) if (b.has(x)) i++;
  return a.size + b.size - i ? i / (a.size + b.size - i) : 1;
};

// mode off | shadow | on. Returns:
//   union      every story that needs enriching (evidence, rank, summaries, links): the legacy list plus, in `on`, the G1 list
//   core       the list the legacy cap builds: what Telegram, summaries, brief, trends read (unchanged by the flag)
//   published  what goes into news.json / news-more.json
//   keptIds    ids to remember for the next run's churn bonus (null when off)
//   stats      numbers for the log (null when off)
export function applyCap(stories, { mode = 'off', max, now, scoreOf, prevKept = new Set() }) {
  const legacy = capStories(stories, max);
  if (mode === 'off') return { union: legacy, core: legacy, published: legacy, keptIds: null, stats: null };
  const t0 = process.hrtime.bigint();
  const sel = selectG1(stories, { max, now, scoreOf, prevKept });
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  const g1 = stories.filter((s) => sel.keep.has(s));
  const L = new Set(legacy);
  const G = new Set(g1);
  const prev = new Set(prevKept);
  const ids = new Set(g1.map((s) => s.id));
  const stats = {
    eligible: stories.length,
    legacy: legacy.length,
    g1: g1.length,
    overlap: g1.filter((s) => L.has(s)).length,
    added: g1.filter((s) => !L.has(s)).length,
    dropped: legacy.filter((s) => !G.has(s)).length,
    israeli: g1.filter(isIsraeli).length,
    enteredSinceLastRun: prev.size ? [...ids].filter((id) => !prev.has(id)).length : null,
    leftSinceLastRun: prev.size ? [...prev].filter((id) => !ids.has(id)).length : null,
    jaccardWithLastRun: prev.size ? Math.round(jaccard(ids, prev) * 1000) / 1000 : null,
    selectMs: Math.round(ms),
  };
  const keptIds = [...ids];
  if (mode === 'shadow') return { union: legacy, core: legacy, published: legacy, keptIds, stats };
  const union = stories.filter((s) => L.has(s) || G.has(s));
  return { union, core: union.filter((s) => L.has(s)), published: union.filter((s) => G.has(s)), keptIds, stats, ranked: sel.ranked, g1Set: G };
}

// The morning brief is built from the `core` list; a story it names must exist in the published files. Add those that G1 did not
// keep and drop the same number of the lowest-ranked non-Israeli G1 stories, so the total stays exactly `max`.
export function pinInto(result, ids, max) {
  if (!result.ranked || !ids?.length) return result.published;
  const have = new Set(result.published.map((s) => s.id));
  const need = result.union.filter((s) => ids.includes(s.id) && !have.has(s.id));
  if (!need.length) return result.published;
  const pinned = new Set(ids);
  const victims = new Set();
  for (let i = result.ranked.length - 1; i >= 0 && victims.size < need.length; i--) {
    const r = result.ranked[i].s;
    if (have.has(r.id) && !pinned.has(r.id) && !isIsraeli(r)) victims.add(r);
  }
  const add = new Set(need.slice(0, victims.size));
  const out = result.union.filter((s) => (result.g1Set.has(s) && !victims.has(s)) || add.has(s));
  return out;
}
