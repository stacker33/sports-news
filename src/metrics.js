// Quality measurement (discovery version, stage 3). Numbers for the watchlist page and docs; nothing here changes
// what is collected or shown.
//
// - Query value is attributed conservatively: a story counts as a query's unique find only when no other source
//   found any of its articles. Items also found elsewhere count as redundant.
// - Discovery delay uses only trustworthy publisher times (known, not in the future, under 48 hours).
// - Editor usefulness always comes with its sample size; under 10 voted stories it is marked as too few to judge.
// - No recall or precision claims: there is no comparison baseline here (see scripts/evaluate.mjs for misses).

export const isRelevant = (s) => !!(s.watchIsrael || s.abroad || s.israel || (s.ed?.score ?? 0) >= 50);
const median = (xs) => {
  if (!xs.length) return null;
  const a = [...xs].sort((x, y) => x - y);
  return a[Math.floor(a.length / 2)];
};
const pathsOf = (m) => (m.paths?.length ? m.paths : [m.sourceId]);

// stories carry _members (items with .paths / .via); queryIds = the watch query ids; rejected = [{ sid, why }]
export function queryMetrics(stories, queryIds, rejected = []) {
  const per = {};
  const row = (q) => (per[q] ??= { items: 0, redundant: 0, stories: 0, relevant: 0, unique: 0, uniqueRelevant: 0, firstFound: 0, rejected: {} });
  for (const s of stories) {
    const members = s._members || [];
    const all = new Set(members.flatMap(pathsOf));
    const rel = isRelevant(s);
    for (const q of all) {
      if (!queryIds.has(q)) continue;
      const r = row(q);
      r.stories++;
      if (rel) r.relevant++;
      if (all.size === 1) {
        r.unique++;
        if (rel) r.uniqueRelevant++;
      }
    }
    for (const m of members) {
      const ps = pathsOf(m);
      for (const q of ps) {
        if (!queryIds.has(q)) continue;
        const r = row(q);
        r.items++;
        if (ps.length > 1) r.redundant++;
        if (m.via?.src === q && !m.via.approx) r.firstFound++;
      }
    }
  }
  for (const x of rejected) if (x.sid && queryIds.has(x.sid)) row(x.sid).rejected[x.why] = (row(x.sid).rejected[x.why] || 0) + 1;
  return per;
}

// How long after publication we first collected an item, by how it was found
export function discoveryDelay(items, isWatch = (id) => /^wq-/.test(id)) {
  const groups = { watch: [], google: [], direct: [] };
  for (const m of items) {
    if (m.dateUnknown || !m.via?.at || m.via.approx || !m.published) continue;
    const d = m.via.at - m.published;
    if (d < 0 || d > 48 * 3600e3) continue;
    groups[isWatch(m.via.src) ? 'watch' : m.google ? 'google' : 'direct'].push(d);
  }
  return Object.fromEntries(Object.entries(groups).map(([k, ds]) => [k, { n: ds.length, medianMin: ds.length ? Math.round(median(ds) / 60000) : null }]));
}

// Editor usefulness from votes (state.feedback.votes): per voted story, more up than down = useful
export function usefulness(votes = {}, stories = []) {
  const byId = new Map(stories.map((s) => [s.id, s]));
  const tally = (ids) => {
    let useful = 0;
    let not = 0;
    const why = {};
    for (const id of ids) {
      const v = votes[id];
      const up = new Set(v.up || []).size;
      const down = new Set(v.down || []).size;
      if (!up && !down) continue;
      if (up > down) useful++;
      else if (down > up) not++;
      for (const [k, ds] of Object.entries(v.why || {})) why[k] = (why[k] || 0) + ds.length;
    }
    const n = useful + not;
    return { n, useful, notUseful: not, rate: n ? Math.round((100 * useful) / n) : null, enough: n >= 10, why };
  };
  const ids = Object.keys(votes);
  const inView = (v) => ids.filter((id) => byId.get(id)?.v?.includes(v));
  return { all: tally(ids), foreign: tally(inView('f')), israeli: tally(inView('i')) };
}

// Why items were rejected, and why stories in foreign discovery ranked low
export function lowRankReasons(stories, rejected = []) {
  const rej = {};
  for (const r of rejected) rej[r.why] = (rej[r.why] || 0) + 1;
  const low = stories.filter((s) => s.v?.includes('f') && (s.ed?.score ?? 100) < 35);
  const limits = {};
  for (const s of low) for (const l of s.ed.limits || []) if ((l.k || l) !== 'headline') limits[l.k || l] = (limits[l.k || l] || 0) + 1;
  return { rejected: rej, lowRanked: low.length, lowRankLimits: limits };
}
