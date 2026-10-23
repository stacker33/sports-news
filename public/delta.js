// Applies the radar's "what changed" file (data/delta.json, written by src/delta.js) to the copy of news.json +
// news-more.json this tab already has. Returns the new copy, or null when anything doesn't fit (the tab missed an
// update, a story is missing): then the page downloads the full files, as before. Never changes the copy it is given.
(function (root) {
  function applyDelta(raw, d) {
    if (!raw || !raw.first || !d || d.v !== 1 || d.from !== raw.first.generatedAt || !d.order) return null;
    const byId = new Map();
    for (const s of raw.first.stories || []) byId.set(s.id, s);
    for (const s of (raw.more && raw.more.stories) || []) byId.set(s.id, s);
    for (const id of d.removed || []) byId.delete(id);
    for (const p of d.patches || []) {
      const old = byId.get(p.id);
      if (!old) return null;
      const s = Object.assign({}, old, p.set || {});
      for (const k of p.unset || []) delete s[k];
      byId.set(p.id, s);
    }
    for (const s of d.added || []) byId.set(s.id, s);
    const pick = (ids) => {
      const out = [];
      for (const id of ids || []) {
        const s = byId.get(id);
        if (!s) return null;
        out.push(s);
      }
      return out;
    };
    const first = pick(d.order.first);
    const more = pick(d.order.more);
    if (!first || !more || !d.top || d.top.generatedAt !== d.to) return null;
    return {
      first: Object.assign({}, d.top, { stories: first }),
      more: d.more ? Object.assign({}, d.more, { stories: more }) : null,
    };
  }
  root.RadarDelta = { applyDelta };
})(typeof window !== 'undefined' ? window : globalThis);
