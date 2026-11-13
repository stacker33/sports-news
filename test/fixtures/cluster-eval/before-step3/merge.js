// FROZEN COPY of src/merge.js as it was before Step 3 (production b41bfe2), for before / after replays only.
// Not used by the radar. Do not edit.
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

import { matchPhase } from './cluster.js';

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

// A goal / video clip ("Goal: A. Griezmann vs. D.C. United, 15'") and a quote with a named speaker
// ("Ojeda: “Griezmann makes football easier”") are separate events, even about the same player and match
// (the editors' rule, 2026-11-13). They may be linked later; they must not merge automatically.
const CLIP = /^\W*(goal|video|watch|clip|highlights?)\b/i;
const SPOKEN = /^[^:“"«]{2,45}:\s*[“"«]/;
const enOf = (m) => String(m.lang === 'en' ? m.title : m.tr?.en || m.title);
const mostly = (members, re) => members.length > 0 && members.filter((m) => re.test(enOf(m))).length * 2 > members.length;

// A Hebrew-led group (its best article is Hebrew) has no AI card: cards are only written for foreign stories (src/ai.js).
// Its own Hebrew headline stands in for the card, so it can be matched with the foreign reports of the same event
// (Step 2). Such a card was not written by the card model, so every pair that involves one gets stricter checks below,
// and the groups that already merge on real cards are never touched: the Step 1 algorithm runs first, unchanged.
function standInCard(members) {
  const lead = [...members].sort((a, b) => (b.google ? 0 : 1) - (a.google ? 0 : 1) || b.weight - a.weight || a.published - b.published)[0];
  if (lead?.lang !== 'he' || !/[א-ת]/.test(lead.title)) return null;
  if (new Set(scoresIn(lead.title)).size >= 2) return null; // a round-up of several results ("0:1 Arsenal, 2:5 Ajax") is not one event
  return { title_he: lead.title, about: '', pseudo: true };
}

// Before / during / after a match, read from a Hebrew headline (the card's, or a Hebrew article's own)
const HE_LIVE = /סיקור חי|שידור חי|חי ב|חי מ|לייב|דקה \d|\(מחצית|מחצית \d|\(רבע|רבע (ראשון|שני|שלישי|רביעי|\d)/;
// (these only ever block a merge: a marker that is too wide costs a merge, never makes one)
const HE_PRE = /לקראת|הרכב|הרכבים|תחזית|איפה לראות|באיזו שעה|באיזה ערוץ|מסיבת עיתונאים|ערב המשחק|סגל למשחק|צפוי לפתוח|תארח|תפגוש|יפגשו|נפגשות|בקרב|אחרי בדיקה|מצבו של|יחמיץ|יעדר/;
const HE_POST = /גברה|ניצחה|הביסה|ניצחון|הפסידה|תבוסה|סיכום המשחק|תקציר|הפסד|השיגה|סיימה|עצרה|כבש|כבשה|צמד|הכריעה|נכנעה|\d:\d/;
const hePhase = (t) => (HE_LIVE.test(t) ? 'live_match' : HE_PRE.test(t) ? 'pre_match' : HE_POST.test(t) ? 'post_match' : null);

// the phase most of a group's headlines are in (src/cluster.js matchPhase, on the English text), or null
function groupPhase(members) {
  const c = {};
  let n = 0;
  for (const m of members) {
    const p = matchPhase(enOf(m));
    if (p) { c[p] = (c[p] || 0) + 1; n++; }
  }
  const top = Object.entries(c).sort((a, b) => b[1] - a[1])[0];
  return top && top[1] >= n * 0.6 ? top[0] : null;
}
// the clubs / players a group is about: the ones in at least a quarter of its articles (a round-up names many)
function focusedIds(members) {
  const cnt = new Map();
  for (const m of members) for (const id of new Set((m.ents || []).filter((x) => /^[tp]/.test(x)))) cnt.set(id, (cnt.get(id) || 0) + 1);
  const need = Math.max(1, Math.ceil(members.length * 0.25));
  return [...cnt].filter(([, c]) => c >= need).map(([id]) => id);
}

export function eventPrint(members, card) {
  const he = card?.title_he || '';
  const first = members.slice(0, 6);
  return {
    pseudo: !!card?.pseudo,
    phase: groupPhase(members),
    hePhase: hePhase(he),
    nMatches: matchesOf(members).size,
    clip: mostly(first, CLIP),
    spoken: mostly(first, SPOKEN),
    ids: card?.pseudo ? focusedIds(members) : [...new Set(members.flatMap((m) => (m.ents || []).filter((id) => /^[tp]/.test(id))))],
    words: words(he),
    scores: [...new Set([he, ...members.slice(0, 6).map((m) => m.title)].flatMap(scoresIn))],
    heScores: [...new Set(scoresIn(he))], // the score in the card's own headline (live blogs' running scores differ)
    nums: [...new Set((he.match(/\d{2,}/g) || []).filter((n) => !/^20\d\d$/.test(n)))],
    about: [...new Set(String(card?.about || '').toLowerCase().split(/[^a-zÀ-ɏ]+/).filter((w) => w.length >= 4))],
  };
}

// rare = the words worth comparing (anything with has(word)); without it every word counts
// names: { id → words that are that club's / player's name } (optional; only used for a pair with a Hebrew stand-in)
export function sameEventStrict(a, b, rare, names) {
  const shared = a.ids.filter((x) => b.ids.includes(x)).length;
  const sameAbout = a.about.filter((w) => b.about.includes(w)).length >= 2; // the subject: a star is a common word
  const grounded = shared >= 1 || sameAbout; // the same club / player / subject
  if (!grounded) return false;
  // With a Hebrew stand-in the subject's own name is not evidence of the same event: two Hapoel Beer Sheva stories share
  // "Hapoel Beer Sheva" whatever they say
  const nameWords = new Set();
  if (names && (a.pseudo || b.pseudo)) for (const id of a.ids) if (b.ids.includes(id)) for (const w of names.get(id) || []) nameWords.add(w);
  const keep = (l) => (rare ? l.filter((w) => rare.has(w) && !nameWords.has(w)) : l.filter((w) => !nameWords.has(w)));
  const aw = keep(a.words), bw = keep(b.words);
  const inter = aw.filter((w) => bw.includes(w)).length;
  const jac = inter / Math.max(1, new Set([...aw, ...bw]).size);
  // With a Hebrew stand-in only the two headlines' own scores count: a group's other articles can carry any score
  const sameScore = a.pseudo || b.pseudo ? (a.heScores || []).some((x) => (b.heScores || []).includes(x)) : a.scores.some((x) => b.scores.includes(x));
  const sameNum = a.nums.some((n) => b.nums.includes(n) && (!rare || rare.has(n))); // a rare number: "981", not "90"
  // Almost the same Hebrew headline (the language model wrote nearly one headline for all of them): the same event,
  // even when its words are "common" because there are many copies (2026-11-06: Partizan - Maccabi from 5 Serbian
  // live blogs stayed 5 stories). Not when the headlines' scores differ ("Real won 2:0" / "Real won 3:1").
  const all = (l) => new Set(l);
  const A = all(a.words), B = all(b.words);
  const allInter = [...A].filter((w) => B.has(w)).length;
  const allJac = allInter / Math.max(1, new Set([...A, ...B]).size);
  const scoresClash = (a.heScores || []).length && (b.heScores || []).length && !a.heScores.some((x) => b.heScores.includes(x));
  const nearSameHeadline = allJac >= 0.7 && A.size >= 4 && B.size >= 4 && !scoresClash;
  if (((a.clip && b.spoken) || (b.clip && a.spoken)) && !sameScore && !sameNum) return false; // a clip and a quote
  // A pair with a Hebrew stand-in card: before, during and after a match stay three stories, read both from the
  // English headlines of the articles and from the Hebrew headlines
  if (a.pseudo || b.pseudo) {
    if (a.phase && b.phase && a.phase !== b.phase) return false;
    if (a.hePhase && b.hePhase && a.hePhase !== b.hePhase) return false;
    // two different scores in the two headlines: two different results (or a round-up of other matches)
    if ((a.heScores || []).length && (b.heScores || []).length && !a.heScores.some((x) => b.heScores.includes(x))) return false;
    // a quote (a player's or coach's words after the game) and the report of the result are different events
    if ((a.spoken && (b.heScores || []).length) || (b.spoken && (a.heScores || []).length)) return false;
  }
  return nearSameHeadline || (shared >= 2 && (jac >= 0.25 || sameScore || sameNum)) || (inter >= 2 && jac >= 0.3) || ((sameScore || sameNum) && (shared >= 1 || sameAbout));
}

// clusters: arrays of articles; cards: { key: { title_he, about } } (src/ai.js state.desk)
export function mergeSameEvent(clusters, cards = {}) {
  const info = clusters.map((members) => {
    const real = cards[clusterKey(members)];
    const card = real?.title_he ? real : standInCard(members);
    const times = members.map((m) => m.published).filter(Boolean);
    return card?.title_he ? { fp: eventPrint(members, card), sport: sportOf(members), matches: matchesOf(members), first: Math.min(...times) } : null;
  });
  // words / subject words that appear in many of the carded headlines are not evidence of the same event. Only the real
  // AI cards count here, so the Hebrew stand-ins can never change what is common, and so no earlier decision.
  const df = new Map();
  const real = (x) => x && !x.fp.pseudo;
  for (const x of info) if (real(x)) for (const w of new Set([...x.fp.words, ...x.fp.nums])) df.set(w, (df.get(w) || 0) + 1);
  const n = info.filter(real).length;
  const limit = Math.max(4, Math.round(n * 0.004));
  const rare = { has: (w) => (df.get(w) || 0) <= limit }; // a word no card has used (only a Hebrew headline has) is rare
  // for the Hebrew-led pass every headline counts: Israeli club names are common in Hebrew headlines, but the foreign
  // AI cards rarely have them, so counting the cards alone would make "Hapoel Beer Sheva" a rare word
  const dfAll = new Map();
  for (const x of info) if (x) for (const w of new Set([...x.fp.words, ...x.fp.nums])) dfAll.set(w, (dfAll.get(w) || 0) + 1);
  const limitAll = Math.max(4, Math.round(info.filter(Boolean).length * 0.004));
  const rareAll = { has: (w) => (dfAll.get(w) || 0) <= limitAll };
  // the words that are a club's / player's NAME: in at least 40% of the headlines carrying that tag (3 headlines or more)
  const idPrints = new Map(), idWords = new Map();
  for (const x of info) if (x) for (const id of x.fp.ids) {
    idPrints.set(id, (idPrints.get(id) || 0) + 1);
    const m = idWords.get(id) || idWords.set(id, new Map()).get(id);
    for (const w of x.fp.words) m.set(w, (m.get(w) || 0) + 1);
  }
  const names = new Map();
  for (const [id, cnt] of idPrints) if (cnt >= 3) names.set(id, new Set([...idWords.get(id)].filter(([, c]) => c / cnt >= 0.4).map(([w]) => w)));
  const same = (g, me, r = rare, nm) => g.seed.sport === me.sport && Math.abs(g.seed.first - me.first) <= RECENT_MS && !otherMatches(g.seed.matches, me.matches) && sameEventStrict(g.seed.fp, me.fp, r, nm);
  const byTime = (i, j) => info[i].first - info[j].first;
  const groups = []; // { seed: info, members: [] }
  // pass 1: the Step 1 algorithm, unchanged: each group is judged against its first story only
  for (const i of clusters.map((_, k) => k).filter((k) => real(info[k])).sort(byTime)) {
    const me = info[i];
    const g = groups.find((x) => same(x, me));
    if (g) g.members.push(...clusters[i]);
    else groups.push({ seed: me, members: [...clusters[i]] });
  }
  // pass 2: a Hebrew-led group joins a group of the same event, or starts one for the next Hebrew-led group. Never a
  // round-up: a group that names several matches takes in nothing.
  const teamsOf = (fp) => fp.ids.filter((id) => id[0] === 't').length;
  const single = (g, me) => me.fp.nMatches <= 1 && teamsOf(me.fp) <= 2 && matchesOf(g.members).size <= 1; // a headline about 3+ clubs is a round-up
  for (const i of clusters.map((_, k) => k).filter((k) => info[k]?.fp.pseudo).sort(byTime)) {
    const me = info[i];
    const g = groups.find((x) => same(x, me, rareAll, names) && single(x, me));
    if (g) g.members.push(...clusters[i]);
    else groups.push({ seed: me, members: [...clusters[i]] });
  }
  const out = clusters.filter((_, k) => !info[k]); // no card, not Hebrew-led: left as it is
  return [...out, ...groups.map((g) => g.members.sort((a, b) => a.published - b.published))];
}
