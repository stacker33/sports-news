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
const LOW_VALUE = /\b(how to watch|where to watch|tv channel|live stream(ing)?|odds|betting|prediction|predicted line-?ups?|preview and prediction|player ratings|live:|live updates|as it happened|minute-by-minute|recap and highlights|quiz)\b|^live\b|איפה לצפות|שידור חי|ניחושים|הימורים|תחזית למשחק/i;

const text = (s) => [s.title, s.t?.en?.title, ...(s._members || []).slice(0, 6).map((m) => m.title)].filter(Boolean).join(' \n ');

// multiplies score and pop
export function editorialBoost(s) {
  const t = text(s);
  let k = 1;
  if (s.tags?.some((g) => EDITOR_COMPS.has(g.id))) k *= 1.25;
  if (isScoop(s) || TRANSFER.test(t)) k *= 1.3;
  if (LOW_VALUE.test(s.title) || LOW_VALUE.test(s.t?.en?.title || '')) k *= 0.6;
  if (k === 1) return s;
  const r2 = (x) => Math.round(x * 100) / 100;
  return { ...s, score: r2(s.score * k), pop: r2(s.pop * k) };
}

// Other sports: the events worth an editor's time
const BIG_EVENT = /super bowl|world series|stanley cup final|nba finals|wimbledon|roland[- ]garros|french open|australian open|us open|atp finals|wta finals|davis cup final|grand prix|\bgp\b|world champion|\bolympic|olympics|tour de france|giro d'italia|vuelta|ryder cup|the masters|world cup final|title fight|undisputed|heavyweight title|world title|ufc \d{3}|גראנד סלאם|וימבלדון|רולאן גארוס|אליפות העולם|אולימפי|טור דה פראנס|גראנד פרי|פורמולה 1|סופרבול|קרב על התואר/i;
export const bigEvent = (s) => BIG_EVENT.test(text(s));

// ---------- local leagues: interesting only with a reason ----------
// Big for Sport5's editors: England, Spain, Italy, Germany, France, the European cups, NBA / EuroLeague / EuroCup,
// national teams, Israel. A story whose every article comes from a local market (Greece, Portugal, Turkey, the
// Netherlands, Belgium, Serbia, Romania, Cyprus, South America… by the outlet's country, else its language) and
// that has no big competition, Israeli angle, spread or famous name is "local": kept, but low and out of Hot /
// the morning brief / Telegram.
const BIG_COMPS = new Set(['c-epl', 'c-laliga', 'c-seriea', 'c-bundes', 'c-ligue1', 'c-nba', 'c-euroleague', 'c-wc', 'c-ligat', 'c-leumit', 'c-statecup', 'c-toto', 'c-winner', 'c-wcup']);
const BASKET_COMPS = new Set(['c-nba', 'c-euroleague', 'c-eurocup', 'c-winner', 'c-wcup']);
// European cups: only when the articles name the cup (a cup club's own league news is local; EuroCup clubs too)
const EURO_CUPS = new Set(['c-ucl', 'c-uel', 'c-uecl', 'c-eurocup']);
const LOCAL_COUNTRIES = new Set(['Portugal', 'Brazil', 'Argentina', 'Turkey', 'Greece', 'Netherlands', 'Belgium', 'Cyprus', 'Serbia', 'Romania']);
const LOCAL_LANGS = new Set(['el', 'hu', 'ro', 'sr', 'tr', 'pt', 'nl', 'cs', 'sk', 'pl', 'bg', 'hr', 'sl', 'uk', 'ru', 'lt', 'lv', 'sv', 'no', 'da', 'ja']);
const STARS = /mourinho|ronaldo|messi|neymar|ancelotti|guardiola|klopp|ibrahimovi|benzema|zidane|modri[cć]|lewandowski|mbapp|haaland|salah|griezmann|de bruyne|xavi|iniesta|pochettino|tuchel|simeone|lebron|curry|don[cč]i[cć]|giannis|antetokounmpo|joki[cć]|wembanyama|מוריניו|רונאלדו|מסי|נימאר|אנצ'לוטי|גווארדיולה|לברון|דונצ'יץ'/i;

export const memberLocal = (m, src) => (src?.country ? LOCAL_COUNTRIES.has(src.country) : LOCAL_LANGS.has(m.lang));

export function markLocal(s, isLocal) {
  if (s.israel || s.abroad || s.athletes?.length) return s; // Israeli angle
  // a big league / EuroLeague club — in the story's own sport (PAOK football news isn't EuroCup basketball)
  if ((s.comps || []).some((c) => BIG_COMPS.has(c) && (BASKET_COMPS.has(c) ? s.sport === 'basketball' : s.sport !== 'basketball'))) return s;
  const named = new Set((s._members || []).flatMap((m) => (m.ents || []).filter((id) => id.startsWith('c-'))));
  if ([...named].some((c) => EURO_CUPS.has(c))) return s; // a European cup game
  if ((s.langs?.length || 0) >= 3 || s.trending || s.reddit) return s; // spreading / viral
  if (STARS.test(text(s))) return s; // a famous name
  if (!(s._members || []).length || !s._members.every(isLocal)) return s; // someone outside the local market covers it
  const r2 = (x) => Math.round(x * 100) / 100;
  return { ...s, local: true, score: r2(s.score * 0.35), pop: r2(s.pop * 0.35) };
}
