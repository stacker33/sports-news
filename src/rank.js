// Editorial rank (discovery version, stage 2): an editor-oriented order with human-readable reasons, next to the
// existing popularity order (which stays as it is). Deterministic rules, weights in config/editorial-rank.json.
//
// Dimensions (each 0-1): Israeli relevance (verified connections only), importance of the person / team / event,
// news value, freshness (with publication-time confidence), public attention and spread, Sport5 / competitor
// coverage, and evidence quality. Editor votes adjust the result only with enough voters, and only by a few points.
//
// What it never does: treat "exclusive" as verified exclusivity, a publisher's weight as factual certainty, many
// outlets as corroboration, or a changed headline as new information. Only headlines and descriptions are read,
// and every story says so.
import { readFileSync } from 'node:fs';

const DEFAULTS = {
  weights: { israel: 3, importance: 2, news: 2, fresh: 2, attention: 1.5, coverage: 1.5, evidence: 0.75 },
  freshHalfLifeHours: 6,
  attentionFullAt: 30,
  feedback: { minVoters: 3, fullAtVoters: 8, maxPoints: 6 },
};
export function loadRankConfig(path) {
  try {
    const j = JSON.parse(readFileSync(path, 'utf8'));
    return { ...DEFAULTS, ...j, weights: { ...DEFAULTS.weights, ...j.weights }, feedback: { ...DEFAULTS.feedback, ...j.feedback } };
  } catch {
    return DEFAULTS;
  }
}

const MAJOR = new Set(['c-ucl', 'c-epl', 'c-laliga', 'c-seriea', 'c-bundes', 'c-ligue1', 'c-nba', 'c-euroleague', 'c-wc', 'c-ligat', 'c-winner']);
const BIG = new Set(['c-uel', 'c-uecl', 'c-eurocup', 'c-unl', 'c-statecup', 'c-wcup', 'c-leumit']);

// news families (headline level): title, its translations and the first articles' titles
const FAMILIES = [
  ['transfer', 0.85, 'Transfer / contract news', 'העברה / חוזה', /\b(transfer|signs?|signed|signing|here we go|loan|bid|offer|release clause|buyout|contract|extension|free agent|traded?|waived|joins|medical|talks|negotiat\w*|target)\b|העברה|חתם|חותם|השאלה|הצעה|סעיף שחרור|טרייד|חוזה|מגעים|משא ומתן|על הכוונת/i],
  ['injury', 0.8, 'Injury / fitness', 'פציעה / כשירות', /\b(injur\w*|surgery|ruled out|sidelined|setback|scan|mri|out for|return to training|cleared to play)\b|פציע|נפצע|ניתוח|יחמיץ|הושבת|חזר לאימונים/i],
  ['coach', 0.8, 'Coaching change', 'שינוי בתפקיד המאמן', /\b(sacked|fired|dismissed|resigns?|steps down|appointed|new coach|new manager|interim)\b|פוטר|התפטר|מונה|מאמן חדש|זמני/i],
  ['interview', 0.75, 'Interview / quotes', 'ראיון / ציטוטים', /\b(interview|opens up|reveals|admits|speaks out|breaks silence|press conference|q&a|podcast)\b|ראיון|בריאיון|חשף|הודה|שבר שתיקה|מסיבת עיתונאים|entrevista|intervista|entretien|συνέντευξη|röportaj/i],
  ['controversy', 0.75, 'Controversy / discipline', 'סערה / משמעת', /\b(suspended|suspension|banned?|fined?|red card|sent off|investigation|charged|appeal|controvers\w*|row|feud|clash|protest|boycott)\b|הורחק|הושעה|קנס|חקירה|סערה|עימות|מחאה|חרם/i],
  ['record', 0.65, 'Performance / record', 'הישג / שיא', /\b(record|historic|milestone|career-high|hat-?trick|brace|double-double|triple-double|buzzer-?beater|game-winner|man of the match|player of the match)\b|שיא|היסטורי|שלושער|צמד|דאבל דאבל|טריפל דאבל|מצטיין/i],
];
const LOW = /\b(how to watch|where to watch|tv channel|live stream(ing)?|odds|betting|prediction|predicted line-?ups?|live:|live updates|as it happened|minute-by-minute|quiz)\b|^live\b|איפה לצפות|שידור חי|ניחושים|הימורים/i;
const RATINGS = /\bplayer ratings\b|\bratings?:|\breport card\b|\bpagelle\b|\bnotes? des joueurs\b|\bcalificaciones\b|\bcijfers\b/i;
const EXCLUSIVE = /\bexclusive\b|\bexclusiva\b|\besclusiva\b|בלעדי/i;
// reference pages that Google News lists like articles: profiles, daily-updated reports, schedules
const PAGE = /\(updated daily\)|\| (guard|forward|center|point guard|shooting guard|small forward|power forward|goalkeeper|defender|midfielder|striker|winger) \||\b(player profile|stats and news|news, stats|schedule and results|fixtures and results|standings|roster)\b/i;
const isPage = (s) => PAGE.test(s.title) || (s.tags || []).some((g) => [g.en, g.he].includes(String(s.title).trim()));

const r2 = (x) => Math.round(x * 100) / 100;
const textOf = (s) => [s.title, s.t?.en?.title, s.t?.he?.title, ...(s._members || []).slice(0, 6).map((m) => m.title)].filter(Boolean).join(' \n ');
const names = (list, n = 2) => list.slice(0, n).join(', ');

// votes = { up: [devices], down: [devices] } for this story (state.feedback.votes[id])
export function feedbackAdjust(votes, cfg = DEFAULTS.feedback) {
  const up = new Set(votes?.up || []).size;
  const down = new Set(votes?.down || []).size;
  const n = up + down;
  if (n < cfg.minVoters) return { points: 0, n, up, down, used: false };
  const share = (up - down) / n; // -1 .. 1
  const confidence = Math.min(1, n / cfg.fullAtVoters);
  return { points: r2(Math.max(-cfg.maxPoints, Math.min(cfg.maxPoints, share * confidence * cfg.maxPoints))), n, up, down, used: true };
}

// → { score: 0-100, dims: {...}, reasons: [{ k, en, he, at? }], limits: [{ k, en, he }] }
export function editorialRank(s, { now = Date.now(), cfg = DEFAULTS, votes = null, heName = (n) => n } = {}) {
  const reasons = [];
  const limits = [];
  const dims = {};
  const why = (dim, k, en, he, extra = {}) => reasons.push({ dim, k, en, he, ...extra });
  const limit = (k, en, he) => limits.push({ k, en, he });
  const text = textOf(s);
  const watchIl = (s.watch || []).filter((h) => h.israelLink);
  const watchPending = (s.watch || []).filter((h) => h.status === 'pending');

  // Israeli relevance: verified connections only
  const isInterview = FAMILIES[3][4].test(text);
  const localOnly = (s._members || []).length > 0 && s.ev && s.ev.il === 0 && s.ev.outlets <= 2;
  if (s.athletes?.length) {
    dims.israel = 1;
    why('israel', 'abroad', `Israeli abroad: ${names(s.athletes)}`, `ליגיונר: ${names(s.athletes.map(heName))}`);
  } else if (watchIl.some((h) => h.type !== 'club')) {
    dims.israel = 0.9;
    const people = watchIl.filter((h) => h.type !== 'club');
    const n = people.map((h) => h.name);
    const nh = people.map((h) => h.he || h.name);
    if (isInterview && localOnly) why('israel', 'il-local-interview', `Tracked Israeli mentioned in a local interview: ${names(n)}`, `ישראלי במעקב בראיון בתקשורת מקומית: ${names(nh)}`);
    else why('israel', 'watch-il', `Tracked Israeli: ${names(n)}`, `ישראלי במעקב: ${names(nh)}`);
  } else if (watchIl.length) {
    dims.israel = 0.8;
    const unique = (l) => [...new Set(l)];
    why('israel', 'il-club', `Israeli club: ${names(unique(watchIl.map((h) => h.name)))}`, `קבוצה ישראלית: ${names(unique(watchIl.map((h) => h.he || h.name)))}`);
  } else if (s.israel) {
    dims.israel = 0.8;
    why('israel', 'israel', 'Israeli club / national team', 'קבוצה ישראלית / נבחרת');
  } else if (s.israelOther) {
    dims.israel = 0.4;
    why('israel', 'israel-other', 'Israeli angle', 'זווית ישראלית');
  } else if (watchPending.length) {
    dims.israel = 0.25;
    why('israel', 'pending', `Possibly Israel-linked (not verified): ${names(watchPending.map((h) => h.name))}`, `ייתכן קשר לישראל (לא מאומת): ${names(watchPending.map((h) => h.he || h.name))}`);
  } else dims.israel = 0;

  // Importance of the person / team / event
  const comps = s.comps || (s.tags || []).filter((g) => g.k === 'comp').map((g) => g.id);
  const stars = (s.watch || []).filter((h) => h.category === 'world-star');
  if (comps.some((c) => MAJOR.has(c))) {
    dims.importance = 1;
    why('importance', 'major', 'Major competition', 'מסגרת מרכזית');
  } else if (stars.length) {
    dims.importance = 0.85;
    why('importance', 'star', `Star: ${names(stars.map((h) => h.name))}`, `כוכב: ${names(stars.map((h) => h.he || h.name))}`);
  } else if (comps.some((c) => BIG.has(c))) {
    dims.importance = 0.75;
    why('importance', 'big', 'European cup / national teams', 'גביע אירופי / נבחרות');
  } else dims.importance = s.local ? 0.15 : 0.35;
  if (s.local) limit('local', 'Local league: lower interest unless there is an Israeli angle', 'ליגה מקומית: עניין נמוך אלא אם יש זווית ישראלית');

  // News value (headline level)
  const fam = FAMILIES.find(([, , , , re]) => re.test(text));
  if (isPage(s)) {
    dims.news = 0.05;
    why('news', 'page', 'Looks like a reference page, not a news story', 'נראה כמו דף מידע, לא ידיעה');
  } else if (LOW.test(s.title) || (RATINGS.test(s.title) && !dims.israel)) {
    dims.news = 0.1;
    why('news', 'low', 'Low news value (live blog / betting / ratings)', 'ערך חדשותי נמוך (בלוג חי / הימורים / ציונים)');
  } else if (fam) {
    dims.news = fam[1];
    why('news', fam[0], fam[2], fam[3]);
  } else dims.news = 0.4;
  if (EXCLUSIVE.test(text)) limit('exclusive', 'Says "exclusive" - exclusivity not verified', 'כתוב "בלעדי" - הבלעדיות לא אומתה');

  // Freshness, and how sure we are of the time
  const ageH = Math.max(0, (now - s.first) / 3600e3);
  dims.fresh = r2(Math.pow(0.5, ageH / cfg.freshHalfLifeHours));
  if (s.dateUnknown) {
    dims.fresh = r2(dims.fresh * 0.5);
    limit('time', 'Publication time unknown', 'זמן הפרסום לא ידוע');
  }

  // Public attention and spread (spread is not corroboration)
  dims.attention = r2(Math.min(1, Math.log1p(s.pop ?? s.score ?? 0) / Math.log1p(cfg.attentionFullAt)));
  if (s.trending) why('attention', 'trend', 'Trending on Google', 'טרנד בגוגל');
  const ev = s.ev || {};
  if (ev.outlets >= 3 && ev.attrib) why('attention', 'shared', `${ev.outlets} outlets, shared original attribution (${ev.attrib})`, `${ev.outlets} כלי תקשורת, מקור משותף (${ev.attrib})`);
  else if (ev.outlets >= 3) why('attention', 'spread', `${ev.outlets} outlets in ${s.langs?.length || 1} languages (independence unknown)`, `${ev.outlets} כלי תקשורת ב-${s.langs?.length || 1} שפות (לא ידוע אם בלתי תלויים)`);

  // Coverage: Sport5 and competitors, never more certain than the check
  const cov = s.cov || {};
  const comp = cov.comp || [];
  switch (cov.s5) {
    case 'none':
      dims.coverage = 1;
      if (comp.length) why('coverage', 'comp-not-s5', `On competitors (${names(comp)}), no Sport5 match found at the last check ({t})`, `אצל המתחרים (${names(comp)}), לא נמצאה התאמה בספורט 5 בבדיקה האחרונה ({t})`, { at: cov.checkedAt });
      else why('coverage', 's5-none', 'No Sport5 match found at the last successful check ({t})', 'לא נמצאה התאמה בספורט 5 בבדיקה המוצלחת האחרונה ({t})', { at: cov.checkedAt });
      break;
    case 'possible':
      dims.coverage = 0.6;
      why('coverage', 's5-possible', 'Possible Sport5 match - check', 'התאמה אפשרית בספורט 5 - כדאי לבדוק');
      break;
    case 'channel':
      dims.coverage = 0.6;
      why('coverage', 's5-channel', 'Only on Sport5 Telegram / YouTube', 'רק בערוצי ספורט 5');
      break;
    case 'match':
      dims.coverage = cov.newer >= 2 ? 0.4 : 0.15;
      if (cov.newer >= 2) why('coverage', 's5-newer', `On Sport5; ${cov.newer} later publications since (not necessarily new facts)`, `בספורט 5; ${cov.newer} פרסומים מאוחרים יותר (לא בהכרח עובדות חדשות)`);
      break;
    default:
      dims.coverage = 0.6;
      limit('s5-unavailable', 'Sport5 coverage check unavailable', 'בדיקת הכיסוי בספורט 5 לא זמינה');
  }

  // Evidence quality (shown separately; lightly weighted)
  if (ev.official) {
    dims.evidence = 1;
    why('evidence', 'official', 'Official source', 'מקור רשמי');
  } else if (ev.reporter) {
    dims.evidence = 0.8;
    why('evidence', 'reporter', "A reporter's own report", 'דיווח של כתב');
  } else if (ev.lead?.status === 'attributed') dims.evidence = 0.7;
  else dims.evidence = ev.outlets >= 2 ? 0.55 : 0.35;
  if ((ev.outlets || 0) <= 1) limit('single', 'Single source - needs confirmation', 'מקור יחיד - דורש אימות');
  if (ev.lead?.status === 'earliest') limit('origin-unknown', 'Original source unknown - earliest foreign report shown', 'המקור המקורי לא ידוע - מוצג הדיווח הזר המוקדם ביותר');
  if (ev.lead?.status === 'cites-uncollected') limit('cites', `Cites ${ev.attrib}; the original article was not collected`, `מצטט את ${ev.attrib}; הכתבה המקורית לא נאספה`);
  limit('headline', 'Only headline/description available; source reading needed', 'רק כותרת ותקציר זמינים; צריך לקרוא את המקור');

  // Weighted average, then bounded editor feedback
  const w = cfg.weights;
  let total = 0;
  let sum = 0;
  for (const [k, wk] of Object.entries(w)) {
    total += wk;
    sum += wk * (dims[k] ?? 0);
  }
  let score = (100 * sum) / total;
  // a reference page is not a story, however relevant its subject
  if (dims.news === 0.05) {
    score *= 0.4;
    limit('page', 'Reference page, not a news story', 'דף מידע, לא ידיעה');
  }
  const fb = feedbackAdjust(votes, cfg.feedback);
  if (fb.used) {
    score += fb.points;
    why('feedback', 'votes', `Editors: ${fb.up} up, ${fb.down} down`, `עורכים: ${fb.up} בעד, ${fb.down} נגד`);
  }
  score = r2(Math.max(0, Math.min(100, score)));

  // strongest reasons first
  const contrib = (r) => (r.dim === 'feedback' ? Math.abs(fb.points) : (w[r.dim] || 0) * (dims[r.dim] ?? 0));
  reasons.sort((a, b) => contrib(b) - contrib(a));
  return { score, dims, reasons: reasons.slice(0, 4).map(({ dim: _d, ...r }) => r), limits, ...(fb.n ? { votes: { up: fb.up, down: fb.down, used: fb.used } } : {}) };
}
