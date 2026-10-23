// The same event as one story, across languages. The word-based clustering (src/cluster.js) can't tell that a
// Serbian, a Greek and an English report of Coventry 4-1 Newcastle are one story (2026-10-13: 7 cards). Once the
// language model has written a story's card (src/ai.js: a Hebrew headline and the subject, from an earlier run),
// clusters with the same event are merged: one card, "+N sources", ranked as the big story it is.
//
// Strict on purpose:
// - common words ("לקראת", "ליגת האלופות", "Manchester") don't count: only words rare among today's headlines do;
// - a story joins a group only if it matches the group's first story (no chains: A~B and B~C does not make A~C);
// - two Courtois stories on the same day (a contract, an injury) share the club and the player but not the event,
//   so shared clubs / players need a similar headline, the same score or the same number ("981st goal").

const RECENT_MS = 24 * 3600e3;

const scoresIn = (t) => [...String(t || '').matchAll(/(\d{1,3})\s*[-–:]\s*(\d{1,3})/g)].map((m) => [m[1], m[2]].sort().join('-'));
const words = (t) => [...new Set(String(t || '').replace(/[^\p{L}\d\s]/gu, ' ').split(/\s+/).filter((w) => w.length >= 3))];

// the earliest article: the same key src/ai.js keeps the card under
export const clusterKey = (members) => [...members].sort((a, b) => a.published - b.published || (a.id < b.id ? -1 : 1))[0].id;

// the matches a group's articles name (two team tags each)
function matchesOf(members) {
  const out = new Set();
  for (const m of members) {
    const t = [...new Set((m.ents || []).filter((e) => e[0] === 't'))];
    if (t.length === 2) out.add(t.sort().join('+'));
  }
  return out;
}
// both groups name matches, and none in common: different events
const otherMatches = (a, b) => a.size > 0 && b.size > 0 && ![...a].some((x) => b.has(x));

function sportOf(members) {
  const n = {};
  for (const m of members) n[m.sport] = (n[m.sport] || 0) + 1;
  return Object.entries(n).sort((a, b) => b[1] - a[1])[0]?.[0];
}

export function eventPrint(members, card) {
  const he = card?.title_he || '';
  return {
    ids: [...new Set(members.flatMap((m) => (m.ents || []).filter((id) => /^[tp]/.test(id))))],
    words: words(he),
    scores: [...new Set([he, ...members.slice(0, 6).map((m) => m.title)].flatMap(scoresIn))],
    nums: [...new Set((he.match(/\d{2,}/g) || []).filter((n) => !/^20\d\d$/.test(n)))],
    about: [...new Set(String(card?.about || '').toLowerCase().split(/[^a-zÀ-ɏ]+/).filter((w) => w.length >= 4))],
  };
}

// rare = the words worth comparing (a Set); without it every word counts
export function sameEventStrict(a, b, rare) {
  const keep = (l) => (rare ? l.filter((w) => rare.has(w)) : l);
  const aw = keep(a.words), bw = keep(b.words);
  const inter = aw.filter((w) => bw.includes(w)).length;
  const jac = inter / Math.max(1, new Set([...aw, ...bw]).size);
  const shared = a.ids.filter((x) => b.ids.includes(x)).length;
  const sameScore = a.scores.some((x) => b.scores.includes(x));
  const sameNum = a.nums.some((n) => b.nums.includes(n) && (!rare || rare.has(n))); // a rare number: "981", not "90"
  const sameAbout = a.about.filter((w) => b.about.includes(w)).length >= 2; // the subject: a star is a common word
  const grounded = shared >= 1 || sameAbout; // the same club / player / subject
  return grounded && ((shared >= 2 && (jac >= 0.25 || sameScore || sameNum)) || (inter >= 2 && jac >= 0.3) || ((sameScore || sameNum) && (shared >= 1 || sameAbout)));
}

// clusters: arrays of articles; cards: { key: { title_he, about } } (src/ai.js state.desk)
export function mergeSameEvent(clusters, cards = {}) {
  const info = clusters.map((members) => {
    const card = cards[clusterKey(members)];
    const times = members.map((m) => m.published).filter(Boolean);
    return card?.title_he ? { fp: eventPrint(members, card), sport: sportOf(members), matches: matchesOf(members), first: Math.min(...times) } : null;
  });
  // words / subject words that appear in many of the carded headlines are not evidence of the same event
  const df = new Map();
  for (const x of info) if (x) for (const w of new Set([...x.fp.words, ...x.fp.nums])) df.set(w, (df.get(w) || 0) + 1);
  const n = info.filter(Boolean).length;
  const limit = Math.max(4, Math.round(n * 0.004));
  const rare = new Set([...df].filter(([, c]) => c <= limit).map(([w]) => w));
  // each group is judged against its first story only
  const groups = []; // { seed: info, members: [] }
  const order = clusters.map((_, i) => i).sort((i, j) => (info[i]?.first || 0) - (info[j]?.first || 0));
  const out = [];
  for (const i of order) {
    const me = info[i];
    const g = me && groups.find((x) => x.seed.sport === me.sport && Math.abs(x.seed.first - me.first) <= RECENT_MS && !otherMatches(x.seed.matches, me.matches) && sameEventStrict(x.seed.fp, me.fp, rare));
    if (g) g.members.push(...clusters[i]);
    else if (me) groups.push({ seed: me, members: [...clusters[i]] });
    else out.push(clusters[i]);
  }
  return [...out, ...groups.map((g) => g.members.sort((a, b) => a.published - b.published))];
}
