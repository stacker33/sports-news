// Sport triage: decide each article's sport from the strongest evidence available.
//
//   1. the site's own section (URL path, Sport5 folder)      → certain
//   2. a sport-specific feed (ESPN NBA, Walla basketball…)    → certain
//   3. names from the 365Scores knowledge base that belong to one sport only
//      (a basketball player's full name, Hapoel Holon, EuroLeague)
//   4. keywords with a clear margin
//   5. a small word model (naive Bayes) trained every run on the articles whose sport is certain
//   6. weak keywords / Israeli club names
// Articles with no evidence at all (cars, politics in a sports section) end up as "not sport" and are hidden.
import { heBase } from './hebrew.js';

const SPORTS = ['football', 'basketball', 'other'];

// Generic words that say nothing about the sport (kept small: sport words are the useful ones)
const STOP = new Set(
  `a an the and or but of to in on at for from by with as is are was were be been it its this that these those
  after before over into out up about than then so not no his her their they he she we you i will would can could
  has have had do does did says say said how why what who when where which more most new
  el la los las de del en con por para un una al se su que le les du des et di il da der die und das im
  של את על עם לא כי זה זו גם אבל או אם כל רק עוד היה היא הוא הם הן יש אין אחרי לפני מול בין אל עד כך מה מי
  הזה הזאת היום אתמול מחר ואז כבר`.split(/\s+/)
);

export function words(text) {
  const out = [];
  for (let w of String(text || '')
    .toLowerCase()
    .replace(/[֑-ׇ]/g, '')
    .replace(/['"׳״`’‘“”]/g, '')
    .split(/[^\p{L}\p{N}]+/u)) {
    w = heBase(w); // Hebrew prefix letter, keeping known names intact (src/hebrew.js)
    if (w.length < 2 || STOP.has(w) || /^\d+$/.test(w)) continue;
    out.push(w);
  }
  return out;
}

// Features: headline words (original + English translation) + the site section
export function features(item) {
  const f = [...new Set([...words(item.title), ...words(item.tr?.en || '')])];
  const sec = sectionKey(item.link);
  if (sec) f.push('§' + sec);
  // the score says a lot: 3:1 is football, 90:67 is basketball
  // (single digits only: "02:05" on the game clock or "21:45" kick-off isn't a football score)
  if (/(^|[^\d:])\d\s*[:-]\s*\d($|[^\d:])/.test(item.title)) f.push('#score-low', '#score-low2'); // counted twice: a strong hint
  for (const [, a, b] of String(item.title).matchAll(/(\d{2,3})\s*[:-]\s*(\d{2,3})/g)) {
    if (Math.min(+a, +b) >= 40 && Math.max(+a, +b) <= 160) f.push('#score-high', '#score-high2');
  }
  return f;
}

// "sport5.co.il/405", "one.co.il", "walla.co.il" … (the folder/section is the strongest hint a site gives)
function sectionKey(link) {
  try {
    const u = new URL(link);
    const host = u.hostname.replace(/^www\./, '');
    const folder = u.searchParams.get('FolderID');
    if (folder) return `${host}/${folder}`;
    const seg = u.pathname.split('/').filter(Boolean)[0];
    return seg && seg.length < 25 && !/\d{3}/.test(seg) ? `${host}/${seg.toLowerCase()}` : host;
  } catch {
    return '';
  }
}

// Multinomial naive Bayes with Laplace smoothing; uniform priors (training data is mostly football)
export function trainModel(samples) {
  const counts = Object.fromEntries(SPORTS.map((s) => [s, new Map()]));
  const totals = Object.fromEntries(SPORTS.map((s) => [s, 0]));
  const docs = Object.fromEntries(SPORTS.map((s) => [s, 0]));
  const vocab = new Set();
  for (const { feats, sport } of samples) {
    if (!counts[sport]) continue;
    docs[sport]++;
    for (const t of feats) {
      counts[sport].set(t, (counts[sport].get(t) || 0) + 1);
      totals[sport]++;
      vocab.add(t);
    }
  }
  return { counts, totals, docs, vocab, size: samples.length };
}

export function predict(model, feats) {
  if (!model || model.size < 50) return null;
  const V = model.vocab.size;
  const known = feats.filter((t) => model.vocab.has(t));
  if (!known.length) return null;
  const logp = {};
  for (const s of SPORTS) {
    if (!model.docs[s]) continue;
    let lp = 0;
    for (const t of known) lp += Math.log(((model.counts[s].get(t) || 0) + 1) / (model.totals[s] + V));
    logp[s] = lp;
  }
  const max = Math.max(...Object.values(logp));
  const exp = Object.fromEntries(Object.entries(logp).map(([s, v]) => [s, Math.exp(v - max)]));
  const sum = Object.values(exp).reduce((a, b) => a + b, 0);
  const [sport, e] = Object.entries(exp).sort((a, b) => b[1] - a[1])[0];
  return { sport, p: e / sum, known: known.length };
}

// Sport implied by knowledge-base names that exist in one sport only
export function entitySport(ents) {
  const votes = { football: 0, basketball: 0, other: 0 };
  for (const e of ents || []) {
    if (!e.sport || e.amb || e.noEvidence) continue;
    if (e.k === 'player' && e.single) continue; // a surname alone is too weak
    votes[e.sport] += e.k === 'player' ? 2 : 1;
  }
  const [best, n] = Object.entries(votes).sort((a, b) => b[1] - a[1])[0];
  const second = Object.values(votes).sort((a, b) => b - a)[1];
  return n > 0 && n > second ? best : null;
}

// ev = classify(...).ev; ent = entitySport(); pred = predict()
// Reasons strong enough to settle a whole story's sport (the others are educated guesses)
export const SURE = new Set(['user', 'section', 'url', 'kw-other', 'feed', 'names', 'kw', 'score']);

export function decideSport(ev, ent, pred, feats = []) {
  // a cars / lifestyle section: drop — unless the article itself names a known athlete / team or sports words
  // (an athlete interview in a magazine section is still a sports story)
  const sportsEvidence = !!ent || !!ev.athleteSport || ev.kw.f + ev.kw.b > 0 || ev.ib + ev.ifb > 0;
  if (ev.section === 'drop' && !sportsEvidence) return { sport: 'other', nonSport: true, why: 'section' };
  if (ev.url) return { sport: ev.url, why: 'url' };
  const { f, b, o } = ev.kw;
  // a clear other-sport word wins a tie, and beats a sport-specific feed (rugby / NFL posts in a club's news search)
  if (o > 0 && o >= Math.max(f, b)) return { sport: 'other', why: 'kw-other' };
  if (ev.source) return { sport: ev.source, why: 'feed' };
  if (ent) return { sport: ent, why: 'names' };
  const kwSport = f || b ? (b > f ? 'basketball' : f > b ? 'football' : null) : null;
  if (kwSport && Math.abs(f - b) >= 2) return { sport: kwSport, why: 'kw' };
  if (feats.includes('#score-high') && !kwSport) return { sport: 'basketball', why: 'score' }; // 98:102
  if (pred && pred.p >= 0.8 && pred.known >= 2) return { sport: pred.sport, why: 'model' };
  if (kwSport) return { sport: kwSport, why: 'kw-weak' };
  if (ev.athleteSport) return { sport: ev.athleteSport, why: 'athlete' };
  if (pred && pred.p >= 0.6) return { sport: pred.sport, why: 'model-weak' };
  if (ev.israel && ev.ib + ev.ifb > 0) return { sport: ev.ib > ev.ifb ? 'basketball' : 'football', why: 'il-clubs' };
  if (f && f === b) return { sport: 'football', why: 'tie' };
  // Israeli club/national-team story with no sport word (a section that isn't sport was already dropped above)
  // Israeli story with no sport evidence: uncertain — shown with ❓ (best guess: the model's, else football)
  if (ev.israel && !ev.israelOther && o === 0) return { sport: pred?.sport && pred.sport !== 'other' ? pred.sport : 'football', why: 'uncertain' };
  // nothing points to any sport: keep only if it reads like another sport (judo, tennis…)
  return { sport: 'other', nonSport: !ev.israelOther && o === 0, why: 'none' };
}
