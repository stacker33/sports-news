// Keyword-based tagging: sport, Israeli relevance, Israelis abroad, "breaking" signals.

const FOOTBALL = [
  // English
  'football', 'soccer', 'premier league', 'la liga', 'laliga', 'serie a', 'bundesliga', 'ligue 1', 'eredivisie',
  'champions league', 'europa league', 'conference league', 'fifa', 'uefa', 'world cup', 'euro 2028', 'fa cup',
  'carabao', 'mls', 'striker', 'midfielder', 'goalkeeper', 'winger', 'hat-trick',
  'arsenal', 'chelsea', 'liverpool', 'man city', 'man utd', 'manchester city', 'manchester united', 'tottenham',
  'newcastle', 'aston villa', 'everton', 'west ham', 'brighton', 'atletico',
  'juventus', 'inter milan', 'ac milan', 'napoli', 'roma', 'dortmund', 'psg', 'paris saint-germain',
  'ajax', 'benfica', 'porto', 'celtic', 'rangers', 'mbappe', 'mbappé', 'haaland', 'messi', 'ronaldo', 'salah',
  'guardiola', 'ancelotti', 'zidane', 'here we go',
  // Spanish / Italian / French / German
  'fútbol', 'futbol', 'calcio', 'fichaje', 'mercato', 'fußball', 'fussball', 'golazo', 'bundesliga',
  // Hebrew
  'כדורגל', 'הליגה הלאומית', 'פרמייר ליג', 'ליגת האלופות', 'הליגה האירופית', 'ליגת הקונפרנס',
  'לה ליגה', 'סרייה א', 'בונדסליגה', 'גביע המדינה', 'גביע הטוטו', 'מונדיאל', 'שוער', 'חלוץ',
  'פנדל', 'שער ', 'שערים', 'נבחרת', 'פגרת נבחרות', 'מוקדמות', 'ליגת האומות', 'ליברפול', 'ארסנל', "צ'לסי", "מנצ'סטר", 'טוטנהאם',
  'יובנטוס', "פ.ס.ז'", 'אינטר מילאן', 'מילאן', 'נאפולי', 'אמבפה', 'הולאנד', 'ליאו מסי', 'רונאלדו',
];

const BASKETBALL = [
  'basketball', 'nba', 'wnba', 'euroleague', 'eurocup', 'fiba', 'baloncesto', 'basket', 'acb',
  'lakers', 'celtics', 'warriors', 'knicks', 'trail blazers', 'blazers', 'bucks', 'nuggets', 'mavericks',
  'clippers', 'timberwolves', 'cavaliers', 'pelicans', 'grizzlies', 'raptors', '76ers', 'sixers', 'hornets',
  'pistons', 'rockets', 'san antonio spurs', 'pacers', 'hawks', 'bulls', 'wizards', 'miami heat', 'orlando magic',
  'sacramento kings', 'utah jazz', 'phoenix suns', 'oklahoma city thunder', 'brooklyn nets', 'zalgiris', 'lebron', 'curry', 'doncic', 'dončić', 'jokic', 'giannis',
  'wembanyama', 'point guard', 'rebounds', 'triple-double', 'three-pointer',
  // Hebrew
  'כדורסל', 'יורוליג', 'יורוקאפ', 'ווינר', 'אן.בי.איי', 'ליגת ווינר', 'ליגת העל בכדורסל', 'שלשה', 'שלשות', 'ריבאונד',
  'לייקרס', 'סלטיקס', 'ווריורס', 'ניקס', 'בלייזרס', 'פורטלנד', 'ז\'לגיריס', 'לברון', 'דונצ\'יץ\'', 'יוקיץ\'', 'יאניס', 'טריפל דאבל', 'פיינל פור', 'פלייאוף',
  " נק' ", ' נק` ', " ריב' ", ' ריב` ', " אס' ", ' אס` ','ריבאונדים', 'אסיסטים', 'פרקט', 'גארד', 'פורוורד', 'סנטר ',
];

const FOOTBALL_US = FOOTBALL.filter((k) => k !== 'football');

// Other sports: beat football/basketball when they dominate (e.g. American football mentions "football")
const OTHER = [
  'nfl', 'quarterback', 'touchdown', 'super bowl', 'college football', 'ncaaf', 'mlb', 'baseball', 'nhl', 'hockey',
  'cricket', 'golf', 'pga', 'ryder cup', 'presidents cup', 'grand final', 'rugby league', 'rhinos', 'test match', 'formula 1', 'formula one', ' f1 ', 'grand prix', 'motogp', 'ufc', 'boxing',
  'wimbledon', 'roland garros', 'atp', 'wta', 'tennis', 'rugby', 'cycling', 'tour de france', 'nascar', 'olympic',
  'handball', 'volleyball', 'futsal', 'water polo', 'כדוריד', 'כדורעף', 'פוטסל', 'כדורמים', 'כדורשת', 'טריאתלון', 'פאדל',
  'פוטבול', 'בייסבול', 'הוקי', 'אקרובטיקה', 'התעמלות', "ג'ודו", 'שחייה', 'טניס', 'פורמולה', 'אגרוף', 'גולף', 'רוגבי', 'אופניים', 'אולימפי',
  'מרתון', 'אתלטיקה', 'קפיצה במוט', 'שייט', 'גלישה', 'טאקוונדו', 'היאבקות', 'סקי', 'החלקה',
  // baseball (MLB) — teams whose names are also football/basketball clubs (Rangers, Giants…) are left out
  ' inning', 'home run', 'no-hit', 'pitcher', 'world series', ' alds', ' alcs', ' nlds', ' nlcs', 'wild card series', 'yankees', 'red sox',
  'dodgers', ' mets ', 'cubs', 'astros', 'phillies', 'padres', 'mariners', 'blue jays', 'orioles', 'brewers', 'white sox', 'diamondbacks',
  'guardians', 'royals', 'marlins', 'rockies', 'béisbol', 'beisebol',
  // American football (NFL) and ice hockey (NHL)
  'chiefs', 'cowboys', '49ers', 'patriots', 'packers', 'steelers', 'ravens', 'bengals', 'broncos', 'seahawks', 'buccaneers', 'commanders',
  'mahomes', 'football américain', 'football americain', 'american football', 'maple leafs', 'canadiens', 'bruins', 'oilers', 'penguins',
  'red wings', 'blackhawks', 'stanley cup', 'football-americain',
  // motor sport, tennis, golf, cycling, athletics
  'indycar', 'cup series', 'keselowski', 'verstappen', 'leclerc', 'piastri', 'fórmula 1', 'formel 1', 'formule 1', 'djokovic', 'đoković',
  'alcaraz', 'jannik sinner', 'zverev', 'medvedev', 'swiatek', 'świątek', 'sabalenka', 'gauff', 'grand slam', 'masters 1000', 'mcilroy',
  'scheffler', 'pogacar', 'pogačar', 'vingegaard', 'vollering', 'road race', 'peloton', 'giro d', 'vuelta', 'radsport', 'ciclismo',
  'duplantis', 'pole vault', 'triathlon', 'decathlon', 'heptathlon', 'sprinter', 'diamond league',
  'tenis', 'judo', 'gymnast', 'swimmer', 'swimming', 'world aquatics', 'skiing', 'biathlon', 'curling',
];

// Israeli context (clubs, national teams, leagues)
const ISRAEL = [
  'israel', 'israeli', 'maccabi', 'hapoel', 'beitar', 'bnei sakhnin', 'bnei yehuda', 'bnei herzliya',
  'ironi', 'ashdod', 'kiryat shmona', 'netanya', 'be\'er sheva', 'beersheba', 'beer sheva', 'petah tikva',
  'ישראל', 'ישראלי', 'ישראלית', 'מכבי', 'הפועל', 'בית"ר', 'ביתר', 'בני סכנין', 'בני יהודה', 'בני הרצליה',
  ' עירוני ', 'מ.ס. אשדוד', 'קריית שמונה', 'באר שבע', 'פתח תקווה', 'נבחרת ישראל', 'ליגת העל',
  'ליגת ווינר', 'הליגה הלאומית', 'גביע המדינה', 'גביע הטוטו', 'בן שמעון', 'אלישע לוי', 'ברק בכר',
  'עודד קטש', 'שרון דרוקר', 'יניב גרין',
];

// Israeli clubs/people that point to one sport (used only when a story names no sport)
const IL_BASKETBALL = [
  'ליגת ווינר', 'גביע ווינר', 'יורוליג', 'יורוקאפ', 'הפועל חולון', 'בני הרצליה', 'מכבי ראשון', 'הפועל גליל עליון',
  'עירוני נס ציונה', 'הפועל העמק', 'מכבי עיר נחל', 'אוברדוביץ', 'איטודיס', 'קטש', 'לורנזו בראון', 'לופטון',
  'בלאט', 'טוני פארקר', 'wbl', 'winner league', 'euroleague',
];
const IL_FOOTBALL = [
  'ליגת העל', 'הליגה הלאומית', 'גביע הטוטו', 'בית"ר', 'ביתר', 'מכבי חיפה', 'באר שבע', 'בני סכנין', 'מכבי נתניה',
  'מ.ס. אשדוד', 'הפועל חיפה', 'קריית שמונה', 'בני ריינה', 'הפועל חדרה', 'מכבי בני ריינה', 'בן שמעון',
  'ligat', 'beitar', 'maccabi haifa', 'beer-sheva', 'beersheba', 'sakhnin',
];

// Olympic / other Israeli sport (only relevant together with Israeli context)
const ISRAEL_OTHER = [
  'judo', 'gymnast', 'olympic', 'windsurf', 'sailing', 'swimm', 'marathon', 'athletics', 'tennis',
  'handball', 'volleyball', 'כדוריד', 'כדורעף', 'טריאתלון', 'פאדל',
  "ג'ודו", 'התעמלות', 'מתעמל', 'אקרובטיקה', 'טאקוונדו', 'שייט', 'אולימפי', 'אולימפיאדה', 'גלישה', 'שחיי', 'אתלטיקה', 'מרתון', 'טניס', 'אופניים',
];

// Big-story signals → score boost
const BREAKING = [
  'breaking', 'official', 'confirmed', 'here we go', 'signs', 'signed', 'sacked', 'fired', 'appointed',
  'resigns', 'injury', 'injured', 'ruptured', 'torn', 'suspended', 'banned', 'dies', 'died', 'arrested',
  'record', 'champions', 'wins title', 'relegated', 'guilty', 'charges', 'trade', 'traded', 'retire',
  'exclusive', 'final',
  'רשמי', 'דרמה', 'פוטר', 'פיטורי', 'חתם', 'יחתום', 'נפצע', 'פציעה', 'נפטר', 'שיא', 'אליפות', 'אלופה', 'אלוף',
  'ירדה ליגה', 'הורשעה', 'בלעדי', 'עסקה', 'טרייד', 'פורש', 'מתפטר', 'הודח', 'גמר',
  'oficial', 'ufficiale', 'officiel', 'offiziell', 'lesión', 'fichaje', 'última hora',
];

const lower = (s) => (s || '').toLowerCase();
const hits = (text, list) => list.reduce((n, k) => (text.includes(k) ? n + 1 : n), 0);

// Sport5 article folders (FolderID in the link) → section
const SPORT5_FOLDERS = {
  basketball: [405, 274, 409, 1420, 11840, 10842],
  football: [285, 64, 8573, 127, 394, 252, 401, 398, 378, 609, 1397, 4022, 1504, 10838, 11798],
  other: [413, 12176, 616, 11342, 7747, 4169, 11158],
  drop: [7186, 7207, 12341, 11160], // cars, lifestyle, travel
};
const FOLDER = new Map(Object.entries(SPORT5_FOLDERS).flatMap(([s, ids]) => ids.map((id) => [String(id), s])));

const SEG_FOOTBALL = /^(football|soccer|futbol|calcio|fussball|israeli-soccer|world-soccer|soccer-israel|soccer-international|israeli-football|world-football)$/;
const SEG_BASKETBALL = /^(basketball|nba|euroleague|baloncesto|basket|israeli-basketball|world-basketball|basketball-israel|basketball-international)$/;
const SEG_OTHER = /^(rugby[a-z-]*|cricket|golf|tennis|formula1|f1|motorsport|boxing|mma|athletics|cycling|nfl|mlb|nhl|american-football|horse-racing|snooker|darts|other|other-sports|olympics)$/;
const SEG_DROP = /^(cars?|auto|motors|lifestyle|food|travel|tech|real-estate|economy|business|politics)$/;

// Many sites put the sport in the URL path (/sport/rugby-league/…, /israeli-soccer/…, /nba/…) or a folder id
function sectionFromUrl(link) {
  let u;
  try {
    u = new URL(link);
  } catch {
    return null;
  }
  if (/sport5\.co\.il$/.test(u.hostname)) return FOLDER.get(u.searchParams.get('FolderID')) || null;
  // only section-like path segments (not long article slugs)
  const segs = u.pathname.toLowerCase().split('/').filter((s) => s && s.split('-').length <= 3);
  for (const s of segs) {
    if (/^(football-americain|football-us|american-football|us-sports)$/.test(s)) return 'other';
    if (SEG_FOOTBALL.test(s) || /^(football|soccer)-/.test(s)) return 'football';
    if (SEG_BASKETBALL.test(s)) return 'basketball';
    if (SEG_OTHER.test(s)) return 'other';
    if (SEG_DROP.test(s)) return 'drop';
  }
  return null;
}
const sportFromUrl = (link) => {
  const s = sectionFromUrl(link);
  return s === 'drop' ? null : s;
};

// ctx = { matchers: { players(text), teams(text) }, athleteSport: { name: sport } }
// places that share a club's name
const NOT_CLUBS = /beitar illit|ביתר עילית|בית"ר עילית|maccabi games|מכביה/g;

export function classify(item, source, ctx) {
  const text = (' ' + lower(`${item.title} ${item.summary}`) + ' ').replace(NOT_CLUBS, ' ');
  const titleText = (' ' + lower(item.title) + ' ').replace(NOT_CLUBS, ' ');

  const athletes = ctx.matchers.players(text);
  // Team tag: only when the team is actually named in the headline
  const teams = ctx.matchers.teams(titleText);
  const athleteSport = athletes.length ? ctx.athleteSport[athletes[0]] : null;

  // Priority: URL path > other-sport keywords > feed hint > football/basketball keywords
  const section = sectionFromUrl(item.link);
  let sport = sportFromUrl(item.link);
  // American sources: 'football' means American football (soccer needs soccer words)
  const FB = source.usa ? FOOTBALL_US : FOOTBALL;
  const f = hits(text, FB) + hits(titleText, FB); // title counts twice
  const b = hits(text, BASKETBALL) + hits(titleText, BASKETBALL);
  const o = hits(text, OTHER) + hits(titleText, OTHER) + (source.usa && titleText.includes('football') ? 2 : 0);
  if (!sport) {
    if (o > 0 && o >= Math.max(f, b)) sport = 'other';
    else if (source.sport) sport = source.sport;
    else if (athleteSport && f === 0 && b === 0) sport = athleteSport;
    else if (f === 0 && b === 0) sport = 'other';
    else sport = b > f ? 'basketball' : 'football';
  }

  // Israeli sport at home (clubs, leagues, national teams) — separate from Israelis abroad
  const israel = !!(source.israel || hits(text, ISRAEL) > 0);
  const israelOther = israel && sport === 'other' && hits(text, ISRAEL_OTHER) > 0;
  const ib = hits(text, IL_BASKETBALL);
  const ifb = hits(text, IL_FOOTBALL);

  // Mixed feeds (general news sites): drop items that don't look like sport at all
  // (decided before the fallback below, so e.g. a food article mentioning Israel isn't treated as football)
  const looksSport =
    section !== 'drop' && (sport !== 'other' || israelOther || ib + ifb > 0 || /\/(sport|sports|deportes|futbol|calcio|basket)/i.test(item.link || ''));

  // Israeli story without a sport word: decide by club/league names, default football
  if (israel && sport === 'other' && !israelOther && !sportFromUrl(item.link)) {
    sport = ib > ifb ? 'basketball' : 'football';
  }

  const breaking = hits(titleText, BREAKING);

  // evidence for the triage (src/triage.js decides the final sport)
  const ev = {
    url: section && section !== 'drop' ? section : null,
    section,
    source: source.sport || null,
    kw: { f, b, o },
    athleteSport,
    israel,
    israelOther,
    ib,
    ifb,
  };
  return { sport, israel, israelOther, athletes, teams, breaking, looksSport, ev };
}
