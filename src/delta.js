// What changed between two publishes of news.json + news-more.json, so an open tab downloads ~130 KB instead of the
// full ~1.2 MB on every update (2026-10-24, measured on two consecutive runs: 1,189 KB → 134 KB). Applied in the page
// by public/delta.js; a tab whose copy is not exactly the previous publish downloads the full files as before.
//
// delta = { v, from, to, top, more, removed: [id], added: [story], patches: [{ id, set: {field: value}, unset: [field] }],
//           order: { first: [id], more: [id] } }
// top = news.json without its stories; more = news-more.json without its stories (null when there is none).

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const without = (o, k) => {
  if (!o) return null;
  const { [k]: _drop, ...rest } = o;
  return rest;
};

export function makeDelta(prevFirst, prevMore, nextFirst, nextMore) {
  if (!prevFirst?.generatedAt || !nextFirst?.generatedAt) return null;
  const prev = new Map([...(prevFirst.stories || []), ...(prevMore?.stories || [])].map((s) => [s.id, s]));
  const next = [...(nextFirst.stories || []), ...(nextMore?.stories || [])];
  const nextIds = new Set(next.map((s) => s.id));
  const added = [];
  const patches = [];
  for (const s of next) {
    const o = prev.get(s.id);
    if (!o) {
      added.push(s);
      continue;
    }
    const set = {};
    const unset = [];
    for (const k of new Set([...Object.keys(o), ...Object.keys(s)])) {
      if (!(k in s) || s[k] === undefined) {
        if (k in o && o[k] !== undefined) unset.push(k);
      } else if (!same(o[k], s[k])) set[k] = s[k];
    }
    if (Object.keys(set).length || unset.length) patches.push({ id: s.id, ...(Object.keys(set).length ? { set } : {}), ...(unset.length ? { unset } : {}) });
  }
  return {
    v: 1,
    from: prevFirst.generatedAt,
    to: nextFirst.generatedAt,
    top: without(nextFirst, 'stories'),
    more: without(nextMore, 'stories'),
    removed: [...prev.keys()].filter((id) => !nextIds.has(id)),
    added,
    patches,
    order: { first: (nextFirst.stories || []).map((s) => s.id), more: (nextMore?.stories || []).map((s) => s.id) },
  };
}
