// Multi-source story summaries: which sources the model sees, what it must return, how the answer is checked against the
// sources, and when a summary is worth writing again. No network, no model calls in here: src/ai.js makes the (one)
// request per run it always made; this module only decides its input, validates its output and decides about refreshes.
//
// What the data really is: a story's articles carry a headline, the outlet and (for about a third of them) the feed's own
// short description. Nothing here has read a full article, and nothing here can verify a claim: a citation means "this
// source's headline or description says it", and a number check means "the digits appear in the cited sources' text".
import { shorten } from './summaries.js';

export const RICH_MIN_SOURCES = 3; // distinct outlets before a story gets the multi-source treatment
export const MAX_SOURCES = 8; // sources the model sees (the old input: 6 headlines + 3 descriptions)
export const CHAR_BUDGET = 2600; // characters of source text for one story (headlines + descriptions)
export const REFRESH_MIN_MS = 45 * 60e3; // never twice within 45 minutes
export const REFRESH_MAX_PER_DAY = 2; // and at most twice a day, whatever happens

const pubKey = (p) => String(p || '').toLowerCase().replace(/^the\s+/, '').replace(/[^\p{L}\p{N}]/gu, '').replace(/(com|couk|coil)$/, '');
const clip = (s, n) => (s && s.length > n ? s.slice(0, n - 1) + '…' : s || '');
const textOf = (m) => (m.lang === 'en' ? m.title : m.tr?.en || m.title);

// ---------- facts in a text ----------
const SEP = /(?<=\d)[,.](?=\d{3}\b)/g; // 1,000,000 → 1000000
// money: €40m, 40 million euros, $12.5M, 25 מיליון יורו
const MONEY = /(?:[€$£]\s?(\d+(?:[.,]\d+)?)\s?(m|k|million|billion|bn|מיליון|מיליארד|אלף)?)|(?:(\d+(?:[.,]\d+)?)\s?(m|k|million|billion|bn|מיליון|מיליארד|אלף)(?![\p{L}\d]))/giu;
const UNIT = { m: 1e6, million: 1e6, 'מיליון': 1e6, k: 1e3, 'אלף': 1e3, billion: 1e9, bn: 1e9, 'מיליארד': 1e9 };
const DURATION = /(\d{1,3})\s?(weeks?|months?|years?|games?|matches|days?|שבועות|חודשים|שנים|משחקים|ימים|יום)(?![\p{L}\d])/giu;
// a year only when it is the end of a contract ("until 2030"): 2026 in a headline is just the season
const YEAR = /(?:until|through|till|to the end of|expires?(?: in)?|עד)\s+(?:the end of\s+)?(?:june\s+)?(20[2-3]\d)\b/gi;
const SCORE = /(?<![\d./:])(\d{1,2})\s?[-–:]\s?(\d{1,2})(?![\d/])/g;

// { money: Set('m:40000000'), dur: Set('d:6:month'), year: Set('y:2028'), score: Set('s:0-3'), digits: Set('40','2028') }
export function factsOf(text) {
  const t = String(text || '').replace(SEP, '');
  const out = { money: new Set(), dur: new Set(), year: new Set(), score: new Set(), digits: new Set() };
  for (const m of t.matchAll(MONEY)) {
    const n = Number((m[1] || m[3]).replace(',', '.'));
    const u = UNIT[(m[2] || m[4] || '').toLowerCase()] || 1;
    if (n * u >= 1000) out.money.add(`m:${Math.round(n * u)}`);
  }
  for (const m of t.matchAll(DURATION)) out.dur.add(`d:${m[1]}:${m[2].toLowerCase().replace(/s$/, '').replace(/^(weeks?|שבועות)$/, 'week').replace(/^(months?|חודשים)$/, 'month').replace(/^(years?|שנים)$/, 'year').replace(/^(games?|matches|משחקים)$/, 'game').replace(/^(days?|ימים|יום)$/, 'day')}`);
  for (const m of t.matchAll(YEAR)) out.year.add(`y:${m[1]}`);
  for (const m of t.matchAll(SCORE)) out.score.add(`s:${[m[1], m[2]].sort().join('-')}`);
  for (const m of t.matchAll(/\d+(?:[.,]\d+)?/g)) out.digits.add(m[0].replace(',', '.'));
  return out;
}
// the facts a refresh cares about: money, durations, years (a score changes every minute of a live match)
const keyFacts = (f) => [...f.money, ...[...f.dur].filter((d) => !/:year$/.test(d)), ...f.year];

// ---------- the story's stage ----------
// A match is not a transfer: line-ups, previews, live pages and results have no rumour / agreement / signing stage.
const MATCHY = /line-?ups?|starting (xi|eleven|11)|team news|prediction|preview|\blive\b|\bvs\.?\b|highlights|summary|round \d|matchday|match (report|summary)|player ratings|full[- ]time|\d\s?[-:]\s?\d/i;
const STAGE = [
  [1, /\b(rumou?rs?|linked (with|to)|interest(ed)? in|eyes|monitor(ing)?|considering|tracking|on (the )?radar)\b|שמוע|מעוניינ/i],
  [2, /\b(talks|negotiat\w*|discussions|bid|proposal)\b|מגעים|משא ומתן/i],
  [3, /\b(agree[sd]? (a |the )?(deal|terms|fee|contract)|agreement|deal (done|agreed|reached|sealed)|here we go|verbal agreement|set to sign)\b|הסכם|הגיע להסכם|הגיעה להסכם/i],
  [4, /\b(officially|official (announcement|statement)|announce[sd]? (the )?(signing|deal|contract|appointment|departure|exit|signing of)|unveil\w*|completes? (the )?(signing|transfer|move)|signs? (a )?(new )?contract)\b|רשמית|הוכרז/i],
];
const DENIAL = /\b(den(y|ies|ied)|denial|dismiss(es|ed)|rubbish(es|ed)) (the )?(reports?|claims?|rumou?rs?|moves?|talks|interest|story)\b|\bfake news\b|\b(denies|denied) (that |any |a )?(move|talks|deal|contact|offer)|הכחיש|הכחשה/i;
export const stageOf = (text) => (MATCHY.test(text) ? 0 : STAGE.reduce((r, [n, re]) => (re.test(text) ? Math.max(r, n) : r), 0));
// An injury has its own steps: a suspicion ("believed to have torn", "scare", "doubtful") and then the firm news (confirmed, diagnosed,
// ruled out, out for the season, surgery). The step up is a development an editor must see. Not for match pages.
const INJURY = /\b(injur\w*|torn|tear|tears|tore|ruptur\w*|fractur\w*|hamstring|ligament|achilles|surgery|ruled out|season-ending|miss the (season|rest))\b|פציע|קרע|ניתוח/i;
const HEDGE = /\b(believed|suspected|feared|fears|reportedly|reports?|could|may|might|possible|possibly|scare|doubt\w*|worr\w+|sources)\b|חשש|חשד|ספק/i;
const FIRM = /\b(confirm(ed|s)?|diagnos\w*|ruled out|out for|will miss|expected to miss|season-ending|undergo(es)? surgery|underwent surgery|has torn|tears|tore|ruptured)\b|אושר|ייעדר|יחמיץ/i;
export const injuryStage = (text) => { const t = String(text || ''); if (MATCHY.test(t) || !INJURY.test(t)) return 0; return FIRM.test(t) && !HEDGE.test(t) ? 2 : 1; };
export const denies = (text) => !MATCHY.test(String(text || '')) && DENIAL.test(String(text || ''));

// ---------- choosing the sources ----------
const STOP = new Set('the a an and or of to in on at for from by with as is are was were be been it its this that after before over into out up down about says say said report reports live latest news update'.split(' '));
// words every template page shares (not a topic): never evidence that two articles are about one thing
const GENERIC = new Set('today tonight match matches football soccer live results result schedule watch stream streaming channel tickets odds prediction predictions preview picks free promo code bonus betting cover forecast weather sport sports league premier serie liga bundesliga sunday monday tuesday wednesday thursday friday saturday october november stats team players player lineups lineup time where full highlights update news'.split(' '));
const toks = (t) => new Set(String(t || '').toLowerCase().replace(/[^\p{L}\d\s]/gu, ' ').split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w)));
const jacc = (a, b) => { let i = 0; for (const x of a) if (b.has(x)) i++; return i / Math.max(1, a.size + b.size - i); };
const QUOTE = /["“”«»״]/;

// One candidate per outlet: the article with a description, an official / reporter one first, a direct (non-Google) link,
// then the best weight, then the earliest.
function perOutlet(members, descOf) {
  const by = new Map();
  for (const m of members) {
    const k = pubKey(m.publisher);
    const rank = (x) => [descOf(x) ? 1 : 0, x.official ? 1 : 0, x.reporter ? 1 : 0, x.google ? 0 : 1, x.weight || 0, -x.published];
    const cur = by.get(k);
    if (!cur) { by.set(k, m); continue; }
    const a = rank(m), b = rank(cur);
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) { if (a[i] > b[i]) by.set(k, m); break; }
  }
  return [...by.values()];
}

// A story is sometimes a pile: template pages of another match, other sports and unrelated pages sit inside it ("Pau - Leicester" and a
// court hearing inside "Fiorentina vs Como", eleven Rodez - Montpellier pages inside "Parma - Torino", "Real Madrid Castilla vs Antequera"
// inside "Real Madrid vs Sevilla"). The story's FOCUS is learned from its own tagged articles: the clubs / players most of them carry, and
// the words that name them (from the headlines of the articles that carry the tag). A source is about the story when it carries a focus
// tag or names a focus word; a headline "X vs Y" must name the focus on both sides. Everything else is not sent to the model.
// Only for 6+ outlets. A source with no tag and no English text cannot be judged and stays.
const SPORT_KIND = [
  ['match', (t) => MATCHY.test(t)],
  ['sanction', (t) => /\b(suspen\w*|banned?|fined?|sanction\w*|punish\w*|disciplin\w*)\b/i.test(t)],
  ['injury', (t) => INJURY.test(t)],
  ['transfer', (t) => /\b(transfers?|signing|signs?|signed|contract|loan|fee|bid|agree[sd]?|deal|extends?|release clause)\b/i.test(t)],
];
export const kindOf = (t) => (SPORT_KIND.find(([, f]) => f(t)) || [])[0] || null;

// "Real Madrid Castilla vs Antequera de Primera Federación: where to watch" -> the words of the two sides (before the first colon / comma)
function sidesOf(text) {
  const head = String(text || '').split(/[:|,(]/)[0];
  const m = head.match(/^(.{2,60}?)\s+(?:vs\.?|v\.?|x|versus|contra|-|–|—)\s+(.{2,70})$/i);
  return m ? [[...toks(m[1])], [...toks(m[2])]] : null;
}

function relevance(cands) {
  const off = new Set();
  const res = { off, mixed: false, why: '' };
  if (cands.length < 6) return res;
  const tagsOf = (c) => (c.m.ents || []).filter((e) => /^[tp]/.test(e));
  const idCount = new Map();
  for (const c of cands) for (const id of new Set(tagsOf(c))) idCount.set(id, (idCount.get(id) || 0) + 1);
  const need = Math.max(2, Math.ceil(cands.length * 0.4));
  const topIds = new Set([...idCount].filter(([, n]) => n >= need).map(([id]) => id));
  // the words that name the focus: in at least 40% of the headlines of the articles that carry a focus tag
  const carriers = cands.filter((c) => tagsOf(c).some((id) => topIds.has(id)));
  const wc = new Map();
  for (const c of carriers) for (const w of toks(textOf(c.m))) if (w.length > 3 && !GENERIC.has(w)) wc.set(w, (wc.get(w) || 0) + 1);
  const names = new Set([...wc].filter(([, n]) => n >= Math.max(2, Math.ceil(carriers.length * 0.4))).map(([w]) => w));
  const mentions = (c) => [...toks(textOf(c.m))].some((w) => names.has(w));
  if (topIds.size && names.size) {
    cands.forEach((c, i) => {
      const ids = tagsOf(c);
      const text = textOf(c.m);
      const onFocus = ids.some((id) => topIds.has(id)) || mentions(c);
      let bad = !onFocus;
      // "X vs Y" where one side is not the focus: another match that shares a club (Real Madrid Castilla vs Antequera)
      const sides = sidesOf(text);
      if (!bad && sides && topIds.size >= 2) {
        const hit = sides.map((side) => side.some((w) => names.has(w)));
        if (!(hit[0] && hit[1])) bad = true;
      }
      if (bad && !ids.length && !(c.m.lang === 'en' || c.m.tr?.en)) bad = false; // cannot be judged
      if (bad) off.add(i);
    });
  } else {
    // no tags to anchor on: only the frequent non-generic words
    const wCount = new Map();
    for (const c of cands) for (const w of toks(textOf(c.m))) wCount.set(w, (wCount.get(w) || 0) + 1);
    const top = new Set([...wCount].filter(([w, n]) => n >= Math.max(2, Math.ceil(cands.length * 0.25)) && w.length > 3 && !GENERIC.has(w)).map(([w]) => w));
    if (top.size) cands.forEach((c, i) => { if ((c.m.lang === 'en' || c.m.tr?.en) && ![...toks(textOf(c.m))].some((w) => top.has(w))) off.add(i); });
  }
  // too mixed to tell one story: most of the sources are off the focus, or there is no focus at all among tagged sources, or the sources are
  // about two different kinds of event (an injury and a sanction of one player) in similar numbers
  const on = cands.filter((_, i) => !off.has(i));
  const tagged = cands.filter((c) => tagsOf(c).length).length;
  if (on.length < 3) { res.mixed = true; res.why = 'fewer than 3 sources are about the focus'; }
  else if (tagged >= cands.length * 0.5 && !topIds.size) { res.mixed = true; res.why = 'no club or player is common to the sources'; }
  else {
    const kinds = new Map();
    for (const c of on) { const k = kindOf(textOf(c.m)); if (k) kinds.set(k, (kinds.get(k) || 0) + 1); }
    const total = [...kinds.values()].reduce((x, y) => x + y, 0);
    const top2 = [...kinds].sort((x, y) => y[1] - x[1]).slice(0, 2);
    if (total >= 5 && top2.length === 2 && top2[1][1] >= total * 0.3 && !(top2.some(([k]) => k === 'match') && top2.length === 2 && top2.every(([k]) => k === 'match' || k === 'transfer') && false)) { res.mixed = true; res.why = `two kinds of event: ${top2.map((x) => x.join(' ')).join(', ')}`; }
  }
  return res;
}

// sums: the radar's cache of fetched page descriptions { [articleId]: { text } }.
// Returns { sel: [{ sid, m, desc, official, reporter, copyOf? }], total, omitted, copies } in time order; sids S1.. by time.
export function selectSources(members, sums = {}, { max = MAX_SOURCES, budget = CHAR_BUDGET } = {}) {
  const descOf = (m) => shorten(m.summary || '', m.title) || sums[m.id]?.text || '';
  const cands = perOutlet(members, descOf).map((m) => ({ m, desc: descOf(m), tk: toks(m.title), f: factsOf(`${textOf(m)} ${descOf(m)}`), official: !!m.official, reporter: !!m.reporter }));
  const rel = relevance(cands);
  const off = rel.off;
  const offKeys = new Set([...off].map((i) => pubKey(cands[i].m.publisher)));
  for (const i of [...off].sort((a, b) => b - a)) cands.splice(i, 1);
  cands.sort((a, b) => a.m.published - b.m.published || (a.m.id < b.m.id ? -1 : 1));
  // copies: the same headline (or the same description) from another outlet adds nothing; the earliest is the original candidate
  const kept = [];
  let copies = 0;
  for (const c of cands) {
    const twin = kept.find((k) => jacc(k.tk, c.tk) >= 0.8 || (c.desc && c.desc === k.desc));
    if (twin && !c.official && !c.reporter && keyFacts(c.f).every((x) => keyFacts(twin.f).includes(x))) { copies++; (twin.copies ||= []).push(c.m.publisher); continue; }
    kept.push(c);
  }
  // choose: official and reporters first, then whatever adds the most (new numbers, a quote, new words), within the budget
  const chosen = [];
  const seenFacts = new Set(), seenWords = new Set();
  let chars = 0;
  const cost = (c) => clip(c.m.title, 200).length + (c.desc ? clip(c.desc, 320).length : 0) + 30;
  const take = (c) => { chosen.push(c); chars += cost(c); for (const x of keyFacts(c.f)) seenFacts.add(x); for (const w of c.tk) seenWords.add(w); };
  for (const c of kept.filter((x) => x.official).slice(0, 2)) take(c);
  for (const c of kept.filter((x) => x.reporter && !chosen.includes(x)).slice(0, 2)) take(c);
  if (kept.length && !chosen.includes(kept[0])) take(kept[0]); // the earliest report: the best guess at the original
  while (chosen.length < max) {
    let best = null, bestScore = 0;
    for (const c of kept) {
      if (chosen.includes(c) || chars + cost(c) > budget) continue;
      const nf = keyFacts(c.f).filter((x) => !seenFacts.has(x)).length;
      const nw = [...c.tk].filter((w) => !seenWords.has(w)).length;
      const score = nf * 3 + (QUOTE.test(c.m.title + c.desc) ? 1.5 : 0) + (c.desc ? 2 : 0) + nw / 6 + (c.m.google ? 0 : 0.5) + (c.m.weight || 0) * 0.3;
      if (score > bestScore) { best = c; bestScore = score; }
    }
    if (!best) break;
    take(best);
  }
  chosen.sort((a, b) => a.m.published - b.m.published || (a.m.id < b.m.id ? -1 : 1));
  const sel = chosen.map((c, i) => ({ sid: `S${i + 1}`, m: c.m, desc: c.desc, official: c.official, reporter: c.reporter, ...(c.copies ? { copyOf: c.copies } : {}) }));
  return { sel, total: cands.length + off.size, omitted: kept.length - chosen.length, copies, offTopic: off.size, offKeys, mixed: rel.mixed, mixedWhy: rel.why };
}

// the story's articles without those of the outlets whose source was found off the story's focus
export const relevantMembers = (members, selection) => (selection.offKeys.size ? members.filter((m) => !selection.offKeys.has(pubKey(m.publisher))) : members);

// the text of the sources, as the model gets it
export function sourcesBlock(selection) {
  return selection.sel
    .map(({ sid, m, desc, official, reporter }) => {
      const tag = [official ? 'official club/league source' : '', reporter ? 'journalist' : '', m.lang].filter(Boolean).join(', ');
      const when = m.dateUnknown ? '' : new Date(m.published).toISOString().slice(11, 16) + 'Z ';
      return `${sid} (${m.publisher}; ${tag}; ${when.trim()}): ${clip(m.title, 200)}${desc ? ` — ${clip(desc, 320)}` : ''}`;
    })
    .join('\n');
}

export const RICH_ADDON = `
Stories whose input has a "Sources:" list (S1, S2, … with a stable id each) have several outlets. Combine them. For each such story also return:
- "claims": 2–4 objects {"he":"<one important fact in Hebrew>","src":["S1","S3"],"kind":"official"|"reported"|"rumor"|"analysis"}. "src" lists ONLY ids given above whose text really says it. kind "official" only when one of those sources is marked official (or the club/league itself announced it); a rumor, a "linked with", "could", "interested" or "according to X" is "rumor" or "reported", never a confirmed fact. Keep the attribution in the sentence ("לפי הדיווח של …"). Numbers, dates, fees, contract lengths only exactly as the cited source says.
- "added": 0–3 objects {"src":"S2","he":"<a detail ONLY this source (or very few) adds to the others>"}.
- "conflicts": [] unless two ids clearly state DIFFERENT values for the same thing (a fee, a contract length, an injury time-out, a score) or one denies what another reported: {"topic_he":"…","positions":[{"src":"S1","he":"…"},{"src":"S2","he":"…"}]}. Different wording of the same fact is not a conflict. When unsure, [].
The summary must carry every separate development that two or more sources report (for example a retirement announced days before a divorce): one short sentence each, most important first; leave out minor details, and never put into the summary something that is not in your own claims. Do not join different events into one account: if the sources describe different events (an injury and a suspension, two matches), write only about the one most of them describe.
Never cite an id that is not listed, never invent an outlet or a quotation, and say nothing the listed texts do not support. "summary_he" for such a story is 2–4 Hebrew sentences that combine the reports and keep who-said-what where it matters.`;

// ---------- checking the answer ----------
const digitsIn = (t) => [...String(t || '').replace(SEP, '').matchAll(/\d+(?:[.,]\d+)?/g)].map((m) => m[0].replace(',', '.'));
const KINDS = new Set(['official', 'reported', 'rumor', 'analysis']);

// raw: the model's story object. Returns { rich, dropped: { claims, added, conflicts, reasons: [] } }; rich is null when nothing survived.
// A citation is valid when the id was given AND (for a number) the digits are in the cited sources' own text.
export function validateRich(raw, selection) {
  const by = new Map(selection.sel.map((x) => [x.sid, x]));
  const text = (sid) => `${by.get(sid) ? textOf(by.get(sid).m) : ''} ${by.get(sid)?.m.title || ''} ${by.get(sid)?.desc || ''}`;
  const dropped = { claims: 0, added: 0, conflicts: 0, reasons: [] };
  const drop = (kind, why) => { dropped[kind]++; dropped.reasons.push(`${kind}:${why}`); };
  // A number is supported when its digits are in the cited text AND, for what has a unit (an amount, a length of time, a contract year, a
  // score), the same TYPED fact is: "30 days" needs "30 days" (or "30 ימים") in a cited source, not a 30 that means something else. This
  // is still not a check that the sentence is true.
  const supported = (he, sids) => {
    const have = new Set(sids.flatMap((s) => digitsIn(text(s))));
    if (!digitsIn(he).every((d) => have.has(d))) return false;
    const want = factsOf(he);
    const got = sids.map((s) => factsOf(text(s)));
    return ['money', 'dur', 'year', 'score'].every((k) => [...want[k]].every((x) => got.some((g) => g[k].has(x))));
  };
  const ids = (v) => [...new Set((Array.isArray(v) ? v : [v]).filter((x) => typeof x === 'string' && by.has(x)))];
  const claims = [];
  for (const c of Array.isArray(raw?.claims) ? raw.claims : []) {
    const he = String(c?.he || '').trim();
    const src = ids(c?.src);
    if (!he || !src.length) { drop('claims', 'no valid source'); continue; }
    if (Array.isArray(c.src) && c.src.some((x) => !by.has(x))) { drop('claims', 'invented source id'); continue; }
    if (!supported(he, src)) { drop('claims', 'number not in the cited sources'); continue; }
    let kind = KINDS.has(c.kind) ? c.kind : 'reported';
    if (kind === 'official' && !src.some((s) => by.get(s).official)) kind = 'reported'; // official only from an official source
    claims.push({ he: clip(he, 220), src, kind });
    if (claims.length >= 4) break;
  }
  const added = [];
  for (const a of Array.isArray(raw?.added) ? raw.added : []) {
    const he = String(a?.he || '').trim();
    const src = ids(a?.src);
    if (!he || src.length !== 1) { drop('added', 'no single valid source'); continue; }
    if (!supported(he, src)) { drop('added', 'number not in the cited source'); continue; }
    added.push({ src: src[0], he: clip(he, 200) });
    if (added.length >= 3) break;
  }
  const conflicts = [];
  for (const k of Array.isArray(raw?.conflicts) ? raw.conflicts : []) {
    const pos = (Array.isArray(k?.positions) ? k.positions : []).map((p) => ({ src: ids(p?.src)[0], he: String(p?.he || '').trim() })).filter((p) => p.src && p.he);
    const distinct = new Set(pos.map((p) => p.src));
    if (distinct.size < 2 || !String(k?.topic_he || '').trim()) { drop('conflicts', 'fewer than two valid sources'); continue; }
    if (pos.some((p) => !supported(p.he, [p.src]))) { drop('conflicts', 'number not in the cited source'); continue; }
    // a conflict is two different numbers, or a denial that the cited text itself contains
    const nums = pos.map((p) => new Set(digitsIn(p.he)));
    const differ = nums.every((n) => n.size) && new Set(nums.map((n) => [...n].sort().join(','))).size > 1;
    const denial = pos.some((p) => denies(text(p.src)));
    if (!differ && !denial) { drop('conflicts', 'no differing number and no denial in the cited text'); continue; }
    conflicts.push({ topic_he: clip(String(k.topic_he).trim(), 100), positions: pos.slice(0, 3).map((p) => ({ src: p.src, he: clip(p.he, 160) })) });
    if (conflicts.length >= 2) break;
  }
  const rich = claims.length || added.length || conflicts.length ? { claims, added, conflicts } : null;
  return { rich, dropped };
}

// A deterministic conflict, with no model: two outlets state different amounts in their headlines / descriptions and each
// states exactly one amount. Conservative on purpose (a fee, a salary and a release clause can sit in one text).
export function numericConflicts(selection) {
  const money = selection.sel
    .map((x) => ({ sid: x.sid, v: [...factsOf(`${x.m.title} ${x.desc}`).money] }))
    .filter((x) => x.v.length === 1);
  const out = [];
  for (let i = 0; i < money.length; i++) for (let j = i + 1; j < money.length; j++) {
    const a = Number(money[i].v[0].slice(2)), b = Number(money[j].v[0].slice(2));
    if (Math.abs(a - b) / Math.max(a, b) > 0.05) out.push({ kind: 'amount', sids: [money[i].sid, money[j].sid], values: [a, b] });
  }
  return out.slice(0, 2);
}

// ---------- when a summary is worth writing again ----------
// The signature is taken from ALL the story's articles when the summary is written. A later run compares: only a new official
// source, a new amount / duration / year, a status step up (rumour → talks → agreed → official) or a first denial brings the story
// back. The number of sources alone never does.
export function signature(members, sums = {}) {
  const facts = new Set();
  const words = new Set();
  let stage = 0, inj = 0, den = false;
  const off = [];
  for (const m of members) {
    const desc = shorten(m.summary || '', m.title) || sums[m.id]?.text || '';
    const t = `${textOf(m)} ${desc}`;
    for (const x of keyFacts(factsOf(t))) facts.add(x);
    for (const w of toks(t)) words.add(w);
    stage = Math.max(stage, stageOf(t));
    inj = Math.max(inj, injuryStage(t));
    den ||= denies(t);
    // an official source counts when it is a statement: not a club video (highlights, live) and not a match page
    if (m.official && !m.video && !MATCHY.test(t)) off.push(pubKey(m.publisher));
  }
  return { facts: [...facts].sort(), off: [...new Set(off)].sort(), stage, inj, den, words: words.size };
}

export function refreshReasons(prev, cur) {
  if (!prev) return ['new'];
  const why = [];
  if (cur.off.some((o) => !prev.off.includes(o))) why.push('official');
  if (cur.facts.some((f) => !prev.facts.includes(f))) why.push('number');
  if (cur.stage > prev.stage || (cur.inj || 0) > (prev.inj || 0)) why.push('status');
  if (cur.den && !prev.den) why.push('denial');
  // Not judged here: a new source that adds information in WORDS only (no new amount, status, official source or denial). A growing
  // vocabulary is what every new article brings (replayed on real stories, a rule on it fired on most of them), and deciding whether
  // a paragraph is new needs a reader. Such a story is refreshed by the numbers / status it later carries.
  return why;
}

// res: the saved summary { sig, at, refreshes: [ts] }. Returns { go, why }.
export function shouldRefresh(res, members, sums, now) {
  if (!res?.sig) return { go: false, why: ['no-signature'] }; // legacy summary: upgraded by the upgrade queue, not by this rule
  const why = refreshReasons(res.sig, signature(members, sums));
  if (!why.length) return { go: false, why };
  const recent = (res.refreshes || []).filter((t) => now - t < 864e5);
  if (now - res.at < REFRESH_MIN_MS || recent.length >= REFRESH_MAX_PER_DAY) return { go: false, why, throttled: true };
  return { go: true, why };
}

// the Hebrew label of what changed, for the card ("עודכן: נוסף סכום חדש")
export const WHY_HE = { official: 'הודעה רשמית חדשה', number: 'נוסף סכום או פרט מספרי חדש', status: 'התקדמות בסטטוס הסיפור', denial: 'הכחשה', new: '' };

// ---------- what the page gets ----------
// res.rich: { sel: [{ sid, pub, link, lang, official?, t }], claims, added, conflicts, basis, why, upd }
export function richForUi(res) {
  const r = res?.rich;
  if (!r) return null;
  const name = new Map((r.sel || []).map((x) => [x.sid, x.pub]));
  const n = (sid) => name.get(sid) || '';
  return {
    claims: (r.claims || []).map((c) => ({ t: c.he, s: c.src.map(n).filter(Boolean), k: c.kind })),
    ...(r.added?.length ? { added: r.added.map((a) => ({ s: n(a.src), t: a.he })) } : {}),
    ...(r.conflicts?.length ? { conflicts: r.conflicts.map((k) => ({ t: k.topic_he, p: k.positions.map((p) => ({ s: n(p.src), t: p.he })) })) } : {}),
    sources: (r.sel || []).map((x) => ({ n: x.pub, ...(x.link ? { l: x.link } : {}), ...(x.official ? { o: 1 } : {}) })),
    basis: r.basis,
    ...(r.why?.length && r.why[0] !== 'new' ? { why: r.why.map((w) => WHY_HE[w]).filter(Boolean).join(', ') } : {}),
    upd: res.at,
  };
}

// A deterministic conflict (two outlets, two different amounts) is added when the model named none about an amount.
export function withNumericConflicts(valid, selection) {
  const base = valid || { claims: [], added: [], conflicts: [] };
  if (base.conflicts.length) return base;
  const fmt = (v) => (v >= 1e6 ? `${+(v / 1e6).toFixed(2)} מיליון` : `${v}`);
  const found = numericConflicts(selection).map((c) => ({ topic_he: 'סכום שונה בין הדיווחים', det: 1, positions: c.sids.map((sid, i) => ({ src: sid, he: `מדווח על ${fmt(c.values[i])}` })) }));
  return found.length ? { ...base, conflicts: found } : base;
}

// what is stored with the summary (sources by stable id, so a claim can always be traced)
export function richRecord(valid, selection, now, why) {
  return {
    sel: selection.sel.map((x) => ({ sid: x.sid, id: x.m.id, pub: x.m.publisher, link: x.m.link, lang: x.m.lang, ...(x.official ? { official: 1 } : {}), t: x.m.published })),
    ...valid,
    basis: { heads: selection.sel.length, descs: selection.sel.filter((x) => x.desc).length, outlets: selection.total, omitted: selection.omitted, copies: selection.copies, text: 'headlines + feed descriptions only' },
    why,
  };
}
