'use strict';

const REFRESH_MS = 30 * 1000; // news check
const SCORES_LIVE_MS = 30 * 1000;
const SCORES_IDLE_MS = 2 * 60 * 1000;
const STALE_MIN = 10;
const HOT_HOURS = 3;

const T = {
  he: {
    appName: 'רדאר ספורט',
    search: 'חיפוש…',
    empty: 'אין ידיעות להצגה',
    tabs: {
      top: '🔥 הכי חם', foryou: '⭐ בשבילך', ilFootball: '🇮🇱 כדורגל ישראלי', ilBasketball: '🇮🇱 כדורסל ישראלי', ilOther: '🇮🇱 אולימפי ועוד',
      abroad: '✈️ ישראלים בחו"ל', football: '⚽ כדורגל עולמי', basketball: '🏀 כדורסל עולמי', other: '🏆 ענפים אחרים',
    },
    langs: { all: '🌍 כל העולם (מתורגם)', he: 'עברית בלבד', en: 'English only' },
    langName: { en: 'אנגלית', es: 'ספרדית', it: 'איטלקית', de: 'גרמנית', fr: 'צרפתית', pt: 'פורטוגזית', nl: 'הולנדית', tr: 'טורקית', el: 'יוונית', sr: 'סרבית', ro: 'רומנית', hu: 'הונגרית', pl: 'פולנית', ja: 'יפנית', cs: "צ'כית", he: 'עברית' },
    translatedFrom: (l) => `🌐 תורגם מ${l}`,
    readOriginal: 'למאמר המלא (מתורגם)',
    languages: (n) => `🌍 ${n} שפות`,
    rivalPress: (c) => `🆚 עיתונות מ${T.he.country[c] || c}`,
    trending: (tr) => `📈 טרנד בגוגל ${tr.geo} (${tr.traffic.toLocaleString()}+ חיפושים)`,
    reddit: (r) => `👍 Reddit r/${r.sub} #${r.rank}`,
    allRivals: 'כל היריבות',
    bubble: {
      open: '💬 תרגום ולמה זה מעניין',
      why: '💡 למה זה מעניין',
      translation: (l) => `תרגום מ${l}:`,
      whyTitle: 'למה זה עשוי לעניין אותך:',
      rival: (il, op, when, comp) => `מזכיר את ${il} — שפוגשת את ${op} ${when}${comp ? ` (${comp})` : ''}`,
      athlete: (n, team) => `מזכיר את ${n}${team ? `, שמשחק ב${team}` : ''}`,
      team: (team, players) => `על ${team} — הקבוצה של ${players}`,
      mentions: (x) => `מזכיר את ${x}`,
      israel: 'קשור לספורט הישראלי',
      world: (langs, n) => `סיפור גדול: ${n} כלי תקשורת ב-${langs} שפות`,
      trend: (tr) => `טרנד בגוגל ב${tr.geo}: "${tr.term}" (${tr.traffic.toLocaleString()}+ חיפושים)`,
      wiki: (w) => `${w.title}: ${w.views.toLocaleString()} צפיות בוויקיפדיה אתמול${w.ratio >= 2 ? ` (×${w.ratio} מהרגיל)` : ''}`,
      reddit: (r) => `חם עכשיו ב-Reddit r/${r.sub} (מקום ${r.rank})`,
      you: (x) => `דומה למה שקראת: ${x}`,
    },
    ilNames: { Israel: 'נבחרת ישראל', 'Maccabi Tel Aviv': 'מכבי תל אביב', 'Hapoel Tel Aviv': 'הפועל תל אביב', 'Hapoel Jerusalem': 'הפועל ירושלים', 'Maccabi Haifa': 'מכבי חיפה', 'Hapoel Beer Sheva': 'הפועל באר שבע', "Hapoel Be'er Sheva": 'הפועל באר שבע', 'Beitar Jerusalem': 'בית"ר ירושלים', 'Hapoel Holon': 'הפועל חולון', 'Bnei Herzliya': 'בני הרצליה', 'Maccabi Rishon LeZion': 'מכבי ראשון לציון', 'Hapoel Haifa': 'הפועל חיפה' },
    country: { Ireland: 'אירלנד', 'Republic of Ireland': 'אירלנד', Austria: 'אוסטריה', Kosovo: 'קוסובו', Serbia: 'סרביה', Turkiye: 'טורקיה', Turkey: 'טורקיה', Greece: 'יוון', Spain: 'ספרד', France: 'צרפת', Germany: 'גרמניה', Italy: 'איטליה', England: 'אנגליה', Scotland: 'סקוטלנד', Portugal: 'פורטוגל', Netherlands: 'הולנד', Belgium: 'בלגיה', Lithuania: 'ליטא', Latvia: 'לטביה', Poland: 'פולין', Hungary: 'הונגריה', Romania: 'רומניה', Cyprus: 'קפריסין', Montenegro: 'מונטנגרו', Slovenia: 'סלובניה', Croatia: 'קרואטיה', Bulgaria: 'בולגריה', Czechia: "צ'כיה", Switzerland: 'שווייץ', Monaco: 'מונקו', Norway: 'נורבגיה', Sweden: 'שוודיה', Denmark: 'דנמרק', Ukraine: 'אוקראינה' },
    mix: { newest: '🕒 הכי חדש', popular: 'הכי פופולרי 🔥' },
    forYou: {
      intro: (n) => `⭐ הטאב לומד ממה שאתם פותחים (${n} כתבות עד עכשיו), ומסתנכרן בין המחשב לטלפון.`,
      cold: 'עוד לא למדתי מה מעניין אתכם — פתחו כמה כתבות בטאבים האחרים, וכאן יופיעו ידיעות לפי הטעם שלכם. בינתיים: הכי חם.',
      reset: 'איפוס למידה',
      confirmReset: 'למחוק את כל מה שהאפליקציה למדה עליכם?',
      because: 'כי קראתם על',
    },
    wiki: (w) => `📚 ויקיפדיה: ${w.views.toLocaleString()} צפיות${w.ratio >= 2 ? ` (×${w.ratio})` : ''}`,
    feat: { football: 'כדורגל', basketball: 'כדורסל', other: 'ענפים אחרים', israel: 'ספורט ישראלי', abroad: 'ישראלים בחו"ל' },
    teamSeg: { players: 'שחקנים', teams: '+ חדשות הקבוצות' },
    side: { scores: '📊 תוצאות', justin: '⚡ עכשיו' },
    nav: { news: '📰 חדשות', scores: '📊 תוצאות', justin: '⚡ עכשיו' },
    days: { '-1': 'אתמול', 0: 'היום', 1: 'מחר' },
    sources: (n) => (n === 1 ? 'מקור 1' : `${n} מקורות`),
    allSources: (n) => `כל ${n} המקורות`,
    hot: 'מתפרץ',
    il: 'ישראל',
    translate: 'תרגום',
    newStories: (n) => `↑ ${n} ידיעות חדשות`,
    updated: (t) => `עודכן ${t}`,
    storyUpdated: (t) => `🔄 כתבות חדשות ${t}`,
    offline: 'אין חיבור',
    allAthletes: 'כולם',
    feeds: (ok, total) => `${ok}/${total} מקורות פעילים`,
    editList: '✏️ עריכת רשימה',
    updatesCount: (n) => ` · ${n} עדכונים`,
    sumBtn: '📝 תקציר',
    fix: {
      btn: '🏷️', title: 'בקטגוריה הלא נכונה? תקנו', football: '⚽ כדורגל', basketball: '🏀 כדורסל', other: '🏅 ספורט אחר',
      il: '🇮🇱 ישראלי', notIl: '🌍 לא ישראלי', hide: '🚫 לא רלוונטי', thanks: 'תודה! תוקן — והמערכת תלמד מזה',
    },
    socialTip: 'פרסום ישיר של הכתב (טלגרם / Bluesky) — לרוב מהיר יותר מהכתבות',
    video: 'וידאו', videoTip: 'סרטון מהערוץ הרשמי (מסיבת עיתונאים, ראיון או תקציר)',
    sumTranslated: 'תורגם אוטומטית',
    scoresLoading: 'טוען תוצאות…',
    noGames: 'אין משחקים ביום הזה',
    abroadGames: 'משחקי הישראלים בחו"ל',
    pc: {
      last: 'משחק אחרון', next: 'הבא', season: 'העונה', news: 'חדשות', vs: 'נגד', at: 'אצל',
      didntPlay: 'לא שיחק', notSince: (d) => `לא שיחק מאז ${d}`, ofGames: (a, b) => `שיחק ב-${a} מתוך ${b} משחקים`, missed: (h, a) => `לא שיחק ב${h}–${a}`, rating: 'ציון', games: 'משחקים', goals: 'שערים', assists: 'בישולים',
      viewNews: '📰 חדשות', viewPlayers: '👤 שחקנים', football: '⚽ כדורגל', basketball: '🏀 כדורסל', today: 'היום',
      place: (p, n) => `מקום ${p} מתוך ${n}`, contract: 'חוזה עד', loading: 'טוען נתונים…', all: 'כל השחקנים', minutes: 'דק׳',
    },
    scoresError: 'לא הצלחנו לטעון תוצאות',
    notif: {
      title: 'התראות',
      enable: 'הפעל התראות',
      blocked: 'הדפדפן חוסם התראות לאתר הזה. אפשר לשנות בהגדרות האתר בדפדפן.',
      unsupported: 'הדפדפן הזה לא תומך בהתראות.',
      note: 'ההתראות עובדות כל עוד האפליקציה פתוחה (גם ברקע). בטלפון: הוסיפו למסך הבית.',
      abroad: '✈️ ישראלים בחו"ל',
      israel: '🇮🇱 ספורט ישראלי',
      big: '🔥 ידיעות גדולות / מתפרצות',
      all: '📰 כל ידיעה חדשה',
      scores: '⚽ שערים ותוצאות של קבוצות הישראלים בחו"ל',
      test: 'שלח התראת בדיקה',
      close: 'סגור',
      testBody: 'ההתראות עובדות ✔',
      many: (n) => `${n} ידיעות חדשות`,
    },
    list: {
      sugTitle: '🔄 עדכונים שמצאתי (לפי סגלי הקבוצות העדכניים)',
      sugReturned: (n, t) => `${n} משחק עכשיו בישראל (${t}) — להסיר מהרשימה?`,
      sugMoved: (n, f, t) => `${n} עבר מ${f} ל${t} — לעדכן?`,
      sugNew: (n, t) => `ישראלי בחו"ל שלא ברשימה: ${n} (${t}) — להוסיף?`,
      doRemove: 'הסר', doUpdate: 'עדכן', doAdd: 'הוסף', doIgnore: 'התעלם',
      noSug: 'הרשימה מעודכנת לפי הסגלים ✔',
      title: 'ישראלים בחו"ל — עריכת רשימה',
      name: 'שם (אנגלית)', name_he: 'שם (עברית)', team: 'קבוצה', team_he: 'קבוצה (עברית)', country: 'מדינה', sport: 'ענף',
      alt: 'כתיבים נוספים (בפסיקים)', team_alt: 'שמות נוספים לקבוצה',
      football: 'כדורגל', basketball: 'כדורסל',
      add: '+ הוסף שחקן', save: 'שמור', cancel: 'ביטול', remove: 'הסר',
      saving: 'שומר ואוסף חדשות…', saved: 'נשמר ✔ החדשות על השחקנים מתעדכנות',
      readOnly: 'בגרסת הענן אי אפשר לשמור מכאן. ערכו את הרשימה בגרסת המחשב (npm start) או בקובץ config/athletes.json.',
      noTeam: 'לא נמצא בלוח התוצאות',
      error: 'השמירה נכשלה',
    },
  },
  en: {
    appName: 'Sports Radar',
    search: 'Search…',
    empty: 'No stories to show',
    tabs: {
      top: '🔥 Top', foryou: '⭐ For you', ilFootball: '🇮🇱 Israeli football', ilBasketball: '🇮🇱 Israeli basketball', ilOther: '🇮🇱 Olympic & more',
      abroad: '✈️ Israelis abroad', football: '⚽ World football', basketball: '🏀 World basketball', other: '🏆 Other sports',
    },
    langs: { all: '🌍 Whole world (translated)', he: 'Hebrew only', en: 'English only' },
    langName: { he: 'Hebrew', es: 'Spanish', it: 'Italian', de: 'German', fr: 'French', pt: 'Portuguese', nl: 'Dutch', tr: 'Turkish', el: 'Greek', sr: 'Serbian', ro: 'Romanian', hu: 'Hungarian', pl: 'Polish', ja: 'Japanese', cs: 'Czech', en: 'English' },
    translatedFrom: (l) => `🌐 translated from ${l}`,
    readOriginal: 'full article (translated)',
    languages: (n) => `🌍 ${n} languages`,
    rivalPress: (c) => `🆚 press from ${c}`,
    trending: (tr) => `📈 Google trend ${tr.geo} (${tr.traffic.toLocaleString()}+ searches)`,
    reddit: (r) => `👍 Reddit r/${r.sub} #${r.rank}`,
    allRivals: 'All',
    bubble: {
      open: '💬 Translation & why it matters',
      why: '💡 Why it matters',
      translation: (l) => `Translated from ${l}:`,
      whyTitle: 'Why this might interest you:',
      rival: (il, op, when, comp) => `Mentions ${il} — they play ${op} ${when}${comp ? ` (${comp})` : ''}`,
      athlete: (n, team) => `Mentions ${n}${team ? `, who plays for ${team}` : ''}`,
      team: (team, players) => `About ${team} — ${players}'s club`,
      mentions: (x) => `Mentions ${x}`,
      israel: 'Related to Israeli sport',
      world: (langs, n) => `Big story: ${n} outlets in ${langs} languages`,
      trend: (tr) => `Trending on Google in ${tr.geo}: "${tr.term}" (${tr.traffic.toLocaleString()}+ searches)`,
      wiki: (w) => `${w.title}: ${w.views.toLocaleString()} Wikipedia views yesterday${w.ratio >= 2 ? ` (×${w.ratio} normal)` : ''}`,
      reddit: (r) => `Hot on Reddit r/${r.sub} right now (#${r.rank})`,
      you: (x) => `Similar to what you read: ${x}`,
    },
    ilNames: {},
    mix: { newest: '🕒 Newest', popular: 'Most popular 🔥' },
    forYou: {
      intro: (n) => `⭐ This tab learns from what you open (${n} stories so far) and syncs between PC and phone.`,
      cold: "I haven't learned your taste yet — open a few stories in the other tabs and they'll shape this one. Meanwhile: Top stories.",
      reset: 'Reset learning',
      confirmReset: 'Delete everything the app learned about you?',
      because: 'Because you read about',
    },
    wiki: (w) => `📚 Wikipedia: ${w.views.toLocaleString()} views${w.ratio >= 2 ? ` (×${w.ratio})` : ''}`,
    feat: { football: 'football', basketball: 'basketball', other: 'other sports', israel: 'Israeli sport', abroad: 'Israelis abroad' },
    teamSeg: { players: 'Players', teams: '+ Team news' },
    side: { scores: '📊 Scores', justin: '⚡ Just in' },
    nav: { news: '📰 News', scores: '📊 Scores', justin: '⚡ Just in' },
    days: { '-1': 'Yesterday', 0: 'Today', 1: 'Tomorrow' },
    sources: (n) => (n === 1 ? '1 source' : `${n} sources`),
    allSources: (n) => `All ${n} sources`,
    hot: 'BREAKING',
    il: 'Israel',
    translate: 'Translate',
    newStories: (n) => `↑ ${n} new stories`,
    updated: (t) => `updated ${t}`,
    storyUpdated: (t) => `🔄 new coverage ${t}`,
    offline: 'offline',
    allAthletes: 'All',
    feeds: (ok, total) => `${ok}/${total} sources live`,
    editList: '✏️ Edit list',
    updatesCount: (n) => ` · ${n} updates`,
    sumBtn: '📝 Summary',
    fix: {
      btn: '🏷️', title: 'Wrong category? Fix it', football: '⚽ Football', basketball: '🏀 Basketball', other: '🏅 Other sport',
      il: '🇮🇱 Israeli', notIl: '🌍 Not Israeli', hide: '🚫 Not relevant', thanks: 'Thanks! Fixed, and the system will learn from it',
    },
    socialTip: "The reporter's own post (Telegram / Bluesky) — usually ahead of the articles",
    video: 'Video', videoTip: 'Video from the official channel (press conference, interview or highlights)',
    sumTranslated: 'machine-translated',
    scoresLoading: 'Loading scores…',
    noGames: 'No games on this day',
    abroadGames: 'Israelis abroad — games',
    pc: {
      last: 'Last game', next: 'Next', season: 'Season', news: 'News', vs: 'vs', at: 'at',
      didntPlay: "didn't play", notSince: (d) => `hasn't played since ${d}`, ofGames: (a, b) => `played ${a} of ${b} games`, missed: (h, a) => `didn't play in ${h}–${a}`, rating: 'rating', games: 'games', goals: 'goals', assists: 'assists',
      viewNews: '📰 News', viewPlayers: '👤 Players', football: '⚽ Football', basketball: '🏀 Basketball', today: 'Today',
      place: (p, n) => `${p}${['th', 'st', 'nd', 'rd'][p % 10 > 3 || Math.floor(p / 10) === 1 ? 0 : p % 10]} of ${n}`, contract: 'contract until', loading: 'loading…', all: 'All players', minutes: 'min',
    },
    scoresError: "Couldn't load scores",
    notif: {
      title: 'Notifications',
      enable: 'Turn on notifications',
      blocked: 'Your browser blocks notifications for this site. You can change it in the site settings.',
      unsupported: "This browser doesn't support notifications.",
      note: 'Notifications work while the app is open (also in the background). On a phone: add it to the home screen.',
      abroad: '✈️ Israelis abroad',
      israel: '🇮🇱 Israeli sport',
      big: '🔥 Big / breaking stories',
      all: '📰 Every new story',
      scores: "⚽ Goals & results of Israelis' teams",
      test: 'Send a test notification',
      close: 'Close',
      testBody: 'Notifications work ✔',
      many: (n) => `${n} new stories`,
    },
    list: {
      sugTitle: '🔄 Updates found (from current squads)',
      sugReturned: (n, t) => `${n} now plays in Israel (${t}) — remove from the list?`,
      sugMoved: (n, f, t) => `${n} moved from ${f} to ${t} — update?`,
      sugNew: (n, t) => `Israeli abroad not on your list: ${n} (${t}) — add?`,
      doRemove: 'Remove', doUpdate: 'Update', doAdd: 'Add', doIgnore: 'Ignore',
      noSug: 'The list matches the current squads ✔',
      title: 'Israelis abroad — edit list',
      name: 'Name (English)', name_he: 'Name (Hebrew)', team: 'Team', team_he: 'Team (Hebrew)', country: 'Country', sport: 'Sport',
      alt: 'Other spellings (commas)', team_alt: 'Other team names',
      football: 'Football', basketball: 'Basketball',
      add: '+ Add player', save: 'Save', cancel: 'Cancel', remove: 'Remove',
      saving: 'Saving and collecting news…', saved: 'Saved ✔ news for these players is updating',
      readOnly: "The cloud version can't save from here. Edit the list in the PC version (npm start) or in config/athletes.json.",
      noTeam: 'not found on the scoreboard',
      error: 'Saving failed',
    },
  },
};

const TABS = ['top', 'foryou', 'ilFootball', 'ilBasketball', 'ilOther', 'abroad', 'football', 'basketball', 'other'];
const LANG_FILTERS = ['all', 'he', 'en'];

// ---------- state (UI prefs remembered per device) ----------
const store = {
  get(k, d) { try { return JSON.parse(localStorage.getItem('sr.' + k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem('sr.' + k, JSON.stringify(v)); } catch {} },
};
const state = {
  ui: store.get('ui', 'he'),
  tab: TABS.includes(store.get('tab')) ? store.get('tab') : 'top',
  langFilter: ['all', 'he', 'en'].includes(store.get('langFilter')) ? store.get('langFilter') : 'all',
  rival: null,
  mix: Number(store.get('mix', 40)),
  abroadView: store.get('abroadView', 'news') === 'players' ? 'players' : 'news', // Israelis abroad: 📰 news | 👤 players // 0 = newest … 100 = most popular
  affinity: null,
  tag: null, // topic filter (clicked tag)
  sort: null, // null = tab default
  athlete: null,
  teamNews: store.get('teamNews', false),
  q: '',
  view: 'news', // mobile: news | panel
  panel: store.get('panel', 'scores'), // scores | justin
  scoreDay: 0,
  scores: null,
  scoresError: false,
  data: null,
  athletes: null, // { athletes, countries }
  seen: new Set(),
  bigSeen: new Set(),
  pending: null,
  lastFetchOk: true,
  unread: 0,
  notif: store.get('notif', { enabled: false, abroad: true, israel: true, big: true, all: false, scores: true }),
};

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const t = () => T[state.ui];
const isDesktop = () => matchMedia('(min-width: 1100px)').matches;

// ---------- time ----------
function ago(ts) {
  const rtf = new Intl.RelativeTimeFormat(state.ui === 'he' ? 'he' : 'en', { numeric: 'auto', style: 'short' });
  const s = Math.round((ts - Date.now()) / 1000);
  if (s > -60) return state.ui === 'he' ? 'עכשיו' : 'just now';
  const m = Math.round(s / 60);
  if (m > -60) return rtf.format(m, 'minute');
  const h = Math.round(m / 60);
  if (h > -24) return rtf.format(h, 'hour');
  return rtf.format(Math.round(h / 24), 'day');
}
const hhmm = (ts) => new Date(ts).toLocaleTimeString(state.ui === 'he' ? 'he-IL' : 'en-GB', { hour: '2-digit', minute: '2-digit' });

// ---------- category corrections ----------
// Each fix: { id, links, sport?, israel?, hide?, t }. Applied to the matching story on this device at once, and sent
// to a public ntfy.sh topic that the collector reads every run (it then trains the sport model on it).
const FIX_TOPIC = 'https://ntfy.sh/sports-radar-fix-b5e962ea3039dbb3';
const FIX_DAYS = 3;
let fixes = store.get('fixes', []).filter((f) => Date.now() - f.t < FIX_DAYS * 864e5);

function fixFor(s) {
  const links = new Set(s.sources.map((x) => x.link));
  return fixes.filter((f) => f.id === s.id || f.links.some((l) => links.has(l))).reduce((a, f) => ({ ...a, ...f }), null);
}
function applyFixes(stories) {
  return stories
    .map((s) => {
      const f = fixFor(s);
      if (!f) return s;
      return { ...s, ...(f.sport ? { sport: f.sport } : {}), ...(f.israel != null ? { israel: f.israel } : {}), hide: !!f.hide };
    })
    .filter((s) => !s.hide);
}
function sendFix(s, change) {
  // full correction for this story (earlier choices + this one), so the collector can simply take the latest
  const prev = fixes.find((f) => f.id === s.id) || {};
  const fix = { ...prev, id: s.id, links: s.sources.map((x) => x.link).slice(0, 15), ...change, t: Date.now() };
  fixes = [...fixes.filter((f) => f.id !== s.id), fix];
  store.set('fixes', fixes);
  fetch(FIX_TOPIC, { method: 'POST', body: JSON.stringify({ v: 1, ...fix, title: s.title.slice(0, 140) }) }).catch(() => {});
}
function toast(text) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = text;
  document.body.append(el);
  setTimeout(() => el.remove(), 3500);
}

// ---------- filtering ----------

function inTab(s, tab) {
  switch (tab) {
    case 'top': return s.sport !== 'other' || s.big;
    case 'foryou': return true;
    case 'ilFootball': return s.israel && s.sport === 'football';
    case 'ilBasketball': return s.israel && s.sport === 'basketball';
    case 'ilOther': return s.israel && s.sport === 'other';
    case 'abroad': return s.abroad || (state.teamNews && s.teams?.length > 0);
    case 'football': return !s.israel && s.sport === 'football';
    case 'basketball': return !s.israel && s.sport === 'basketball';
    case 'other': return !s.israel && s.sport === 'other';
  }
  return true;
}

// Language filter: 'all' = everything (foreign headlines are translated); he/en = stories with an article in that language
function langOk(s) {
  if (state.langFilter === 'all') return true;
  return (s.langs || [s.lang]).includes(state.langFilter);
}
const langOkFor = langOk;

// Headline + link to show in the app's language
function disp(s) {
  const own = s.t?.[state.ui];
  if (own && !own.from) return { ...own, lang: state.ui }; // a real article in the app's language
  const otherLang = state.ui === 'he' ? 'en' : 'he';
  const other = s.t?.[otherLang];
  if (other && !other.from) return { ...other, lang: otherLang }; // a real article in the other language you read
  return { title: s.title, link: s.link, lang: s.lang }; // original language
}

// Under a headline that isn't in the app's language: the headline in the app's language
// (written by the language model when available, otherwise machine-translated)
function titleLine(s, d) {
  if (d.lang === state.ui) return '';
  const text = (state.ui === 'he' && s.ai?.he?.title) || (s.t?.[state.ui]?.from ? s.t[state.ui].title : '');
  return text ? `<p class="title-tr" dir="auto">${state.ui === 'he' ? '🇮🇱' : '🌐'} ${esc(text)}</p>` : '';
}

// 2–3 sentence summary by the language model, shown in full
function aiSummaryHtml(s) {
  const text = s.ai?.[state.ui]?.sum;
  return text ? `<p class="ai-sum" dir="auto">${esc(text)}</p>` : '';
}
// Machine translation of the shown headline (for the bubble), if the headline isn't Hebrew/English
function translationOf(s, d) {
  if (d.link !== s.link || s.lang === 'he' || s.lang === 'en') return null;
  const tr = s.t?.[state.ui]?.from ? s.t[state.ui] : s.t?.[state.ui === 'he' ? 'en' : 'he'];
  return tr?.from ? tr.title : null;
}

// Topic line under each story: competition · teams · players (Israeli ones highlighted); click one to filter
const TAG_ICON = { comp: '🏆', team: '🛡️', player: '👤' };
const tagName = (g) => (state.ui === 'he' && g.he ? g.he : g.en);
function tagsHtml(s) {
  if (!s.tags?.length) return '';
  return `<div class="tags">${s.tags
    .map((g) => `<button type="button" class="tag${g.il ? ' il' : ''}${g.id === state.tag ? ' on' : ''}" data-tag="${esc(g.id)}">${TAG_ICON[g.k] || ''} ${esc(tagName(g))}</button>`)
    .join('')}</div>`;
}
// 📝 Summary bubble: one or two sentences about the story (translated when it isn't Hebrew/English)
function summaryHtml(s) {
  if (!s.sum?.text) return '';
  const native = s.sum.lang === 'he' || s.sum.lang === 'en';
  const text = native ? s.sum.text : s.sum[state.ui] || s.sum[state.ui === 'he' ? 'en' : 'he'] || s.sum.text;
  const note = !native && text !== s.sum.text ? `<span class="sum-note">${esc(t().sumTranslated)}</span>` : '';
  return `<button type="button" class="sum-btn" aria-expanded="false">${esc(t().sumBtn)}</button>
    <div class="bubble sum-bubble" hidden><p dir="auto">${esc(text)}</p>${note}</div>`;
}

function athleteOk(s) {
  if (!state.athlete) return true;
  if (s.athletes.includes(state.athlete)) return true;
  if (!state.teamNews) return false;
  const a = state.athletes?.athletes.find((x) => x.name === state.athlete);
  return !!a && s.teams?.includes(a.team);
}

function visibleStories() {
  if (!state.data) return [];
  const q = state.q.trim().toLowerCase();
  let list = state.data.stories.filter(
    (s) =>
      inTab(s, state.tab) && langOk(s) && athleteOk(s) && (!state.rival || s.rival?.opponent === state.rival) &&
      (!state.tag || s.tags?.some((g) => g.id === state.tag)) &&
      (!q || [s.title, s.t?.he?.title, s.t?.en?.title, ...s.sources.map((x) => x.title)].some((x) => x && x.toLowerCase().includes(q)))
  );
  const mix = rankMix(list);
  if (state.tab === 'foryou' && Learn.count() >= 3) {
    state.affinity = Learn.affinity(state.data.stories);
    list = list.filter((s) => state.affinity.has(s.id));
    const val = (s) => 0.6 * state.affinity.get(s.id).score + 0.4 * mix(s);
    return list.sort((a, b) => val(b) - val(a)).slice(0, 150);
  }
  if (state.tab === 'top' || state.tab === 'foryou') list = list.filter((s) => s.sport !== 'other' || s.big);
  list.sort((a, b) => mix(b) - mix(a));
  // at the popular end, keep the list focused
  return list.slice(0, state.mix >= 70 ? 120 : 300);
}

// Slider: 0 = newest first … 100 = most popular (coverage, languages, Google Trends, Reddit, Wikipedia)
function rankMix(list) {
  const w = state.mix / 100;
  const maxPop = Math.log1p(Math.max(1, ...list.map((s) => s.pop ?? s.score)));
  const now = Date.now();
  return (s) => {
    const popN = Math.log1p(s.pop ?? s.score) / maxPop;
    const freshN = Math.exp(-(now - s.first) / (6 * 3600e3)); // halves roughly every 4 hours
    return w * popN + (1 - w) * freshN;
  };
}

function featLabel(f) {
  const i = f.indexOf(':');
  const [k, v] = [f.slice(0, i), f.slice(i + 1)];
  if (k === 'sport' || k === 'cat') return t().feat[v] || v;
  if (k === 'rival') return '🆚 ' + v;
  if (k === 'tag') {
    const g = state.data?.stories.flatMap((s) => s.tags || []).find((x) => x.id === v);
    return g ? tagName(g) : v;
  }
  if (k === 'ath') {
    const a = state.athletes?.athletes.find((x) => x.name === v);
    return state.ui === 'he' && a?.name_he ? a.name_he : v;
  }
  return v; // team, source, keyword
}

const catIcon = (s) => (s.abroad ? '✈️' : s.israel ? '🇮🇱' : s.sport === 'basketball' ? '🏀' : s.sport === 'football' ? '⚽' : '🏆');

// ---------- rendering: news ----------
function translateUrl(link) {
  const tl = state.ui === 'he' ? 'iw' : 'en';
  return `https://translate.google.com/translate?sl=auto&tl=${tl}&u=${encodeURIComponent(link)}`;
}

function cardHtml(s, fresh) {
  const isHot = s.breaking && s.sourceCount >= 2 && Date.now() - s.first < HOT_HOURS * 3600e3;
  const d = disp(s);
  if (d.link === s.link && s.realLink) d.link = s.realLink;
  const L = t();
  const foreignLink = d.link === s.link && s.lang !== 'he' && s.lang !== 'en';
  const lead = (d.link !== s.link && s.sources.find((x) => x.link === d.link)?.name) || s.sources[0]?.name || '';
  const img = s.image
    ? `<img class="thumb" src="${esc(s.image)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">`
    : '';
  const others = s.sources.length > 1
    ? `<details><summary>${esc(t().allSources(s.sourceCount))}</summary><ul>${s.sources
        .map((x) => `<li><b>${esc(x.name)}${x.unknown ? '' : ` · ${timeEl(x.published)}`}</b><a href="${esc(x.link)}" target="_blank" rel="noopener" dir="auto">${esc(x.title)}</a></li>`)
        .join('')}</ul></details>`
    : '';
  return `<article class="card${fresh ? ' fresh' : ''}" data-id="${esc(s.id)}">
    <div class="body">
      <div class="badges">
        ${isHot ? `<span class="badge hot">${esc(t().hot)}</span>` : ''}
        ${s.social?.length ? `<span class="badge social" title="${esc(L.socialTip)}">⚡ ${esc(s.social.join(', '))}</span>` : ''}
        ${s.video && s.video !== d.link ? `<a class="badge video" href="${esc(s.video)}" target="_blank" rel="noopener" title="${esc(L.videoTip)}">🎥 ${esc(L.video)}</a>` : ''}
        ${s.sourceCount > 1 ? `<span class="badge src">${esc(t().sources(s.sourceCount))}</span>` : ''}
        ${s.israel && !state.tab.startsWith('il') ? `<span class="badge il">${esc(t().il)}</span>` : ''}
        ${s.langs?.length >= 3 ? `<span class="badge world" title="${esc(s.langs.join(', '))}">${esc(L.languages(s.langs.length))}</span>` : ''}
        ${s.rival ? `<span class="badge il">${esc(L.rivalPress(s.rival.country))}</span>` : ''}
        ${s.trending ? `<span class="badge trend" title="${esc(s.trending.term)}">${esc(L.trending(s.trending))}</span>` : ''}
        ${s.reddit ? `<span class="badge trend">${esc(L.reddit(s.reddit))}</span>` : ''}
        ${s.wikipedia ? `<span class="badge trend" title="${esc(s.wikipedia.title)}">${esc(L.wiki(s.wikipedia))}</span>` : ''}
      </div>
      <h2 dir="auto"><a href="${esc(d.link)}" target="_blank" rel="noopener">${esc(d.title)}</a></h2>
      ${titleLine(s, d)}
      ${s.ai?.[state.ui]?.sum ? aiSummaryHtml(s) : summaryHtml(s)}
      ${state.tab === 'foryou' && state.affinity?.get(s.id) ? `<p class="why">⭐ ${esc(L.forYou.because)}: ${esc(state.affinity.get(s.id).reasons.map(featLabel).join(' · '))}</p>` : ''}
      <div class="meta">
        <span>${esc(lead)}</span>${s.dateUnknown ? '' : `<span>${timeEl(s.first)}</span>`}${!s.dateUnknown && s.sourceCount > 1 && s.latest - s.first > 30 * 60000 ? `<span>${esc(t().storyUpdated(''))}${timeEl(s.latest)}</span>` : ''}
        ${foreignLink ? `<a href="${esc(translateUrl(s.link))}" target="_blank" rel="noopener">🌐 ${esc(L.readOriginal)}</a>` : ''}
        <button type="button" class="fix-btn" title="${esc(L.fix.title)}" aria-label="${esc(L.fix.title)}" aria-expanded="false">${L.fix.btn}</button>
      </div>
      <div class="fix-menu" hidden>${['football', 'basketball', 'other']
        .filter((sp) => sp !== s.sport)
        .map((sp) => `<button type="button" data-fix="${sp}">${esc(L.fix[sp])}</button>`)
        .join('')}<button type="button" data-fix="${s.israel ? 'notIl' : 'il'}">${esc(s.israel ? L.fix.notIl : L.fix.il)}</button><button type="button" data-fix="hide">${esc(L.fix.hide)}</button></div>
      ${tagsHtml(s)}
    </div>
    ${img}
    ${others}
  </article>`;
}

function renderChrome() {
  document.documentElement.lang = state.ui;
  document.documentElement.dir = state.ui === 'he' ? 'rtl' : 'ltr';
  document.title = (state.unread ? `(${state.unread}) ` : '') + t().appName;
  document.body.dataset.view = state.view;
  document.body.dataset.panel = state.panel;
  $('langBtn').textContent = state.ui === 'he' ? 'EN' : 'עב';
  $('bellBtn').classList.toggle('on', !!state.notif.enabled);
  document.querySelectorAll('[data-i18n]').forEach((el) => (el.textContent = t()[el.dataset.i18n]));
  document.querySelectorAll('[data-i18n-placeholder]').forEach((el) => (el.placeholder = t()[el.dataset.i18nPlaceholder]));

  const counts = {};
  if (state.data) for (const tab of TABS) counts[tab] = state.data.stories.filter((s) => inTab(s, tab) && (tab === 'abroad' || langOkFor(s))).length;
  $('tabs').innerHTML = TABS.map(
    (tab) => `<button class="tab${tab === 'abroad' ? ' tab-abroad' : ''}" role="tab" data-tab="${tab}" aria-selected="${tab === state.tab}">${esc(t().tabs[tab])}${
      state.data ? `<span class="count">${counts[tab]}</span>` : ''
    }</button>`
  ).join('');

  $('langFilter').innerHTML = LANG_FILTERS.map(
    (f) => `<button data-lf="${f}" aria-pressed="${f === state.langFilter}">${esc(t().langs[f])}</button>`
  ).join('');
  $('mixLabelNew').textContent = t().mix.newest;
  $('mixLabelPop').textContent = t().mix.popular;
  $('mix').value = state.mix;

  // Israeli tabs: filter by the opponent's press (Israel–Ireland → Irish press…)
  const rivalBar = $('rivalBar');
  const rivals = state.tab.startsWith('il') ? (state.data?.rivals || []).filter((g) => (state.tab === 'ilBasketball' ? g.sport === 'basketball' : state.tab === 'ilFootball' ? g.sport === 'football' : true)) : [];
  const withNews = rivals.filter((g) => state.data.stories.some((s) => s.rival?.opponent === g.opponent));
  if (withNews.length) {
    const when = (ts) => new Date(ts).toLocaleString(state.ui === 'he' ? 'he-IL' : 'en-GB', { weekday: 'short', hour: '2-digit', minute: '2-digit' });
    rivalBar.innerHTML =
      `<button class="chip" data-rival="" aria-pressed="${!state.rival}">${esc(t().allRivals)}</button>` +
      withNews.map((g) => `<button class="chip" data-rival="${esc(g.opponent)}" aria-pressed="${g.opponent === state.rival}">🆚 ${esc(g.israeli)} – ${esc(g.opponent)} <small>· ${esc(when(g.start))}</small></button>`).join('');
    rivalBar.hidden = false;
  } else {
    rivalBar.hidden = true;
  }

  // Israelis abroad: player chips + team-news toggle + edit button
  const bar = $('abroadBar');
  if (state.tab === 'abroad') {
    const n = {};
    if (state.data) for (const s of state.data.stories) for (const a of s.athletes) n[a] = (n[a] || 0) + 1;
    const players = state.athletes?.athletes || [];
    const label = (a) => (state.ui === 'he' && a.name_he ? a.name_he : a.name);
    const teamLabel = (a) => (state.ui === 'he' && a.team_he ? a.team_he : a.team);
    const sorted = [...players].sort((a, b) => (n[b.name] || 0) - (n[a.name] || 0));
    $('athleteChips').hidden = true; // replaced by the player cards
    $('athleteChips').innerHTML =
      `<button class="chip" data-ath="" aria-pressed="${!state.athlete}">${esc(t().allAthletes)}</button>` +
      sorted
        .map((a) => `<button class="chip" data-ath="${esc(a.name)}" aria-pressed="${a.name === state.athlete}">${esc(label(a))}${a.team ? ` <small>· ${esc(teamLabel(a))}</small>` : ''}${n[a.name] ? ` <b>${n[a.name]}</b>` : ''}</button>`)
        .join('');
    $('teamSeg').innerHTML = ['players', 'teams'].map(
      (m) => `<button data-team="${m}" aria-pressed="${(m === 'teams') === state.teamNews}">${esc(t().teamSeg[m])}</button>`
    ).join('');
    bar.hidden = false;
    const nUpd = state.athletes?.suggestions?.length || 0;
    $('editListBtn').textContent = t().editList + (nUpd ? t().updatesCount(nUpd) : '');
    $('editListBtn').classList.toggle('has-updates', nUpd > 0);
  } else {
    bar.hidden = true;
  }

  $('sideTabs').innerHTML = ['scores', 'justin'].map(
    (p) => `<button data-panel="${p}" aria-pressed="${p === state.panel}">${esc(t().side[p])}</button>`
  ).join('');
  $('bottomNav').innerHTML = ['news', 'scores', 'justin'].map((v) => {
    const active = v === 'news' ? state.view === 'news' : state.view === 'panel' && state.panel === v;
    return `<button data-nav="${v}" aria-pressed="${active}">${esc(t().nav[v])}</button>`;
  }).join('');
  $('scoresPane').hidden = state.panel !== 'scores';
  $('justinPane').hidden = state.panel !== 'justin';
}


function renderStatus() {
  const el = $('status');
  const d = state.data;
  el.classList.remove('stale', 'error');
  if (!d) return void ($('statusText').textContent = '…');
  const ageMin = (Date.now() - d.generatedAt) / 60000;
  if (!state.lastFetchOk) el.classList.add('error');
  else if (ageMin > STALE_MIN) el.classList.add('stale');
  $('statusText').textContent = state.lastFetchOk ? t().updated(ago(d.generatedAt)) : t().offline;
  el.title = new Date(d.generatedAt).toLocaleString();
  $('foot').textContent = t().feeds(d.sources.ok, d.sources.total);
}

// ✈️ Player cards: everything about each Israeli abroad at a glance; click a card to see only his news
function playerCardsHtml() {
  const players = state.athletes?.athletes || [];
  if (!players.length) return '';
  const he = state.ui === 'he';
  const L = t().pc;
  const pick = (o) => (o && typeof o === 'object' ? (he ? o.he || o.en : o.en || o.he) : o);
  const when = (ts) => new Date(ts).toLocaleString(he ? 'he-IL' : 'en-GB', { weekday: 'short', day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' });
  const day = (ts) => new Date(ts).toLocaleDateString(he ? 'he-IL' : 'en-GB', { day: 'numeric', month: 'numeric' });
  const gi = state.data?.gameInfo || {};
  const ctx = { nationalSquad: state.athletes?.nationalSquad || [], natGames: (state.data?.rivals || []).filter((g) => g.national), stories: state.data?.stories || [] };
  const cards = state.athletes?.cards || {};
  const newsOf = (name) => (state.data?.stories || []).filter((s) => s.athletes?.includes(name)).sort((a, b) => b.first - a.first)[0];
  const rank = (a) => (cards[a.name]?.next?.start ?? Infinity); // next to play first
  const build = (a) => {
    const k = cards[a.name];
    let statusText = '';
    const name = he && a.name_he ? a.name_he : a.name;
    const team = he && a.team_he ? a.team_he : a.team;
    const lines = [];
    // status (injured / national team / starting…) for the next or current game
    if (k?.next) {
      const g = { startTime: new Date(k.next.start).toISOString(), statusGroup: k.next.live ? 3 : 2 };
      const st = window.Scores?.playerStatus(a, g, gi[k.next.id], ctx, state.ui);
      if (st) lines.push(`<div class="pc-status">${esc(st)}</div>`);
      statusText = st || '';
    }
    if (k?.last) {
      const l = k.last;
      const score = `${pick(l.home)} ${l.score[0]}–${l.score[1]} ${pick(l.away)}`;
      const me = l.played ? [l.minutes && `${l.minutes} ${L.minutes}`, l.rating && `${L.rating} ${l.rating}`].filter(Boolean).join(' · ') : L.didntPlay;
      if (l.played && Date.now() - l.start > 21 * 86400e3) {
        lines.push(`<div class="pc-status">⏸️ ${esc(L.notSince(day(l.start)))} <span class="muted">(${esc(score)})</span></div>`);
        statusText ||= '⏸️';
      }
      else lines.push(`<div><b>${esc(L.last)}:</b> ${esc(score)} <span class="muted">(${esc(day(l.start))})</span> · ${esc(me)}</div>`);
      if (l.missed) lines.push(`<div class="muted">${esc(L.missed(pick(l.missed.home), pick(l.missed.away)))}</div>`);
    }
    if (k?.next) {
      const n = k.next;
      const home = n.home.id === k.clubId;
      const opp = pick(home ? n.away : n.home);
      const tv = gi[n.id]?.tv?.length ? ` · 📺 ${gi[n.id].tv.join(', ')}` : '';
      lines.push(`<div><b>${esc(L.next)}:</b> ${esc(when(n.start))} ${esc(home ? L.vs : L.at)} ${esc(opp)} <span class="muted">· ${esc(pick(n.comp))}${esc(tv)}</span></div>`);
    }
    if (k?.season) {
      const s = k.season;
      const apps = String(s.apps || '').split('/');
      const bits = [s.apps && (apps.length === 2 ? L.ofGames(apps[0], apps[1]) : `${s.apps} ${L.games}`), s.goals != null && `${s.goals} ${L.goals}`, s.assists != null && `${s.assists} ${L.assists}`, s.rating && `${L.rating} ${s.rating}`].filter(Boolean);
      if (bits.length) lines.push(`<div><b>${esc(L.season)}</b> <span class="muted">(${esc(pick(s.comp))})</span>: ${esc(bits.join(' · '))}</div>`);
    }
    const n = newsOf(a.name);
    if (n) lines.push(`<div class="pc-news">📰 <a href="${esc(disp(n).link)}" target="_blank" rel="noopener" dir="auto">${esc(disp(n).title)}</a> <span class="muted">· ${timeEl(n.first)}</span></div>`);
    if (!k) lines.push(`<div class="muted">${esc(L.loading)}</div>`);
    const table = k?.table ? ` · ${L.place(k.table.pos, k.table.of)}` : '';
    const full = `<article class="pcard${state.athlete === a.name ? ' on' : ''}" data-ath="${esc(a.name)}">
      <header><span class="pc-name">${esc(name)}</span><span class="pc-pos">${esc(pick(k?.position) || '')}</span></header>
      <div class="pc-club">${a.sport === 'basketball' ? '🏀' : '⚽'} ${esc(team)}<span class="muted">${esc(table)}</span></div>
      ${lines.join('')}
    </article>`;
    // compact chip: status icon + name + next game (or "live")
    const icon = (statusText.match(/^(🇮🇱|🤕|🟥|⏸️)/u) || [])[1] || (k?.next?.live ? '🟢' : '');
    const nextShort = k?.next
      ? (new Date(k.next.start).toDateString() === new Date().toDateString()
          ? `${L.today} ${new Date(k.next.start).toLocaleTimeString(he ? 'he-IL' : 'en-GB', { hour: '2-digit', minute: '2-digit' })}`
          : new Date(k.next.start).toLocaleString(he ? 'he-IL' : 'en-GB', { weekday: 'short', hour: '2-digit', minute: '2-digit' }))
      : '';
    const mini = `<button type="button" class="pmini${state.athlete === a.name ? ' on' : ''}" data-ath="${esc(a.name)}" title="${esc(statusText)}">${icon ? `<span>${icon}</span>` : ''}<b>${esc(name)}</b>${nextShort ? `<small>${esc(nextShort)}</small>` : ''}</button>`;
    return { a, full, mini };
  };
  const all = [...players].sort((a, b) => rank(a) - rank(b)).map(build);
  const groups = ['football', 'basketball'].map((sp) => [sp, all.filter((x) => (x.a.sport || 'football') === sp)]).filter(([, list]) => list.length);
  const head = `<div class="seg abroad-view">${['news', 'players']
    .map((v) => `<button type="button" data-av="${v}" aria-pressed="${state.abroadView === v}">${esc(v === 'news' ? L.viewNews : L.viewPlayers)}</button>`)
    .join('')}</div>`;
  if (state.abroadView === 'news') {
    return `<div class="pcards-wrap">${head}<div class="pminis">${groups
      .map(([sp, list]) => `<span class="pmini-label">${esc(L[sp])}</span>${list.map((x) => x.mini).join('')}`)
      .join('')}</div></div>`;
  }
  return `<div class="pcards-wrap">${head}${groups
    .map(([sp, list]) => `<h4 class="pgroup">${esc(L[sp])} <span class="muted">(${list.length})</span></h4><div class="pcards">${list.map((x) => x.full).join('')}</div>`)
    .join('')}</div>`;
}

function renderList(freshIds = new Set()) {
  const list = visibleStories();
  const tagInfo = state.tag && state.data?.stories.flatMap((s) => s.tags || []).find((g) => g.id === state.tag);
  const tagBar = tagInfo ? `<div class="tag-filter"><button type="button" class="tag on" data-tag="${esc(tagInfo.id)}">${TAG_ICON[tagInfo.k] || ''} ${esc(tagName(tagInfo))} ✕</button></div>` : '';
  const banner = tagBar + (state.tab === 'foryou'
    ? `<div class="foryou-bar"><span>${esc(Learn.count() >= 3 ? t().forYou.intro(Learn.count()) : t().forYou.cold)}</span>${Learn.count() ? `<button class="small-btn" id="resetLearn">${esc(t().forYou.reset)}</button>` : ''}</div>`
    : '');
  const cardsRow = state.tab === 'abroad' ? playerCardsHtml() : '';
  const playersOnly = state.tab === 'abroad' && state.abroadView === 'players';
  $('list').innerHTML = cardsRow + (playersOnly ? '' : banner + list.map((s) => cardHtml(s, freshIds.has(s.id))).join(''));
  $('empty').hidden = list.length > 0 || (state.tab === 'abroad' && state.abroadView === 'players');
}

// ---------- rendering: just in ----------
function renderJustIn(freshIds = new Set()) {
  if (!state.data) return;
  const list = state.data.stories
    .filter(langOkFor)
    .filter((s) => !s.dateUnknown && Date.now() - s.first < 6 * 3600e3)
    .sort((a, b) => b.first - a.first)
    .slice(0, 100);
  $('justinPane').innerHTML = `<ul class="justin">${list
    .map(
      (s) => `<li data-id="${esc(s.id)}" class="${freshIds.has(s.id) ? 'fresh' : ''}"><span class="ji-t" title="${esc(ago(s.first))}">${esc(hhmm(s.first))}</span><span class="ji-i">${catIcon(s)}</span>
        <a href="${esc(disp(s).link)}" target="_blank" rel="noopener" dir="auto" title="${esc(translationOf(s, disp(s)) || '')}">${esc(disp(s).title)}</a>
        <span class="ji-s">${esc(s.sources[0]?.name || '')}${s.sourceCount > 1 ? ` +${s.sourceCount - 1}` : ''}</span></li>`
    )
    .join('')}</ul>`;
}

// ---------- rendering: scores ----------
function renderScores() {
  const pane = $('scoresPane');
  const days = [-1, 0, 1].map(
    (d) => `<button data-day="${d}" aria-pressed="${d === state.scoreDay}">${esc(t().days[d])}</button>`
  ).join('');
  pane.innerHTML = `<div class="seg days">${days}</div><div id="scoresBody"></div>`;
  const body = $('scoresBody');
  if (state.scoresError && !state.scores) return void (body.innerHTML = `<p class="muted pad">${esc(t().scoresError)}</p>`);
  window.Scores.render(body, state.scores, {
    lang: state.ui,
    players: state.athletes?.athletes || [],
    labels: { loading: t().scoresLoading, noGames: t().noGames, abroad: t().abroadGames },
    // to explain a missing player: Israel's squad + Israel's games, and fresh injury reports
    ctx: {
      nationalSquad: state.athletes?.nationalSquad || [],
      natGames: (state.data?.rivals || []).filter((g) => g.national),
      gameInfo: state.data?.gameInfo || {},
      stories: state.data?.stories || [],
    },
  });
}

function render(freshIds) {
  renderChrome();
  renderStatus();
  renderList(freshIds);
  renderJustIn(freshIds);
  renderScores();
}

// ---------- data: news ----------
async function loadAthletes() {
  try {
    const res = await fetch(`data/athletes.json?t=${Date.now()}`, { cache: 'no-store' });
    if (res.ok) state.athletes = await res.json();
  } catch {}
}

async function load({ initial = false } = {}) {
  try {
    const res = await fetch(`data/news.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) throw new Error(res.status);
    const data = await res.json();
    data.stories = applyFixes(data.stories);
    state.lastFetchOk = true;

    if (initial || !state.data) {
      state.data = data;
      data.stories.forEach((s) => {
        state.seen.add(s.id);
        if (s.big) state.bigSeen.add(s.id);
      });
      render();
      return;
    }
    if (data.generatedAt === state.data.generatedAt) return renderStatus();

    const prevGen = state.data.generatedAt;
    const freshIds = new Set(data.stories.filter((s) => !state.seen.has(s.id)).map((s) => s.id));
    notifyStories(data, freshIds, prevGen);

    const recent = (s) => !s.dateUnknown && Date.now() - s.first < 90 * 60000;
    const visibleFresh = data.stories.filter((s) => freshIds.has(s.id) && recent(s) && inTab(s, state.tab) && langOk(s));
    if (document.hidden) state.unread += data.stories.filter((s) => freshIds.has(s.id) && recent(s)).length;

    // Always update automatically. If the reader is scrolled down, keep the story they're reading in place.
    const reading = state.view === 'news' && window.scrollY > 200 ? anchorCard() : null;
    applyData(data, freshIds);
    if (reading) {
      restoreAnchor(reading);
      if (visibleFresh.length) showPill(visibleFresh.length);
    }
  } catch (e) {
    state.lastFetchOk = false;
    renderStatus();
  }
}

// The card at the top of the screen + open "all sources" boxes, so a refresh doesn't move the page
function anchorCard() {
  const headerH = document.querySelector('.top').offsetHeight;
  const card = [...document.querySelectorAll('#list .card')].find((c) => c.getBoundingClientRect().bottom > headerH + 10);
  return card ? { id: card.dataset.id, top: card.getBoundingClientRect().top } : null;
}
function restoreAnchor(a) {
  const card = document.querySelector(`#list .card[data-id="${CSS.escape(a.id)}"]`);
  if (card) window.scrollBy(0, card.getBoundingClientRect().top - a.top);
}
let pillTimer;
function showPill(n) {
  $('newPill').textContent = t().newStories(n);
  $('newPill').hidden = false;
  clearTimeout(pillTimer);
  pillTimer = setTimeout(() => ($('newPill').hidden = true), 10000);
}

// Relative times ("5 min ago") refresh by themselves
const timeEl = (ts) => `<time data-ts="${ts}">${esc(ago(ts))}</time>`;
function tickTimes() {
  document.querySelectorAll('time[data-ts]').forEach((el) => (el.textContent = ago(Number(el.dataset.ts))));
}

function applyData(data, freshIds) {
  const open = new Set([...document.querySelectorAll('#list .card details[open]')].map((d) => d.closest('.card').dataset.id));
  state.data = data;
  data.stories.forEach((s) => state.seen.add(s.id));
  state.pending = null;
  renderChrome();
  renderStatus();
  renderList(freshIds);
  open.forEach((id) => document.querySelector(`#list .card[data-id="${CSS.escape(id)}"] details`)?.setAttribute('open', ''));
  renderJustIn(freshIds);
}

// ---------- data: scores ----------
let scoresTimer;
const scoresVisible = () => isDesktop() || (state.view === 'panel' && state.panel === 'scores');

async function loadScores() {
  clearTimeout(scoresTimer);
  const teamIds = [...new Set((state.athletes?.athletes || []).map((a) => a.teamId).filter(Boolean))];
  const wanted = scoresVisible() || (state.notif.enabled && state.notif.scores);
  if (wanted) {
    try {
      const prev = state.scores;
      const scores = await window.Scores.load({ lang: state.ui, dayOffset: state.scoreDay, teamIds });
      state.scores = scores;
      state.scoresError = false;
      if (state.scoreDay === 0) notifyScores(prev, scores);
      if (scoresVisible()) renderScores();
    } catch {
      state.scoresError = true;
      if (scoresVisible()) renderScores();
    }
  }
  scoresTimer = setTimeout(loadScores, state.scores?.live ? SCORES_LIVE_MS : SCORES_IDLE_MS);
}

// ---------- notifications ----------
async function showNotification(title, body, url, tag) {
  if (!state.notif.enabled || !('Notification' in window) || Notification.permission !== 'granted') return;
  const opts = { body, tag, icon: 'icon.svg', badge: 'icon.svg', data: { url } };
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg) return reg.showNotification(title, opts);
  } catch {}
  const n = new Notification(title, opts);
  n.onclick = () => { window.focus(); if (url) window.open(url, '_blank'); };
}

function wantsStory(s) {
  const n = state.notif;
  return n.all || (n.abroad && s.abroad) || (n.israel && s.israel) || (n.big && (s.big || (s.breaking && s.sourceCount >= 2)));
}

function notifyStories(data, freshIds, prevGen) {
  if (!state.notif.enabled) return;
  const picks = [];
  for (const s of data.stories) {
    if (!langOkFor(s)) continue;
    // truly new stories (not an old cluster that changed its lead article)
    const isNew = freshIds.has(s.id) && !s.dateUnknown && Date.now() - s.first < 90 * 60000;
    const becameBig = state.notif.big && s.big && !state.bigSeen.has(s.id) && !freshIds.has(s.id) && Date.now() - s.first < 3 * 3600e3;
    if (s.big) state.bigSeen.add(s.id);
    if ((isNew && wantsStory(s)) || becameBig) picks.push(s);
  }
  if (!picks.length) return;
  if (picks.length > 3) {
    showNotification(t().appName, t().notif.many(picks.length) + ' — ' + picks.slice(0, 3).map((s) => s.title).join(' · '), location.href, 'many');
    return;
  }
  for (const s of picks) {
    const who = s.athletes.length ? `👤 ${s.athletes.join(', ')} · ` : '';
    showNotification(`${catIcon(s)} ${(state.ui === 'he' && disp(s).lang !== 'he' && s.ai?.he?.title) || translationOf(s, disp(s)) || disp(s).title}`, `${who}${s.sources[0]?.name || ''}${s.sourceCount > 1 ? ` +${s.sourceCount - 1}` : ''}`, s.link, s.id);
  }
}

function notifyScores(prev, next) {
  if (!state.notif.enabled || !state.notif.scores || !prev || !next) return;
  const teamIds = new Set((state.athletes?.athletes || []).map((a) => a.teamId).filter(Boolean));
  const before = new Map(prev.games.map((g) => [g.id, g]));
  for (const g of next.games) {
    const h = g.homeCompetitor, a = g.awayCompetitor;
    if (!teamIds.has(h.id) && !teamIds.has(a.id)) continue;
    const old = before.get(g.id);
    if (!old) continue;
    const scoreChanged = old.homeCompetitor.score !== h.score || old.awayCompetitor.score !== a.score;
    const ended = old.statusGroup !== 4 && g.statusGroup === 4;
    const started = old.statusGroup !== 3 && g.statusGroup === 3;
    if ((scoreChanged && g.statusGroup === 3) || ended || started) {
      const icon = g.sportId === 2 ? '🏀' : '⚽';
      // basketball scores change constantly: only start/end
      if (g.sportId === 2 && scoreChanged && !ended && !started) continue;
      showNotification(`${icon} ${h.name} ${Math.max(h.score, 0)}–${Math.max(a.score, 0)} ${a.name}`, `${g.competitionDisplayName || ''} · ${g.shortStatusText || ''}`, location.href, 'game-' + g.id);
    }
  }
}

function openNotifDialog() {
  const n = t().notif;
  const supported = 'Notification' in window;
  const perm = supported ? Notification.permission : 'denied';
  const box = (k) => `<label class="chk"><input type="checkbox" data-nk="${k}" ${state.notif[k] ? 'checked' : ''}> ${esc(n[k])}</label>`;
  $('notifForm').innerHTML = `
    <h3>🔔 ${esc(n.title)}</h3>
    ${!supported ? `<p class="warn">${esc(n.unsupported)}</p>` : perm === 'denied' ? `<p class="warn">${esc(n.blocked)}</p>` : ''}
    <label class="chk big"><input type="checkbox" id="nEnable" ${state.notif.enabled && perm === 'granted' ? 'checked' : ''} ${supported && perm !== 'denied' ? '' : 'disabled'}> ${esc(n.enable)}</label>
    <div class="chk-list">${['abroad', 'israel', 'big', 'scores', 'all'].map(box).join('')}</div>
    <p class="muted">${esc(n.note)}</p>
    <div class="dlg-actions">
      <button type="button" class="small-btn" id="nTest">${esc(n.test)}</button>
      <button class="small-btn primary" value="close">${esc(n.close)}</button>
    </div>`;
  $('notifDialog').showModal();
}

$('notifForm').addEventListener('change', async (e) => {
  if (e.target.id === 'nEnable') {
    if (e.target.checked) {
      const p = await Notification.requestPermission();
      state.notif.enabled = p === 'granted';
      e.target.checked = state.notif.enabled;
    } else state.notif.enabled = false;
  } else if (e.target.dataset.nk) {
    state.notif[e.target.dataset.nk] = e.target.checked;
  }
  store.set('notif', state.notif);
  renderChrome();
  loadScores();
});
$('notifForm').addEventListener('click', (e) => {
  if (e.target.id === 'nTest') showNotification(t().appName, t().notif.testBody, location.href, 'test');
});

// ---------- Israelis-abroad list editor ----------
const SPORTS = ['football', 'basketball'];
let editor = { editable: false, rows: [] };

async function openListEditor() {
  editor = { editable: false, rows: (state.athletes?.athletes || []).map((a) => ({ ...a })) };
  try {
    const res = await fetch('api/athletes', { cache: 'no-store' });
    if (res.ok) {
      const j = await res.json();
      editor = { editable: true, rows: j.athletes };
    }
  } catch {}
  renderListEditor();
  $('listDialog').showModal();
}

function renderListEditor(msg = '') {
  const L = t().list;
  const countries = state.athletes?.countries || { other: 'Other' };
  const known = new Map((state.athletes?.athletes || []).map((a) => [a.name, a]));
  const dis = editor.editable ? '' : 'disabled';
  const field = (i, k, v, ph) => `<label><span>${esc(L[k])}</span><input data-i="${i}" data-k="${k}" value="${esc(v)}" ${dis} ${ph ? `placeholder="${esc(ph)}"` : ''} dir="auto"></label>`;
  const rows = editor.rows
    .map((a, i) => {
      const k = known.get(a.name);
      const noTeam = k && a.team && !k.teamId ? `<span class="warn-inline">⚠ ${esc(L.noTeam)}</span>` : '';
      return `<fieldset class="ath-row">
        ${field(i, 'name', a.name)}${field(i, 'name_he', a.name_he)}
        ${field(i, 'team', a.team)}${field(i, 'team_he', a.team_he)}
        <label><span>${esc(L.country)}</span><select data-i="${i}" data-k="country" ${dis}>${Object.entries(countries)
          .map(([c, label]) => `<option value="${c}" ${c === a.country ? 'selected' : ''}>${esc(label)}</option>`)
          .join('')}</select></label>
        <label><span>${esc(L.sport)}</span><select data-i="${i}" data-k="sport" ${dis}>${SPORTS.map((s) => `<option value="${s}" ${s === a.sport ? 'selected' : ''}>${esc(L[s])}</option>`).join('')}</select></label>
        ${field(i, 'alt', (a.alt || []).join(', '))}${field(i, 'team_alt', (a.team_alt || []).join(', '))}
        <div class="row-foot">${noTeam}${editor.editable ? `<button type="button" class="small-btn danger" data-del="${i}">${esc(L.remove)}</button>` : ''}</div>
      </fieldset>`;
    })
    .join('');
  const sugs = (state.athletes?.suggestions || []).filter((g) => !editor.done?.has(g.key));
  const he = state.ui === 'he';
  const nm = (g) => (he && g.name_he ? g.name_he : g.name);
  const tm = (g, k = 'team') => (he && g[k + '_he'] ? g[k + '_he'] : g[k]);
  const sugText = (g) =>
    g.type === 'returned' ? L.sugReturned(nm(g), tm(g)) : g.type === 'moved' ? L.sugMoved(nm(g), tm(g, 'from'), tm(g)) : L.sugNew(nm(g), tm(g));
  const sugAction = { returned: L.doRemove, moved: L.doUpdate, new: L.doAdd };
  const sugBlock = editor.editable
    ? `<div class="sug-box"><h4>${esc(L.sugTitle)}</h4>${
        sugs.length
          ? `<ul>${sugs.map((g, i) => `<li><span dir="auto">${esc(sugText(g))}</span><span class="sug-btns"><button type="button" class="small-btn primary" data-sug-apply="${i}">${esc(sugAction[g.type])}</button><button type="button" class="small-btn" data-sug-ignore="${i}">${esc(L.doIgnore)}</button></span></li>`).join('')}</ul>`
          : `<p class="muted">${esc(L.noSug)}</p>`
      }</div>`
    : '';
  editor.sugs = sugs;
  $('listBody').innerHTML = `
    <h3>✈️ ${esc(L.title)}</h3>
    ${editor.editable ? '' : `<p class="warn">${esc(L.readOnly)}</p>`}
    ${sugBlock}`;
  $('listBody').innerHTML += `
    <div class="ath-list">${rows}</div>
    ${msg ? `<p class="msg">${esc(msg)}</p>` : ''}
    <div class="dlg-actions">
      ${editor.editable ? `<button type="button" class="small-btn" id="addRow">${esc(L.add)}</button>` : ''}
      <span class="spacer"></span>
      <button type="button" class="small-btn" id="closeList">${esc(L.cancel)}</button>
      ${editor.editable ? `<button type="button" class="small-btn primary" id="saveList">${esc(L.save)}</button>` : ''}
    </div>`;
}

$('listBody').addEventListener('input', (e) => {
  const i = e.target.dataset.i, k = e.target.dataset.k;
  if (i === undefined) return;
  const v = e.target.value;
  editor.rows[i][k] = k === 'alt' || k === 'team_alt' ? v.split(',').map((x) => x.trim()).filter(Boolean) : v;
});
$('listBody').addEventListener('click', async (e) => {
  const L = t().list;
  if (e.target.dataset.del !== undefined) {
    editor.rows.splice(Number(e.target.dataset.del), 1);
    renderListEditor();
  } else if (e.target.id === 'addRow') {
    editor.rows.unshift({ name: '', name_he: '', team: '', team_he: '', country: 'england', sport: 'football', alt: [], team_alt: [] });
    renderListEditor();
    $('listBody').querySelector('input')?.focus();
  } else if (e.target.id === 'closeList') {
    $('listDialog').close();
  } else if (e.target.id === 'saveList') {
    e.target.disabled = true;
    await saveList();
  } else if (e.target.dataset.sugApply !== undefined) {
    const g = editor.sugs[Number(e.target.dataset.sugApply)];
    const same = (r) => [r.name, r.name_he, ...(r.alt || [])].some((n) => n && (n === g.name || n === g.name_he));
    if (g.type === 'returned') editor.rows = editor.rows.filter((r) => !same(r));
    if (g.type === 'moved') {
      const r = editor.rows.find(same);
      if (r) Object.assign(r, { team: g.team, team_he: g.team_he || '', team_alt: [], country: g.country !== 'other' ? g.country : r.country });
    }
    if (g.type === 'new') editor.rows.unshift({ name: g.name, name_he: g.name_he || '', team: g.team, team_he: g.team_he || '', country: g.country, sport: g.sport || 'football', alt: [], team_alt: [] });
    (editor.done ||= new Set()).add(g.key);
    await saveList();
  } else if (e.target.dataset.sugIgnore !== undefined) {
    const g = editor.sugs[Number(e.target.dataset.sugIgnore)];
    (editor.done ||= new Set()).add(g.key);
    renderListEditor();
    fetch('api/athletes/ignore', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key: g.key }) }).catch(() => {});
  }
});

async function saveList() {
  const L = t().list;
  renderListEditor(L.saving);
  try {
    const res = await fetch('api/athletes', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(editor.rows.filter((r) => r.name.trim())),
    });
    if (!res.ok) throw new Error();
    await loadAthletes();
    await load();
    editor.rows = state.athletes.athletes.map((a) => ({ ...a }));
    renderListEditor(L.saved);
    renderChrome();
    loadScores();
  } catch {
    renderListEditor(L.error);
  }
}

// ---------- events ----------
$('tabs').addEventListener('click', (e) => {
  const b = e.target.closest('[data-tab]');
  if (!b) return;
  state.tab = b.dataset.tab;
  state.athlete = null;
  state.tag = null;
  state.rival = null;
  store.set('tab', state.tab);
  renderChrome();
  renderList();
  $('tabs').querySelector(`[data-tab="${state.tab}"]`)?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
  window.scrollTo({ top: 0 });
});
$('langFilter').addEventListener('click', (e) => {
  const b = e.target.closest('[data-lf]');
  if (!b) return;
  state.langFilter = b.dataset.lf;
  store.set('langFilter', state.langFilter);
  renderChrome(); renderList(); renderJustIn();
});
$('mix').addEventListener('input', (e) => {
  state.mix = Number(e.target.value);
  store.set('mix', state.mix);
  renderList();
});
$('rivalBar').addEventListener('click', (e) => {
  const b = e.target.closest('[data-rival]');
  if (!b) return;
  state.rival = b.dataset.rival || null;
  renderChrome(); renderList();
});
$('athleteChips').addEventListener('click', (e) => {
  const b = e.target.closest('[data-ath]');
  if (!b) return;
  state.athlete = b.dataset.ath || null;
  renderChrome(); renderList();
});
$('teamSeg').addEventListener('click', (e) => {
  const b = e.target.closest('[data-team]');
  if (!b) return;
  state.teamNews = b.dataset.team === 'teams';
  store.set('teamNews', state.teamNews);
  renderChrome(); renderList();
});
$('editListBtn').addEventListener('click', openListEditor);
function recordOpen(e) {
  const a = e.target.closest('a[href]');
  const holder = a && e.target.closest('[data-id]');
  if (!holder || a.closest('.meta')) return; // the translate link etc. is not a read
  const s = state.data?.stories.find((x) => x.id === holder.dataset.id);
  if (s) Learn.record(s);
}
$('list').addEventListener('click', recordOpen);
$('list').addEventListener('click', (e) => {
  const av = e.target.closest('[data-av]');
  if (av) {
    state.abroadView = av.dataset.av;
    store.set('abroadView', state.abroadView);
    renderList();
    return;
  }
  const card = e.target.closest('.pcard, .pmini');
  if (!card || e.target.closest('a')) return;
  if (card.classList.contains('pcard')) {
    // from the players screen → that player's news
    state.athlete = card.dataset.ath;
    state.abroadView = 'news';
    store.set('abroadView', 'news');
    renderChrome();
    renderList();
    window.scrollTo({ top: 0 });
    return;
  }
  state.athlete = state.athlete === card.dataset.ath ? null : card.dataset.ath;
  renderChrome();
  renderList();
});
$('list').addEventListener('click', (e) => {
  const trBtn = e.target.closest('.tr-btn, .sum-btn');
  if (trBtn) {
    const box = trBtn.nextElementSibling;
    box.hidden = !box.hidden;
    trBtn.setAttribute('aria-expanded', String(!box.hidden));
    return;
  }
  const tag = e.target.closest('[data-tag]');
  if (tag) {
    state.tag = state.tag === tag.dataset.tag ? null : tag.dataset.tag; // click again to clear
    renderList();
    window.scrollTo({ top: 0 });
  }
});
$('list').addEventListener('click', (e) => {
  const btn = e.target.closest('.fix-btn');
  if (btn) {
    const menu = btn.closest('.card').querySelector('.fix-menu');
    menu.hidden = !menu.hidden;
    btn.setAttribute('aria-expanded', String(!menu.hidden));
    return;
  }
  const opt = e.target.closest('[data-fix]');
  if (!opt) return;
  const s = state.data?.stories.find((x) => x.id === opt.closest('.card').dataset.id);
  if (!s) return;
  const v = opt.dataset.fix;
  sendFix(s, v === 'hide' ? { hide: true } : v === 'il' ? { israel: true } : v === 'notIl' ? { israel: false } : { sport: v });
  state.data.stories = applyFixes(state.data.stories);
  toast(t().fix.thanks);
  renderChrome();
  renderList();
});
$('list').addEventListener('auxclick', recordOpen); // middle-click / open in new tab
$('justinPane').addEventListener('click', recordOpen);
$('list').addEventListener('click', async (e) => {
  if (e.target.id !== 'resetLearn' || !confirm(t().forYou.confirmReset)) return;
  await Learn.reset();
  renderList();
});
$('bellBtn').addEventListener('click', openNotifDialog);
$('langBtn').addEventListener('click', () => {
  state.ui = state.ui === 'he' ? 'en' : 'he';
  store.set('ui', state.ui);
  state.scores = null; // team names come in the UI language
  render();
  loadScores();
});
$('sideTabs').addEventListener('click', (e) => {
  const b = e.target.closest('[data-panel]');
  if (!b) return;
  state.panel = b.dataset.panel;
  store.set('panel', state.panel);
  renderChrome();
});
$('bottomNav').addEventListener('click', (e) => {
  const b = e.target.closest('[data-nav]');
  if (!b) return;
  const v = b.dataset.nav;
  if (v === 'news') state.view = 'news';
  else { state.view = 'panel'; state.panel = v; store.set('panel', v); }
  renderChrome();
  window.scrollTo({ top: 0 });
  if (v === 'scores') loadScores();
});
$('scoresPane').addEventListener('click', (e) => {
  const b = e.target.closest('[data-day]');
  if (!b) return;
  state.scoreDay = Number(b.dataset.day);
  state.scores = null;
  renderScores();
  loadScores();
});
let searchTimer;
$('search').addEventListener('input', (e) => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => { state.q = e.target.value; renderList(); }, 150);
});
$('newPill').addEventListener('click', () => {
  $('newPill').hidden = true;
  window.scrollTo({ top: 0, behavior: 'smooth' });
});
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    state.unread = 0;
    renderChrome();
    load();
  }
});

// ---------- start ----------
(async function start() {
  // keep the desktop side panel just under the sticky header
  const header = document.querySelector('.top');
  new ResizeObserver(() => document.documentElement.style.setProperty('--header-h', header.offsetHeight + 'px')).observe(header);
  render();
  await loadAthletes();
  await load({ initial: true });
  loadScores();
  setInterval(load, REFRESH_MS);
  setInterval(loadAthletes, 10 * 60 * 1000);
  Learn.sync().then(() => state.tab === 'foryou' && renderList());
  setInterval(() => Learn.sync(), 3 * 60 * 1000);
  setInterval(() => { renderStatus(); tickTimes(); }, 20 * 1000);
  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
})();
