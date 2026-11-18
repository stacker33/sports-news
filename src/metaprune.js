// The per-source record (`state.meta`) grows without limit: every Google trend search the radar ever ran keeps an entry (1,758 of 2,075 entries in
// the saved state of 2026-10-19, one of them polled in the last run). An entry is only the schedule and health of a source ({ last, ok, failStreak,
// cooldownUntil ... }): the articles, their ids, provenance (`via`, `paths`) and the story ids live elsewhere and are not touched.
//
// Removed: a `trend-*` entry whose source is not in this run's list AND was last fetched more than KEEP_MS ago (the radar keeps articles 48 hours, so
// nothing it found is still in memory). Kept: every active source, every entry of another kind, every trend entry fetched recently. If a pruned
// search comes back it is simply new again: it is fetched at once, and an article it returns that is already known is recognised by its id
// (src/collect.js `known`), so nothing is fetched twice or duplicated.
export const KEEP_MS = 48 * 3600e3;
export function pruneMeta(meta, activeIds, now, keepMs = KEEP_MS) {
  let removed = 0;
  for (const id of Object.keys(meta)) {
    if (!id.startsWith('trend-') || activeIds.has(id)) continue;
    if (now - (meta[id]?.last || 0) <= keepMs) continue;
    delete meta[id];
    removed++;
  }
  return removed;
}
