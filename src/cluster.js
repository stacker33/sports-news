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

// ---------- one match per story ----------
// Template pages share their wording across matches ("X - Y: typy, kursy, absencje", "Torino-Monza: orario e dove
// vederla", "X vs Y Prediction … Today's NBA Picks"), so word overlap alone put several matches in one story
// (2026-10-23: 217 groups, 6,650 articles). An article that names a match must not join a story about another match.
// The match comes from the article's team tags (exactly two teams) or, for clubs we don't tag, from the headline shape.

// "X vs Y", "X v Y", "X - Y" (short sides), "Torino-Monza": the two sides as token sets (no digits)
const SIDE_CUT = /\s*(?:[:|,(]|\s[-–—]\s|\d).*$/;
// club-name words many clubs share (FC Volendam / FC Emmen, Ipswich Town / Shrewsbury Town): not evidence of the same match
const GENERIC = new Set('fc cf ac as sc afc cd ud sd sv vfb vfl fk nk sk bk if ik bc kk club town city county rovers athletic atletico real sporting racing dynamo dinamo ii iii u19 u21 u23 women'.split(' '));
function sideTokens(s) {
  return [...tokens(s.replace(SIDE_CUT, ''))].filter((t) => !/^\d+$/.test(t) && !GENERIC.has(t)).slice(0, 3);
}
export function headlineFixture(title) {
  const t = String(title || '');
  let m = t.match(/^(.{2,60}?)\s+(?:vs\.?|v\.?|versus|contra|contro|gegen|против)\s+(.{2,80})$/i);
  if (!m) m = t.match(/^([^:|,\-–—]{2,40}?)\s+[-–—]\s+([^:|,\-–—]{2,40}?)(?:\s*[:|,]|\s[-–—]\s|$)/);
  if (!m) m = t.match(/^(\p{Lu}[\p{L}.]+)-(\p{Lu}[\p{L}.]+(?: \p{Lu}[\p{L}.]+)?)(?=[\s:,]|$)/u);
  if (!m) return null;
  const a = sideTokens(m[1]), b = sideTokens(m[2]);
  // a dash in a sentence ("Yitzhaki - the new coach of …") is not a match: short sides only
  if (!a.length || !b.length || m[1].split(/\s+/).length > 3 || m[2].replace(SIDE_CUT, '').split(/\s+/).length > 4) return null;
  return [a, b];
}
// Step 3: national teams have no team tags (the radar tags clubs), so a national-team match had no match at all and none of
// the match checks (a different match, a different phase) applied: "Armenia vs Cyprus: who shows it on TV" and "England -
// Croatia: who shows it on TV" shared their template and became one story. A national-team match is found from the two
// nations an English headline names. It only ever blocks: no nation, or more or fewer than two, is "no match" as before.
const NATIONS = new Map();
for (const row of [
  'England', 'Scotland', 'Wales', 'Northern Ireland', 'Republic of Ireland', 'Israel', 'Italy', 'France', 'Germany', 'Spain', 'Portugal',
  'Netherlands|Holland', 'Belgium', 'Croatia', 'Serbia', 'Greece', 'Turkey|Türkiye|Turkiye', 'Poland', 'Ukraine', 'Denmark', 'Sweden',
  'Norway', 'Switzerland', 'Austria', 'Czech Republic|Czechia', 'Slovakia', 'Hungary', 'Romania', 'Bulgaria', 'Finland', 'Iceland',
  'Kosovo', 'Albania', 'Bosnia|Bosnia and Herzegovina|Bosnia-Herzegovina', 'North Macedonia', 'Montenegro', 'Slovenia', 'Armenia',
  'Cyprus', 'Azerbaijan', 'Kazakhstan', 'Moldova', 'Belarus', 'Lithuania', 'Latvia', 'Estonia', 'Luxembourg', 'Malta', 'Faroe Islands',
  'Andorra', 'San Marino', 'Gibraltar', 'Liechtenstein', 'Brazil', 'Argentina', 'Uruguay', 'Colombia', 'Chile', 'Peru', 'Ecuador',
  'Paraguay', 'Bolivia', 'Venezuela', 'Mexico', 'USA|United States|USMNT', 'Canada', 'Costa Rica', 'Panama', 'Jamaica', 'Honduras',
  'Japan', 'South Korea|Korea Republic', 'Australia', 'Iran', 'Saudi Arabia', 'Qatar', 'Morocco', 'Senegal', 'Egypt', 'Nigeria', 'Ghana',
  'Cameroon', 'Ivory Coast|Cote d\'Ivoire', 'Algeria', 'Tunisia', 'South Africa', 'DR Congo', 'Mali',
]) { const names = row.split('|'); for (const n of names) NATIONS.set(n.toLowerCase(), names[0]); }
const NATION_RE = new RegExp(`(?<![\\p{L}])(${[...NATIONS.keys()].sort((a, b) => b.length - a.length).map((n) => n.replace(/[.*+?^\${}()|[\]\\]/g, '\\$&')).join('|')})(?![\\p{L}])`, 'giu');
// the squad level: a men's, a women's and an U21 match of the same two nations are different matches
const LEVEL = /\b(women'?s?|ladies|u-?(\d\d)|under[- ]?(\d\d)|futsal|beach)\b/i;
export function nationalFixture(text) {
  const t = String(text || '');
  const found = new Set();
  const hits = [];
  for (const m of t.matchAll(NATION_RE)) { found.add(NATIONS.get(m[1].toLowerCase())); hits.push(m); }
  if (found.size !== 2) return null;
  // two nations in a sentence are not yet a match: they need a "vs" / dash right between them ("Italy-France",
  // "Armenia vs. Cyprus") or a match word somewhere (line-up, live, result, where to watch...)
  const [a, b] = [hits[0], hits.find((m) => NATIONS.get(m[1].toLowerCase()) !== NATIONS.get(hits[0][1].toLowerCase()))];
  const between = t.slice(a.index + a[0].length, b.index);
  if (!/^\s*(vs\.?|v|versus|against|x|[-–—])\s*$/i.test(between) && !matchPhase(t)) return null;
  const lv = t.match(LEVEL);
  return `n:${[...found].sort().join('+')}${lv ? `:${lv[1].toLowerCase().replace(/[^a-z\d]/g, '')}` : ''}`;
}

// the match an article names: { ents: 't1+t2' } from its two team tags, or { sides } from the headline, or { ents: 'n:..' }
// from the two nations the headline names
export function fixtureOf(it) {
  const teams = [...new Set((it.ents || []).filter((e) => e[0] === 't'))];
  if (teams.length === 2) return { ents: teams.sort().join('+') };
  const text = it.lang === 'en' ? it.title : it.tr?.en || it.title;
  const sides = headlineFixture(text);
  if (sides) return { sides };
  // football only: a cricket Test or a rugby league World Cup also names two nations, and is not one match of one phase
  const nat = it.sport === 'football' ? nationalFixture(text) : null;
  return nat ? { ents: nat, national: true } : null;
}
// two different matches (unknown = no conflict): different team pairs, or headline sides with nothing in common
export function otherMatch(a, b) {
  if (!a || !b) return false;
  if (a.ents && b.ents) return a.ents !== b.ents;
  if (a.sides && b.sides) {
    const x = new Set(a.sides.flat());
    return !b.sides.flat().some((t) => x.has(t));
  }
  return false;
}

// ---------- the phase of a match ----------
// The editors' rule (2026-11-12): the coverage before a match, during it and after it are separate stories. The same
// match is not the same story. The phase is read from the headline's English text (the original or the radar's
// translation); a headline that does not say stays unknown, and unknown never blocks and never joins by itself.
//   pre_match   previews, expected and confirmed line-ups, squads, where to watch, pre-match press conferences
//   live_match  live coverage, a running score, half-time
//   post_match  the result, the match report, highlights
// A TV / streaming listing is before the match even when it says "live".
const LISTING = /where to watch|how to watch|what time|(which|what) channel|tv channel|live stream|kick-?off time/i;
const LIVE = /\blive\b|\buživo\b|liveticker|live[- ]?blog|live updates|\bminute\b|half[- ]?time|(first|second|1st|2nd) half|\(part \d\)|\bdirect\b|en vivo|as it happens/i;
const PRE = /preview|prediction|predicted|predictions|line-?ups?|starting (xi|eleven|11)|possible 11|team news|\bsquad\b|\bodds\b|\btips\b|betting|called up|call-ups?|press conference|\bh2h\b|head-to-head|probable/i;
const POST = /\bbeat\b|\bbeats\b|\bwon\b|\bwins\b|\bdefeat(ed|s)?\b|\bdraw\b|\bdrew\b|thrash|victory|highlights|as it happened|player ratings|match report|full[- ]time|\bafter the (game|match|win|defeat|draw|loss)\b/i;
// a result ("3-1", "80:66"), not a time ("19:00", "8.45pm") or a date ("18/10/2026")
const hasScore = (t) => [...t.matchAll(/(?<![\d./])(\d{1,3})\s?[-:–]\s?(\d{1,3})(?![\d/])/g)].some((m) => (+m[1] <= 15 && +m[2] <= 15) || (+m[1] >= 40 && +m[2] >= 40));
export function matchPhase(text) {
  const t = String(text || '');
  if (LISTING.test(t)) return 'pre_match';
  if (LIVE.test(t)) return 'live_match';
  if (PRE.test(t)) return 'pre_match';
  if (POST.test(t) || hasScore(t)) return 'post_match';
  return null;
}

// A story takes articles for 20 hours from its FIRST article. (It used to be 20 hours from its newest one, so every
// new article moved the limit and a story could keep growing for the whole two days the radar remembers.)
const WINDOW = 20 * 3600 * 1000;
const CORE = 8; // a new article must match one of the story's first 8 articles
const SPORTY = new Set(['football', 'basketball']);
// a near copy of a headline: what an article needs to cross between a match story and a story that names no match
function nearCopy(a, b) {
  let shared = 0;
  for (const t of a) if (b.has(t)) shared++;
  const min = Math.min(a.size, b.size);
  return min > 0 && shared >= 4 && shared / min >= 0.7;
}

export function clusterItems(items) {
  const sorted = [...items].sort((a, b) => a.published - b.published);
  const clusters = [];
  const index = new Map(); // token -> Set(cluster idx)

  for (const it of sorted) {
    // Compare stories across languages using the English text (original or translation)
    const en = it.lang === 'en' ? it.title : it.tr?.en;
    it._key = en ? 'x' : it.lang;
    it._tok = tokens(en || it.title);
    it._match = fixtureOf(it);
    const phase = matchPhase(en || it.title); // kept here, not on the article: nothing new is saved in the memory
    const candidates = new Map();
    for (const t of it._tok) for (const c of index.get(t) || []) candidates.set(c, (candidates.get(c) || 0) + 1);

    let found = -1;
    // check strongest candidates first
    for (const [c] of [...candidates].sort((x, y) => y[1] - x[1]).slice(0, 25)) {
      const cl = clusters[c];
      if (cl.key !== it._key || it.published - cl.first > WINDOW) continue;
      // never mix football and basketball in one story (Hapoel Tel Aviv vs Real Madrid exists in both)
      if (cl.sport && it.sportSure && SPORTY.has(it.sport) && it.sport !== cl.sport) continue;
      // never two different matches in one story
      if (cl.fixtures.some((f) => otherMatch(f, it._match))) continue;
      // never two phases of one match in one story (the preview, the live coverage and the result are three stories)
      if (it._match && phase && cl.phase && phase !== cl.phase) continue;
      const core = cl.items.slice(0, CORE);
      // A match story (most of its first articles name a match) and an article that names no match, or the other
      // way round: news about a club that plays in the match is not the match. Club names and common words are not
      // enough here. The article joins only when it is a near copy of one of the story's first headlines, or when
      // it is clearly from the same phase as the match story (a result that tags only one of the two teams).
      const matchStory = cl.named > 0 && cl.named * 2 >= core.length;
      if (matchStory !== !!(it._match && !it._match.national)) { // (a national-team match only blocks: it never makes a story a "match story")
        const samePhase = phase && phase === cl.phase && core.some((m) => similar(m._tok, it._tok));
        if (!samePhase && !core.some((m) => nearCopy(m._tok, it._tok))) continue;
        found = c;
        break;
      }
      // compare with the story's core (its first articles), not its newest member, so it can't drift
      // article by article into another story
      if (core.some((m) => similar(m._tok, it._tok))) {
        found = c;
        break;
      }
    }
    if (found === -1) {
      found = clusters.length;
      clusters.push({ key: it._key, items: [], first: it.published, last: it.published, sport: null, fixtures: [], named: 0, phase: null });
    }
    const cl = clusters[found];
    if (!cl.sport && it.sportSure && SPORTY.has(it.sport)) cl.sport = it.sport;
    cl.items.push(it);
    if (it._match && cl.fixtures.length < 6) cl.fixtures.push(it._match);
    if (it._match && !it._match.national && cl.items.length <= CORE) cl.named++; // how many of the story's first articles name a match
    if (!cl.phase && it._match && phase) cl.phase = phase; // the phase of the first article that names the match and says it
    cl.last = Math.max(cl.last, it.published);
    for (const t of it._tok) {
      if (!index.has(t)) index.set(t, new Set());
      index.get(t).add(found);
    }
  }
  return joinSameMatch(clusters).map((c) => c.items);
}

// One story per match PHASE: groups of the same language that are mostly about the same match (its two team tags)
// and in the same phase join, so two previews or two result reports stay one story even when their wording differs.
// The preview, the live coverage and the result stay apart, and a group whose phase is unknown is left as it is.
// The 20 hours count from the first group's first article (they used to count from the newest article).
function joinSameMatch(clusters) {
  const matchOf = (cl) => {
    const n = new Map();
    let named = 0;
    for (const f of cl.fixtures) if (f.ents) { named++; n.set(f.ents, (n.get(f.ents) || 0) + 1); }
    const top = [...n].sort((a, b) => b[1] - a[1])[0];
    return top && top[1] >= named * 0.6 ? top[0] : null;
  };
  const byMatch = new Map();
  const out = [];
  for (const cl of clusters) {
    const m = matchOf(cl);
    if (!m || !cl.phase) {
      out.push(cl);
      continue;
    }
    const k = `${cl.key}|${m}|${cl.phase}`;
    (byMatch.get(k) || byMatch.set(k, []).get(k)).push(cl);
  }
  for (const group of byMatch.values()) {
    group.sort((a, b) => a.items[0].published - b.items[0].published);
    let cur = group[0];
    for (const cl of group.slice(1)) {
      if (cl.items[0].published - cur.first <= WINDOW) {
        cur.items = [...cur.items, ...cl.items].sort((a, b) => a.published - b.published);
        cur.last = Math.max(cur.last, cl.last);
      } else {
        out.push(cur);
        cur = cl;
      }
    }
    out.push(cur);
  }
  return out;
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
  let score = weightSum + velocity * 0.8; // spreading fast counts
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
    ...(members.some((m) => m.reporter) ? { reporter: true } : {}),
    ...(members.some((m) => m.official) ? { official: true } : {}),
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
    ...(rising(members, now) || {}),
  };
}

// "Picking up speed": 4+ outlets first published it in the last 30 minutes, and they are at least half of all its
// outlets (a new story spreading, or an old one blowing up again). Dated articles only; each outlet counts once.
export const RISE_MIN = 30;
export function rising(members, now) {
  const firstBy = new Map();
  for (const m of members) {
    if (m.dateUnknown || !m.published || m.published > now + 5 * 60e3) continue;
    const k = pubKey(m.publisher);
    if (!firstBy.has(k) || m.published < firstBy.get(k)) firstBy.set(k, m.published);
  }
  const all = new Set(members.map((m) => pubKey(m.publisher))).size;
  const n = [...firstBy.values()].filter((t) => now - t <= RISE_MIN * 60e3).length;
  return n >= 4 && n * 2 >= all ? { rise: { n, at: now } } : null;
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
