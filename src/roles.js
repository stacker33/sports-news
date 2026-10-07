// Source roles, evidence and coverage (discovery version, stage 2).
//
// Three things are kept apart, because they are easy to confuse:
// - origin: is the publisher Israeli or foreign? From explicit metadata (the outlet, its domain, a Hebrew name),
//   never from the language: The Jerusalem Post is Israeli in English; Marca writing about Maccabi is foreign.
// - role: Sport5 (the coverage reference), an Israeli competitor, foreign press, an official channel, a reporter,
//   an aggregator.
// - evidence: how many outlets published it (spread) is not how many confirmed it. Five Israeli sites repeating
//   one Marca report are one report. Explicit attribution ("according to Marca") links them to a shared origin;
//   similar titles alone prove nothing, so independence is never asserted.
import { isSport5 } from './sport5.js';

// Israeli outlets that publish in English or appear under a Latin name in Google News
const ISRAELI_PUBLISHERS = /^(the )?(jerusalem post|jpost|times of israel|i24 ?news|israel hayom|ynet ?news|ynet|haaretz|israel national news|arutz sheva|globes|calcalist|sport5|sport 5|one|walla|maariv|kan|kan news|channel 12|n12|mako|davar|zman israel|the marker|jewish news syndicate|jns)( english)?$/i;
const ISRAELI_DOMAIN = /(^|\.)[a-z0-9-]+\.(co|org|net|ac|gov|muni)\.il$|\.il$/i;
const HEBREW = /[֐-׿]/;
// sites that mostly republish others' work: never treated as an original report
const AGGREGATORS = /^(msn|yahoo|yahoo news|newsnow|newsbreak|flipboard|inkl|ground news|google news|head topics|newsbeezer|archysport)$/i;

const host = (link) => {
  try {
    return new URL(link).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
};

// → { origin: 'il' | 'foreign' | 'unknown', basis }
export function itemOrigin(m, src = {}) {
  const pub = String(m.publisher || '').trim();
  if (src.origin) return { origin: src.origin, basis: 'source-metadata' };
  if (HEBREW.test(pub)) return { origin: 'il', basis: 'hebrew-publisher' };
  if (ISRAELI_PUBLISHERS.test(pub)) return { origin: 'il', basis: 'known-israeli-outlet' };
  const h = m.google ? '' : host(m.link);
  if (h && ISRAELI_DOMAIN.test(h)) return { origin: 'il', basis: 'israeli-domain' };
  if (ISRAELI_DOMAIN.test(pub)) return { origin: 'il', basis: 'israeli-domain' };
  if (!m.google && src.lang === 'he') return { origin: 'il', basis: 'hebrew-outlet' };
  if (!pub && m.google) return { origin: 'unknown', basis: 'no-publisher' };
  return { origin: 'foreign', basis: src.country ? 'source-country' : 'publisher' };
}

// → 'sport5' | 'official' | 'reporter' | 'competitor' | 'aggregator' | 'foreign-press' | 'unknown'
export function itemRole(m, src = {}, origin = itemOrigin(m, src).origin) {
  if (isSport5(m)) return 'sport5';
  if (m.official || src.official) return 'official';
  if (m.social || (m.reporter && src.reporter)) return 'reporter';
  if (origin === 'il') return 'competitor';
  if (AGGREGATORS.test(String(m.publisher || '').trim())) return 'aggregator';
  return origin === 'foreign' ? 'foreign-press' : 'unknown';
}

// ---------- attribution ----------
// Outlets and reporters often cited by name, with their Hebrew spellings
const CITED = [
  ['Marca', ['marca', 'מרקה', 'מארקה']],
  ['Mundo Deportivo', ['mundo deportivo', 'מונדו דפורטיבו']],
  ["L'Équipe", ["l'equipe", 'lequipe', "ל'אקיפ", 'לאקיפ']],
  ['La Gazzetta dello Sport', ['gazzetta', 'גאזטה', 'גצטה']],
  ['Corriere dello Sport', ['corriere dello sport', 'קוריירה דלו ספורט']],
  ['Tuttosport', ['tuttosport', 'טוטוספורט']],
  ['Sky Sports', ['sky sports', 'sky sport', 'סקיי ספורטס', 'סקיי ספורט']],
  ['The Athletic', ['the athletic', 'דה אתלטיק', 'אתלטיק']],
  ['ESPN', ['espn']],
  ['Fabrizio Romano', ['fabrizio romano', 'פבריציו רומאנו', 'פבריציו רומנו']],
  ['Shams Charania', ['shams charania', 'shams', 'שאמס']],
  ['Marc Stein', ['marc stein', 'מארק סטיין']],
  ['Bild', ['bild', 'בילד']],
  ['kicker', ['kicker', 'קיקר']],
  ['A Bola', ['a bola', 'א בולה']],
  ['Record', ['jornal record']],
  ['Eurohoops', ['eurohoops', 'יורוהופס']],
  ['Sportando', ['sportando', 'ספורטנדו']],
  ['BasketNews', ['basketnews', 'בסקט ניוז']],
  ['Daily Mail', ['daily mail', 'דיילי מייל']],
  ['The Sun', ['the sun', 'דה סאן']],
  ['Mirror', ['daily mirror', 'מירור']],
  ['Telegraph', ['telegraph', 'טלגרף']],
  ['The Guardian', ['guardian', 'גרדיאן']],
  ['BBC', ['bbc', 'בי בי סי']],
  ['RMC Sport', ['rmc']],
  ['Relevo', ['relevo', 'רלבו']],
  ['Gianluca Di Marzio', ['di marzio', 'די מרציו']],
  ['Voetbal International', ['voetbal international']],
  ['Novasports', ['novasports', 'נובהספורטס']],
  ['Gazeta Sporturilor', ['gazeta sporturilor', 'gsp']],
];
// a cue that the text is reporting someone else's report
const CUE = /according to|reports?\b|reported|reportedly|via\b|citing|told\b|in an interview with|לפי|על פי|עפ"י|דיווח|מדווח|מדווחים|פרסום|פורסם|פרסמו|חשף|חושף|חושפים|בראיון ל|סיפר ל|כך לפי|segun|según|secondo|selon|laut|volgens|segundo/i;
const fold = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[ְ-ׇ]/g, '');
const pubKey = (p) => fold(p).replace(/^the\s+/, '').replace(/[^\p{L}\p{N}]/gu, '');
const wordRe = (t) => new RegExp(`(^|[^\\p{L}])${fold(t).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^\\p{L}])`, 'u');
const CITED_RE = CITED.map(([name, forms]) => [name, forms.map(wordRe)]);

// Outlets a member explicitly cites (with a reporting cue), never itself
export function citedBy(m) {
  const text = `${m.title} ${m.summary || ''}`;
  if (!CUE.test(text)) return [];
  const t = fold(text);
  const own = pubKey(m.publisher);
  return CITED_RE.filter(([name, res]) => pubKey(name) !== own && res.some((re) => re.test(t))).map(([name]) => name);
}

// ---------- story evidence ----------
// members carry .publisher, .link, .published, .dateUnknown, .google, .summary (items are shared with the saved
// state, so origin and role are kept in a local map, not written onto them)
export function storyEvidence(s, srcOf = () => ({})) {
  const members = s._members || [];
  const info = new Map();
  for (const m of members) {
    const src = srcOf(m) || {};
    const o = itemOrigin(m, src).origin;
    info.set(m, { o, r: itemRole(m, src, o) });
  }
  const O = (m) => info.get(m).o;
  const R = (m) => info.get(m).r;
  const byPub = new Map();
  for (const m of members) {
    const k = pubKey(m.publisher) || m.link;
    if (!byPub.has(k) || m.published < byPub.get(k).published) byPub.set(k, m);
  }
  const outlets = [...byPub.values()];
  const count = (o) => outlets.filter((m) => O(m) === o).length;

  // explicit attribution: which outlet do the others cite?
  const cites = new Map();
  for (const m of outlets) for (const name of citedBy(m)) cites.set(name, (cites.get(name) || 0) + 1);
  const [attrib, attribBy] = [...cites.entries()].sort((a, b) => b[1] - a[1])[0] || [null, 0];

  const foreign = outlets.filter((m) => O(m) === 'foreign' && R(m) !== 'aggregator');
  const earliest = (list) => [...list].sort((a, b) => (a.dateUnknown ? 1 : 0) - (b.dateUnknown ? 1 : 0) || a.published - b.published)[0];
  let lead;
  let status;
  const cited = attrib && outlets.find((m) => pubKey(m.publisher) === pubKey(attrib));
  if (outlets.length === 1) [lead, status] = [outlets[0], 'only'];
  else if (cited) [lead, status] = [cited, 'attributed']; // the outlet the others cite is in the story
  else if (attrib && foreign.length) [lead, status] = [earliest(foreign), 'cites-uncollected']; // cited, but its own article was not collected
  else if (foreign.length) [lead, status] = [earliest(foreign), 'earliest']; // originality unknown
  else [lead, status] = [earliest(outlets), 'domestic'];

  return {
    lead: lead ? { name: lead.publisher, link: lead.link, origin: O(lead), role: R(lead), status } : null,
    outlets: outlets.length,
    il: count('il'),
    foreign: count('foreign'),
    unknown: count('unknown'),
    ...(attrib ? { attrib, attribBy } : {}),
    independent: 'unknown', // never asserted from headlines
    official: outlets.some((m) => R(m) === 'official'),
    reporter: outlets.some((m) => R(m) === 'reporter'),
    comp: [...new Set(outlets.filter((m) => R(m) === 'competitor').map((m) => m.publisher))].slice(0, 6),
    // per link: origin / role, for the story's source list
    roles: Object.fromEntries(members.map((m) => [m.link, [O(m), R(m)]])),
    basis: members.some((m) => m.summary) ? 'headline+description' : 'headline',
  };
}

// ---------- coverage ----------
// s5check = { at: last successful read of a Sport5 source, ok: whether that read is recent enough to trust }
// → { s5: 'match' | 'possible' | 'channel' | 'none' | 'unavailable', at?, link?, newer?, checkedAt?, comp: [competitors] }
export function storyCoverage(s, s5check = {}, ev = s.ev) {
  const base = { comp: ev?.comp || [] };
  if (s.s5?.where === 'channel') return { ...base, s5: 'channel', at: s.s5.at, link: s.s5.link };
  if (s.s5?.probable) return { ...base, s5: 'possible', at: s.s5.at, link: s.s5.link };
  if (s.s5) return { ...base, s5: 'match', at: s.s5.at, link: s.s5.link, newer: s.s5.newer };
  // no match: only say so when Sport5 was read successfully recently; otherwise the check is unavailable
  if (!s5check.ok || !s5check.at) return { ...base, s5: 'unavailable', ...(s5check.at ? { checkedAt: s5check.at } : {}) };
  return { ...base, s5: 'none', checkedAt: s5check.at };
}

// Truthful coverage labels (the app has its own copy of this wording)
export function coverageLabel(cov, lang = 'en', fmt = (t) => new Date(t).toISOString().slice(11, 16)) {
  const he = lang === 'he';
  switch (cov?.s5) {
    case 'match': return he ? 'נמצאה התאמה בספורט 5' : 'Match found on Sport5';
    case 'possible': return he ? 'התאמה אפשרית בספורט 5' : 'Possible match on Sport5';
    case 'channel': return he ? 'נמצא רק בערוצי ספורט 5' : 'Found on Sport5 channels only';
    case 'none': return he ? `לא נמצאה התאמה - נבדק לאחרונה ${fmt(cov.checkedAt)}` : `No match found - last checked ${fmt(cov.checkedAt)}`;
    default: return he ? 'בדיקת הכיסוי לא זמינה' : 'Coverage check unavailable';
  }
}

// Sport5's last good read: the freshest successful read of its site sources (homepage / Google results for the site)
const S5_SITE = ['sport5-home', 'sport5'];
export function sport5Check(meta = {}, now = Date.now(), maxAgeMin = 90) {
  const at = Math.max(0, ...S5_SITE.map((id) => meta[id]?.lastOk || 0));
  return { at: at || null, ok: !!at && now - at <= maxAgeMin * 60000 };
}

// ---------- views ----------
// Which views a story belongs to. Views only filter what is shown: every source is still collected.
//  f - foreign discovery: at least one foreign-origin report
//  i - Israeli monitoring: an Israeli-origin report, or an Israeli subject
export function storyViews(s, ev = s.ev) {
  const v = [];
  if (ev?.foreign > 0) v.push('f');
  if (ev?.il > 0 || s.israel) v.push('i');
  return v;
}
