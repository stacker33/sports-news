// Stable story ids. A story used to take its lead article's id, so it got a new id whenever a better source
// joined — breaking "seen" state, "what's new" and anything that remembers a story. Now every article remembers
// which story it belonged to (state.storyIds: article id → story id) and each run's clusters inherit the id most
// of their articles had. Merges keep the id of the bigger part; a split gives the smaller part a new id.

export function assignStoryIds(clusters, prev = {}) {
  const ids = new Array(clusters.length);
  const used = new Set();
  const map = {};
  // bigger clusters claim their old id first
  const order = clusters.map((_, i) => i).sort((a, b) => clusters[b].length - clusters[a].length);
  for (const i of order) {
    const members = clusters[i];
    const votes = new Map();
    for (const m of members) {
      const id = prev[m.id];
      if (id && !used.has(id)) votes.set(id, (votes.get(id) || 0) + 1);
    }
    let id = [...votes].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0]?.[0];
    if (!id) {
      // new story: named after its earliest article (unique among this run's stories)
      const earliest = [...members].sort((a, b) => a.published - b.published || (a.id < b.id ? -1 : 1))[0].id;
      id = earliest;
      for (let n = 2; used.has(id); n++) id = `${earliest}-${n}`;
    }
    used.add(id);
    ids[i] = id;
    for (const m of members) map[m.id] = id;
  }
  return { ids, map };
}
