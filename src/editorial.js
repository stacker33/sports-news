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
