// What Sport5's editors care about, in one place (ranking in collect.js, alerts in telegram.js).
//   up:   the competitions they follow, transfers and reporters' scoops
//   down: betting / how-to-watch / live blogs / predictions — real stories, but rarely what an editor writes
//   other sports (NFL, MLB, NHL, tennis, cycling…): only big events

// competitions the world desk follows (tag ids from src/entities.js) — the Telegram channel's "major"
export const MAJOR = new Set(['c-ucl', 'c-uel', 'c-epl', 'c-laliga', 'c-seriea', 'c-bundes', 'c-ligue1', 'c-nba', 'c-euroleague', 'c-wc', 'c-unl']);
// …plus the Israeli leagues and EuroCup, for ranking
const EDITOR_COMPS = new Set([...MAJOR, 'c-uecl', 'c-ligat', 'c-winner', 'c-statecup', 'c-eurocup']);

// a reporter's own post (Romano, Shams, Ornstein…) about a signing / injury / official news
const SCOOP = /here we go|official|confirmed|agreed|agreement|deal (done|agreed)|signs|signed|completes?|medical|exclusive|breaking|ruled out|injur|sacked|fired|appointed|traded|trade|waived|extension|רשמי|חתם|סוכם|הסכם|בלעדי|נפצע|פוטר|מונה/i;
export const isScoop = (s) => (s.social || []).some((p) => !/[א-ת]/.test(p)) && SCOOP.test(s.title);
export const major = (s) => !!s.tags?.some((g) => MAJOR.has(g.id));

const TRANSFER = /\b(transfer|signs?|signed|signing|here we go|loan|bid|fee|release clause|buyout|contract extension|extension|free agent|traded?|waived|joins|move to|agreement)\b|העברה|מעבר ל|חתם|חותם|השאלה|הצעה|סעיף שחרור|טרייד|הארכת חוזה|מצטרף/i;
const LOW_VALUE = /\b(how to watch|where to watch|tv channel|live stream(ing)?|odds|betting|prediction|predicted line-?ups?|preview and prediction|live:|live updates|as it happened|minute-by-minute|recap and highlights|quiz)\b|^live\b|איפה לצפות|שידור חי|ניחושים|הימורים|תחזית למשחק/i;

// Not stories at all, in any language: ticket sales, polls, live streams of training, live tickers. Flagged "low":
// the world tabs collapse them with the off-beat leagues (they are kept, never deleted).
const NOT_NEWS = /(tickets?|buy tickets|on sale|polls?:|poll|vote now|cast your vote|watch (the )?(training|live)|live training|open training|live ?ticker|live blog)|biglietti|entradas|bilhetes|billetterie|εισιτήρι|bilet(ler)?|sondaggio|encuesta|sondage|umfrage|enquete|ψηφοφορ|em direto|ao vivo|en direct|en directo|en vivo|in diretta|liveticker|כרטיסים|הצבעה:|סקר:/i;
export function markLow(s) {
  if (trackedIsraeli(s)) return s;
  const titles = [s.title, s.t?.en?.title || ''];
  return titles.some((x) => NOT_NEWS.test(x) || LOW_VALUE.test(x)) ? { ...s, low: true } : s;
}

// player ratings: low for a generic match, but a rating of a tracked Israeli is what the desk writes about
const RATINGS = /\bplayer ratings\b|\bratings?:|\breport card\b|\bmarks out of 10\b|\bpagelle\b|\bnotes? des joueurs\b|\bcalificaciones\b|\bnoten\b|\bcijfers\b/i;
const trackedIsraeli = (s) => !!(s.israel || s.abroad || s.athletes?.length || s.watchIsrael);

const text = (s) => [s.title, s.t?.en?.title, ...(s._members || []).slice(0, 6).map((m) => m.title)].filter(Boolean).join(' \n ');

// multiplies score and pop
export function editorialBoost(s) {
  const t = text(s);
  let k = 1;
  if (s.tags?.some((g) => EDITOR_COMPS.has(g.id))) k *= 1.25;
  if (isScoop(s) || TRANSFER.test(t)) k *= 1.3;
  if (LOW_VALUE.test(s.title) || LOW_VALUE.test(s.t?.en?.title || '')) k *= 0.6;
  else if (RATINGS.test(s.title) && !trackedIsraeli(s)) k *= 0.6;
  if (k === 1) return s;
  const r2 = (x) => Math.round(x * 100) / 100;
  return { ...s, score: r2(s.score * k), pop: r2(s.pop * k) };
}

// Other sports: the events worth an editor's time
const BIG_EVENT = /super bowl|world series|stanley cup final|nba finals|wimbledon|roland[- ]garros|french open|australian open|us open|atp finals|wta finals|davis cup final|grand prix|\bgp\b|world champion|\bolympic|olympics|tour de france|giro d'italia|vuelta|ryder cup|the masters|world cup final|title fight|undisputed|heavyweight title|world title|ufc \d{3}|גראנד סלאם|וימבלדון|רולאן גארוס|אליפות העולם|אולימפי|טור דה פראנס|גראנד פרי|פורמולה 1|סופרבול|קרב על התואר/i;
// ...or an exceptional story (a record, a doping ban, a shock defeat) that is spreading or about a famous name
const EXCEPTIONAL = /world record|doping|banned for|disqualified|stripped of|shock (defeat|win)|major upset|historic (gold|first|win)|first ever|\bretire(s|ment)\b|\bdies\b|\bdied\b|death of|collapsed|arrested|שיא עולם|סימום|פרש מ|תלה את|נפטר/i;
export const bigEvent = (s) => {
  const t = text(s);
  if (BIG_EVENT.test(t)) return true;
  return EXCEPTIONAL.test(t) && !!(s.watchStar || (s.langs?.length || 0) >= 2 || (s.sourceCount || 0) >= 4);
};

// ---------- leagues the desk follows ----------
// Football: the big 5 (England, Spain, Italy, Germany, France). A story about clubs outside them (Porto,
// Olympiacos, PAOK, AEK...) is "local": kept, but pushed far down and out of Hot / the morning brief / Telegram,
// unless it has an Israeli angle, is a viral / worldwide story, or is about a world star. A European cup game
// alone is not enough (a big-5 opponent makes it a big-5 story anyway).
// Basketball: EuroLeague, EuroCup and the NBA. Clubs outside them: the same as football. Inside them, routine news
// is pushed down ("routine"): EuroLeague / EuroCup clubs keep games named as EuroLeague / EuroCup, transfers,
// coach changes and scandals; the NBA keeps stars, trades, the playoffs, widely covered stories and follow-ups
// after games (reactions, takeaways). Clubs are known from the 365Scores knowledge base (the story's competitions);
// when a story has no known club, the outlet's market decides (every article from a local-market outlet).
const BIG5 = new Set(['c-epl', 'c-laliga', 'c-seriea', 'c-bundes', 'c-ligue1']);
const NATIONAL = new Set(['c-wc', 'c-unl']);
const IL_COMPS = new Set(['c-ligat', 'c-leumit', 'c-statecup', 'c-toto', 'c-winner', 'c-wcup']);
const EURO_BASKET = new Set(['c-euroleague', 'c-eurocup']);
const BASKET_BIG = new Set([...EURO_BASKET, 'c-nba']);
const LOCAL_COUNTRIES = new Set(['Portugal', 'Brazil', 'Argentina', 'Turkey', 'Greece', 'Netherlands', 'Belgium', 'Cyprus', 'Serbia', 'Romania']);
const LOCAL_LANGS = new Set(['el', 'hu', 'ro', 'sr', 'tr', 'pt', 'nl', 'cs', 'sk', 'pl', 'bg', 'hr', 'sl', 'uk', 'ru', 'lt', 'lv', 'sv', 'no', 'da', 'ja']);
const STARS = /mourinho|ronaldo|messi|neymar|ancelotti|guardiola|klopp|ibrahimovi|benzema|zidane|modri[cć]|lewandowski|mbapp|haaland|salah|griezmann|de bruyne|xavi|iniesta|pochettino|tuchel|simeone|lebron|curry|don[cč]i[cć]|giannis|antetokounmpo|joki[cć]|wembanyama|מוריניו|רונאלדו|מסי|נימאר|אנצ'לוטי|גווארדיולה|לברון|דונצ'יץ'/i;
const EURO_NAMED = /euroleague|euroliga|eurolega|eurocup|יורוליג|יורוקאפ|ευρωλίγκα|ευρωλιγκα|ευρωκύπελλο|евролига|avrupa ligi|euroliginde/i;
const BIG_NEWS = /\b(transfer|signs?|signed|signing|joins|contract|extension|deal|traded?|trade request|waived|released|buyout|sacked|fired|dismissed|resigns?|steps down|appointed|new coach|head coach|suspended|suspension|banned?|fined?|investigation|scandal|arrested|fight|brawl|ejected)\b|העברה|חתם|חוזה|טרייד|פוטר|התפטר|מונה|מאמן חדש|הושעה|הורחק|קנס|חקירה|סערה|קטטה/i;
const PLAYOFFS = /playoffs?|play-in|finals|conference final|game [1-7]\b|פלייאוף|גמר/i;
const FOLLOWUP = /\b(after|postgame|post-game|reacts?|reaction|says|said|explains|praises|slams|blasts|takeaways|observations|what we learned|grades|report card|breakdown|analysis)\b|אחרי|הגיב|אמר|ניתוח/i;
const LOCAL_FACTOR = 0.15; // "local": far down
const ROUTINE_FACTOR = 0.45; // routine news of a followed league: lower

export const memberLocal = (m, src) => (src?.country ? LOCAL_COUNTRIES.has(src.country) : LOCAL_LANGS.has(m.lang));

const viral = (s) => (s.langs?.length || 0) >= 3 || !!s.trending || (!!s.reddit && (s.langs?.length || 0) >= 2);
const star = (s) => !!s.watchStar || STARS.test(text(s));
const hasClub = (s) => (s.tags || []).some((g) => g.k === 'team');
const r2 = (x) => Math.round(x * 100) / 100;
const scale = (s, k, flag) => ({ ...s, [flag]: true, score: r2(s.score * k), pop: r2(s.pop * k) });

export function markLocal(s, isLocal) {
  const comps = new Set(s.comps || []);
  const has = (set) => [...comps].some((c) => set.has(c));
  if (trackedIsraeli(s) || has(IL_COMPS)) return s; // Israeli angle (incl. a verified watchlist person)
  if (viral(s) || star(s)) return s; // a viral / worldwide story, a world star
  if (has(NATIONAL)) return s; // national teams
  const t = text(s);
  if (s.sport === 'basketball') {
    if (has(EURO_BASKET)) {
      const named = EURO_NAMED.test(t) || (s._members || []).some((m) => (m.ents || []).some((id) => EURO_BASKET.has(id)));
      return named || BIG_NEWS.test(t) ? s : scale(s, ROUTINE_FACTOR, 'routine');
    }
    if (comps.has('c-nba')) return BIG_NEWS.test(t) || PLAYOFFS.test(t) || FOLLOWUP.test(t) || s.sourceCount >= 3 || (s.langs?.length || 0) >= 2 ? s : scale(s, ROUTINE_FACTOR, 'routine');
    if (hasClub(s) && !has(BASKET_BIG)) return scale(s, LOCAL_FACTOR, 'local'); // a club outside EuroLeague / EuroCup / NBA
  } else if (s.sport !== 'other') {
    if (has(BIG5)) return s; // a big-5 club (also when it plays a smaller one)
    if (hasClub(s) || comps.size) return scale(s, LOCAL_FACTOR, 'local'); // clubs outside the big 5
  }
  // no known club: the outlet's market decides
  if ((s._members || []).length && s._members.every(isLocal)) return scale(s, LOCAL_FACTOR, 'local');
  return s;
}
