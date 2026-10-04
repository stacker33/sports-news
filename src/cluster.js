// Group items that report the same story (same language) and score each story.
import { heBase } from './hebrew.js';

const STOP = new Set(
  `a an the and or but of to in on at for from by with as is are was were be been it its this that these those
  after before over under into out up down about than then so not no vs v his her their they he she we you i
  will would can could has have had do does did new says say said report reports live latest news update updates
  how why what who when where which more most first last one two three amid set gets get make makes
  prediction predictions pick picks preview odds betting bet tips lineup lineups highlight highlights watch stream tv
  channel time kick off result results score scores league soccer football match game player players team club fans
  el la los las de del en con por para un una al se su que le les du des et di il da der die und das im
  של את על עם לא כי זה זו גם אבל או אם כל רק עוד היה היא הוא הם הן יש אין אחרי לפני מול בין אל עד כך מה מי
  הזה הזאת היום אתמול מחר דקות שעות ואז כבר אחד אחת שני שתי
  ליגה משחק שחקן שחקנים קבוצה קבוצת אוהדים צפו תקציר שער שערים`.split(/\s+/)
);

// two-word place/club names → one token
const COMPOUND = /\b(tel) (aviv)\b|\b(petah|petach) (tikva|tikvah|tiqva)\b|\b(beer|be'er|beersheba) (sheva)\b|\b(kiryat) (shmona)\b|\b(real) (madrid)\b|\b(new) (york|england|orleans|jersey)\b|\b(los) (angeles)\b|\b(san) (antonio|francisco|diego|jose)\b|\b(golden) (state)\b|\b(manchester) (united|city)\b|\b(aston) (villa)\b|\b(west) (ham|brom)\b|\b(crystal) (palace)\b|\b(saint|st) (germain|etienne)\b|\b(red) (star|bull)\b|\b(tel)-(aviv)\b|תל אביב|פתח תקווה|פתח תקוה|באר שבע|ריאל מדריד/g;

export function tokens(title) {
  const words = title
    .toLowerCase()
    .replace(COMPOUND, (m) => m.replace(/[\s-]+/g, ''))
    .replace(/[֑-ׇ]/g, '') // Hebrew niqqud
    .replace(/['"׳״`’‘“”]/g, '')
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
  const out = new Set();
  for (let w of words) {
    w = heBase(w); // Hebrew prefix letter, keeping known names intact (src/hebrew.js)
    if (w.length < 2 || STOP.has(w)) continue;
    // crude English plural/possessive normalisation
    if (/^[a-z]+$/.test(w) && w.length > 4 && w.endsWith('s')) w = w.slice(0, -1);
    out.add(w);
  }
  return out;
}

function similar(a, b) {
  let shared = 0;
  for (const t of a) if (b.has(t)) shared++;
  const min = Math.min(a.size, b.size);
  if (min === 0) return false;
  const ratio = shared / min;
  return (shared >= 3 && ratio >= 0.5) || (shared >= 2 && ratio >= 0.75);
}

const WINDOW = 20 * 3600 * 1000; // same story must appear within 20h
const CORE = 8; // a new article must match one of the story's first 8 articles
const SPORTY = new Set(['football', 'basketball']);

export function clusterItems(items) {
  const sorted = [...items].sort((a, b) => a.published - b.published);
  const clusters = [];
  const index = new Map(); // token -> Set(cluster idx)

  for (const it of sorted) {
    // Compare stories across languages using the English text (original or translation)
    const en = it.lang === 'en' ? it.title : it.tr?.en;
    it._key = en ? 'x' : it.lang;
    it._tok = tokens(en || it.title);
    const candidates = new Map();
    for (const t of it._tok) for (const c of index.get(t) || []) candidates.set(c, (candidates.get(c) || 0) + 1);

    let found = -1;
    // check strongest candidates first
    for (const [c] of [...candidates].sort((x, y) => y[1] - x[1]).slice(0, 25)) {
      const cl = clusters[c];
      if (cl.key !== it._key || it.published - cl.last > WINDOW) continue;
      // never mix football and basketball in one story (Hapoel Tel Aviv vs Real Madrid exists in both)
      if (cl.sport && it.sportSure && SPORTY.has(it.sport) && it.sport !== cl.sport) continue;
      // compare with the story's core (its first articles), not its newest member, so it can't drift
      // article by article into another story
      if (cl.items.slice(0, CORE).some((m) => similar(m._tok, it._tok))) {
        found = c;
        break;
      }
    }
    if (found === -1) {
      found = clusters.length;
      clusters.push({ key: it._key, items: [], last: it.published, sport: null });
    }
    const cl = clusters[found];
    if (!cl.sport && it.sportSure && SPORTY.has(it.sport)) cl.sport = it.sport;
    cl.items.push(it);
    cl.last = Math.max(cl.last, it.published);
    for (const t of it._tok) {
      if (!index.has(t)) index.set(t, new Set());
      index.get(t).add(found);
    }
  }
  return clusters.map((c) => c.items);
}

const pubKey = (p) => p.toLowerCase().replace(/^the\s+/, '').replace(/[^\p{L}\p{N}]/gu, '').replace(/(com|couk|coil)$/, '');

export function buildStory(members, now) {
  // Distinct publishers (Google News items reveal the real publisher)
  const pubs = new Map();
  for (const m of members) {
    const k = pubKey(m.publisher);
    const prev = pubs.get(k);
    if (!prev || m.weight > prev.weight || (m.weight === prev.weight && m.published < prev.published)) pubs.set(k, m);
  }
  const distinct = [...pubs.values()].sort((a, b) => b.weight - a.weight || a.published - b.published);

  // Lead item: prefer direct feeds from top outlets over Google News redirects
  const lead = [...members].sort(
    (a, b) => (b.google ? 0 : 1) - (a.google ? 0 : 1) || b.weight - a.weight || a.published - b.published
  )[0];

  // Story time = when it first broke (articles with an unknown date don't count if others have one)
  const dated = members.filter((m) => !m.dateUnknown);
  const timed = dated.length ? dated : members;
  const first = Math.min(...timed.map((m) => m.published));
  const latest = Math.max(...timed.map((m) => m.published));
  // Sport = weighted majority of members that have a known sport
  // (members whose sport is certain decide; the rest only when none is)
  const counts = {};
  const sure = members.filter((m) => m.sportSure && m.sport !== 'other');
  for (const m of sure.length ? sure : members) if (m.sport !== 'other') counts[m.sport] = (counts[m.sport] || 0) + m.weight;
  const sport = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] || 'other';

  // Israeli story: enough of its articles are (one Israeli mention in a 20-article world story isn't)
  const israel = members.filter((m) => m.israel).length >= Math.max(1, Math.ceil(members.length * 0.2));
  const israelOther = members.some((m) => m.israelOther);
  const athletes = [...new Set(members.flatMap((m) => m.athletes))];
  const teams = [...new Set(members.flatMap((m) => m.teams || []))];
  const breaking = Math.max(...members.map((m) => m.breaking));
  const top = members.some((m) => m.top);

  // Importance score
  const weightSum = distinct.reduce((s, m) => s + m.weight, 0);
  const ageH = (now - first) / 3600000;
  const velocity = distinct.filter((m) => m.published - first < 2 * 3600000).length; // spread within 2h
  let score = weightSum + velocity * 0.5;
  if (breaking) score *= 1.3;
  if (top) score *= 1.4;
  const pop = score; // popularity without the age penalty (the app's newest↔popular slider mixes it with freshness)
  score *= 1 / (1 + ageH / 4); // decay: half importance after ~4h (fresh news rises fast)

  return {
    id: lead.id,
    title: lead.title,
    link: lead.link,
    t: displayTitles(lead, members),
    langs: [...new Set(members.map((m) => m.lang))],
    rival: members.find((m) => m.rival)?.rival || null,
    social: [...new Set(members.filter((m) => m.social).map((m) => m.publisher))],
    video: members.filter((m) => m.video).sort((a, b) => (a.video === 'press' ? 0 : 1) - (b.video === 'press' ? 0 : 1))[0]?.link || null,
    summary: lead.summary || distinct.find((m) => m.summary)?.summary || '',
    image: lead.image || members.find((m) => m.image)?.image || null,
    lang: lead.lang,
    sport,
    israel,
    israelOther,
    abroad: athletes.length > 0,
    athletes,
    teams,
    breaking: breaking > 0,
    uncertain: members.every((m) => m.sportWhy === 'uncertain') || undefined,
    why: topReason(members),
    top,
    sourceCount: distinct.length,
    sources: distinct.slice(0, 15).map((m) => ({ name: m.publisher, title: m.title, link: m.link, lang: m.lang, published: m.published, unknown: !!m.dateUnknown, social: !!m.social })),
    first,
    dateUnknown: dated.length === 0,
    seen: Math.min(...members.map((m) => m.seen ?? m.published)),
    latest,
    score: Math.round(score * 100) / 100,
    pop: Math.round(pop * 100) / 100,
  };
}

// Why the story got its sport: the most common reason among its articles (for the card's "why" line)
function topReason(members) {
  const n = {};
  for (const m of members) if (m.sportWhy) n[m.sportWhy] = (n[m.sportWhy] || 0) + 1;
  return Object.entries(n).sort((a, b) => b[1] - a[1])[0]?.[0];
}

// Title to show per app language: a native article in that language if the story has one,
// otherwise the lead article's translation.
function displayTitles(lead, members) {
  const native = (lang) =>
    members.filter((m) => m.lang === lang).sort((a, b) => (b.google ? 0 : 1) - (a.google ? 0 : 1) || b.weight - a.weight)[0];
  const pick = (lang) => {
    if (lead.lang === lang) return { title: lead.title, link: lead.link };
    const m = native(lang);
    if (m) return { title: m.title, link: m.link };
    if (lead.tr?.[lang]) return { title: lead.tr[lang], link: lead.link, from: lead.lang };
    return null;
  };
  return { he: pick('he'), en: pick('en') };
}
