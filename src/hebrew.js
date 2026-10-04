// Hebrew word normalisation shared by clustering and the sport model.
// Hebrew attaches one-letter prefixes (ה ו ב ל מ ש כ: "the / and / in / to / from / that / as"), so "במכבי" is
// "in Maccabi". Stripping the first letter blindly also breaks names that start with those letters:
// "מכבי" became "כבי" while "במכבי" became "מכבי" — the same club as two different words.
// Known names (clubs, players, competitions) are protected: a known name is kept as is, and a prefixed known name
// ("במכבי", "להפועל") is reduced to it. Other words keep the old rule.

const PREFIX = /^[הובלמשכ]/;
// common names even before the knowledge base loads (and for tests)
const SEED = 'מכבי הפועל ביתר בני עירוני הכח מילאן ברצלונה ליברפול מנצסטר באיירן ריאל בלייזרס לייקרס בוסטון מיאמי הולנד ספרד שוויץ בלגיה ליגת ליגה מונדיאל כדורגל כדורסל שחקן שחקנים מאמן משחק משחקים בית בשיקטאש מרסיי מונקו מלבורן לאציו ולנסיה ויאריאל בנפיקה בראגה ספורטינג וולפסבורג לבנטה הרצליה חולון באר שבע';
let names = new Set(SEED.split(/\s+/));

export const heNorm = (w) => String(w || '').replace(/[֑-ׇ]/g, '').replace(/['"׳״`’‘“”]/g, '');

// add names from the knowledge base / the athletes list (any strings; split into words)
export function addHebrewNames(list) {
  for (const s of list || []) for (const w of heNorm(s).split(/[^\p{L}\p{N}]+/u)) if (/[א-ת]/.test(w) && w.length >= 3) names.add(w);
}

// one Hebrew word → its base form
export function heBase(w) {
  if (!/[א-ת]/.test(w) || w.length < 4 || !PREFIX.test(w)) return w;
  if (names.has(w)) return w; // a name that starts with a prefix letter (מכבי, הפועל, מילאן)
  return w.slice(1); // "במכבי" → "מכבי", "להפועל" → "הפועל", and any other prefixed word
}
