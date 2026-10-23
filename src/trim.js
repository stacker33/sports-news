// Save-time trim of the radar's memory. An article from a local-market source ("assist": the desk's foreign sites,
// Yahoo! Japan, trend searches) is shown only in a story with a known team / player or an Israeli angle. After some
// hours, one that names no tracked team or player, has no Israeli angle and is in no published story can no longer
// reach the site, so it isn't kept (2026-10-23: ~10,900 of 50,900 articles; Yahoo! Japan alone 4,200 of 4,680).

export const LOCAL_KEEP_H = 6;

const relevant = (it, shownIds) =>
  it.israel || it.athletes?.length || it.teams?.length || (it.ents || []).some((e) => e[0] === 't' || e[0] === 'p') || shownIds.has(it.id);

// items: this run's articles; shownIds: articles in a published story → { keep, trimmed }
export function trimLocal(items, { now, shownIds = new Set(), keepH = LOCAL_KEEP_H }) {
  const keep = [];
  const trimmed = [];
  for (const it of items) {
    const old = now - (it.seen || it.published) > keepH * 3600e3;
    (it.assist && old && !relevant(it, shownIds) ? trimmed : keep).push(it);
  }
  return { keep, trimmed };
}
