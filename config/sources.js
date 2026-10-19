import { ytFeed } from '../src/youtube.js';
// News sources. Edit freely: add/remove feeds, change weights.
// (Sources for Israelis abroad + their teams are generated automatically from config/athletes.json.)
//
// Fields:
//   id      unique key
//   name    display name (also used to count distinct sources per story)
//   url     RSS/Atom feed URL
//   lang    he | en | es | it | fr | de | ...
//   weight  reliability/importance, 1 (minor) .. 3 (top outlet)
//   sport   optional hint when the whole feed is one sport: football | basketball
//   israel  true when every item is about Israeli sport
//   mixed   true when the feed also carries non-sport news (keep only items that look like sport)
//   top     true for "top headlines" feeds: items get an importance boost
//   google  true for Google News feeds: the real publisher is read from each item
//   every   minutes between fetches (default: 1 for direct feeds, 3 for Google News)
//   tz      the feed writes local time but labels it GMT: reinterpret in this zone (e.g. Walla)
//   noDates the feed's dates are missing/wrong: use the time we first saw the article
//   parser  special reader for sites without RSS (e.g. 'sport5' reads the homepage)
//   reporter  a reporter's own channel or site (Telegram / Bluesky posts count by default; outlets' accounts: false)
//   official  a club / league / federation channel
//   country + assist  a national outlet: its local-only stories show only with a known team/player or an Israeli angle

// Google News locales: [hl, gl, ceid]
export const GN_LOCALES = {
  he: ['he', 'IL', 'IL:he'],
  en: ['en-US', 'US', 'US:en'],
  'en-GB': ['en-GB', 'GB', 'GB:en'],
  es: ['es', 'ES', 'ES:es'],
  it: ['it', 'IT', 'IT:it'],
  nl: ['nl', 'NL', 'NL:nl'],
  de: ['de', 'DE', 'DE:de'],
  fr: ['fr', 'FR', 'FR:fr'],
  pt: ['pt-PT', 'PT', 'PT:pt-150'],
  ro: ['ro', 'RO', 'RO:ro'],
  sr: ['sr', 'RS', 'RS:sr'],
  hu: ['hu', 'HU', 'HU:hu'],
  el: ['el', 'GR', 'GR:el'],
  tr: ['tr', 'TR', 'TR:tr'],
  pl: ['pl', 'PL', 'PL:pl'],
  ja: ['ja', 'JP', 'JP:ja'],
  'en-IE': ['en-IE', 'IE', 'IE:en'],
  'nl-BE': ['nl', 'BE', 'BE:nl'],
  'fr-BE': ['fr', 'BE', 'BE:fr'],
  'el-CY': ['el', 'CY', 'CY:el'],
  'pt-BR': ['pt-BR', 'BR', 'BR:pt-419'],
  'es-AR': ['es-419', 'AR', 'AR:es-419'],
  cs: ['cs', 'CZ', 'CZ:cs'],
  sk: ['sk', 'SK', 'SK:sk'],
  sl: ['sl', 'SI', 'SI:sl'],
  lt: ['lt', 'LT', 'LT:lt'],
  lv: ['lv', 'LV', 'LV:lv'],
  bg: ['bg', 'BG', 'BG:bg'],
  sv: ['sv', 'SE', 'SE:sv'],
  no: ['no', 'NO', 'NO:no'],
  uk: ['uk', 'UA', 'UA:uk'],
  da: ['da', 'DK', 'DK:da'],
  hr: ['hr', 'HR', 'HR:hr'],
  'ar-SA': ['ar', 'SA', 'SA:ar'],
  'es-UY': ['es-419', 'UY', 'UY:es-419'],
  'en-CA': ['en-CA', 'CA', 'CA:en'],
  'fr-CH': ['fr', 'CH', 'CH:fr'],
};

// Google News 'top sports headlines' of a country
export const gtop = (locale) => {
  const [hl, gl, ceid] = GN_LOCALES[locale];
  return `https://news.google.com/rss/headlines/section/topic/SPORTS?hl=${hl}&gl=${gl}&ceid=${ceid}`;
};

export const gnews = (q, locale = 'en') => {
  const [hl, gl, ceid] = GN_LOCALES[locale] || GN_LOCALES.en;
  return `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=${hl}&gl=${gl}&ceid=${ceid}`;
};

export const SOURCES = [
  // ---------- Israel (Hebrew) ----------
  { id: 'one', name: 'ONE', url: 'https://www.one.co.il/rss', lang: 'he', weight: 3 },
  { id: 'walla-sport', name: 'וואלה ספורט', url: 'https://rss.walla.co.il/feed/7', lang: 'he', weight: 3, tz: 'Asia/Jerusalem' },
  { id: 'walla-israel', name: 'וואלה ספורט', url: 'https://rss.walla.co.il/feed/156', lang: 'he', weight: 3, tz: 'Asia/Jerusalem' },
  { id: 'walla-basket', name: 'וואלה ספורט', url: 'https://rss.walla.co.il/feed/151', lang: 'he', weight: 3, tz: 'Asia/Jerusalem', sport: 'basketball' },
  { id: 'ynet-sport', name: 'ynet ספורט', url: 'https://www.ynet.co.il/Integration/StoryRss3.xml', lang: 'he', weight: 3 },
  { id: 'haaretz-sport', name: 'הארץ', url: 'https://www.haaretz.co.il/srv/sport', lang: 'he', weight: 2 },
  { id: 'maariv-sport', name: 'מעריב', url: 'https://www.maariv.co.il/rss/rssfeedssport', lang: 'he', weight: 2, noDates: true },
  { id: 'israelhayom-gn', name: 'ישראל היום', url: gnews('site:israelhayom.co.il/sport when:1d', 'he'), lang: 'he', weight: 2, google: true, every: 5 }, // the direct feed is blocked from GitHub's servers
  { id: 'sport5-home', name: 'ספורט 5', url: 'https://www.sport5.co.il/', lang: 'he', weight: 3, parser: 'sport5', noDates: true },
  { id: 'sport5', name: 'ספורט 5', url: gnews('site:sport5.co.il when:1d', 'he'), lang: 'he', weight: 3, google: true },
  { id: 'sport1', name: 'ספורט 1', url: 'https://sport1.maariv.co.il/wp-json/wp/v2/posts?per_page=50&_fields=id,date_gmt,link,title,excerpt', lang: 'he', weight: 3, parser: 'wordpress' },
  { id: 'kan-sport', name: 'כאן ספורט', url: gnews('site:kan.org.il ספורט when:1d', 'he'), lang: 'he', weight: 2, google: true, mixed: true },
  { id: 'gn-he-sports', name: 'Google News ספורט', url: 'https://news.google.com/rss/headlines/section/topic/SPORTS?hl=he&gl=IL&ceid=IL:he', lang: 'he', weight: 2, google: true, top: true },

  // ---------- Israel (English) ----------
  { id: 'jpost-sport', name: 'Jerusalem Post', url: 'https://www.jpost.com/rss/rssfeedssports.aspx', lang: 'en', weight: 2, israel: true },
  { id: 'gn-israel-clubs', name: 'Google News', url: gnews('("Maccabi Tel Aviv" OR "Maccabi Haifa" OR Hapoel OR Beitar OR "Israel national team") when:1d'), lang: 'en', weight: 1, google: true, israel: true, mixed: true, every: 5 },
  { id: 'gn-israel-olympic', name: 'Google News', url: gnews('Israeli (judo OR gymnastics OR gymnast OR Olympic OR swimmer OR sailing OR windsurfing OR marathon) when:2d'), lang: 'en', weight: 1, google: true, mixed: true, every: 10 },
  // Israeli clubs in the world press (Europe & beyond), in each country's language
  { id: 'il-world-en-GB', name: 'Google News', url: gnews("(\"Maccabi Tel Aviv\" OR \"Maccabi Haifa\" OR \"Hapoel Beer Sheva\" OR \"Hapoel Tel Aviv\" OR \"Hapoel Jerusalem\" OR \"Beitar Jerusalem\") when:1d", 'en-GB'), lang: 'en', weight: 1, google: true, israel: true, mixed: true, every: 10 },
  { id: 'il-world-es', name: 'Google News', url: gnews("(\"Maccabi Tel Aviv\" OR \"Maccabi Haifa\" OR \"Hapoel Beer Sheva\" OR \"Hapoel Tel Aviv\" OR \"Hapoel Jerusalem\" OR \"Beitar Jerusalem\") when:1d", 'es'), lang: 'es', weight: 1, google: true, israel: true, mixed: true, every: 10 },
  { id: 'il-world-it', name: 'Google News', url: gnews("(\"Maccabi Tel Aviv\" OR \"Maccabi Haifa\" OR \"Hapoel Beer Sheva\" OR \"Hapoel Tel Aviv\" OR \"Hapoel Jerusalem\" OR \"Beitar Jerusalem\") when:1d", 'it'), lang: 'it', weight: 1, google: true, israel: true, mixed: true, every: 10 },
  { id: 'il-world-de', name: 'Google News', url: gnews("(\"Maccabi Tel Aviv\" OR \"Maccabi Haifa\" OR \"Hapoel Beer Sheva\" OR \"Hapoel Tel Aviv\" OR \"Hapoel Jerusalem\" OR \"Beitar Jerusalem\") when:1d", 'de'), lang: 'de', weight: 1, google: true, israel: true, mixed: true, every: 10 },
  { id: 'il-world-fr', name: 'Google News', url: gnews("(\"Maccabi Tel Aviv\" OR \"Maccabi Haifa\" OR \"Hapoel Beer Sheva\" OR \"Hapoel Tel Aviv\" OR \"Hapoel Jerusalem\" OR \"Beitar Jerusalem\") when:1d", 'fr'), lang: 'fr', weight: 1, google: true, israel: true, mixed: true, every: 10 },
  { id: 'il-world-tr', name: 'Google News', url: gnews("(\"Maccabi Tel Aviv\" OR \"Maccabi Haifa\" OR \"Hapoel Beer Sheva\" OR \"Hapoel Tel Aviv\" OR \"Hapoel Jerusalem\" OR \"Beitar Jerusalem\" OR Makabi) when:1d", 'tr'), lang: 'tr', weight: 1, google: true, israel: true, mixed: true, every: 10 },
  { id: 'il-world-el', name: 'Google News', url: gnews("(Μακάμπι OR Χαποέλ OR Μπεϊτάρ OR \"Maccabi Tel Aviv\" OR \"Hapoel\") when:1d", 'el'), lang: 'el', weight: 1, google: true, israel: true, mixed: true, every: 10 },
  { id: 'il-world-sr', name: 'Google News', url: gnews("(Makabi OR Hapoel OR Макаби OR Хапоел) when:1d", 'sr'), lang: 'sr', weight: 1, google: true, israel: true, mixed: true, every: 10 },
  { id: 'il-world-pt', name: 'Google News', url: gnews("(\"Maccabi Tel Aviv\" OR \"Maccabi Haifa\" OR \"Hapoel Beer Sheva\" OR \"Hapoel Tel Aviv\" OR \"Hapoel Jerusalem\" OR \"Beitar Jerusalem\") when:1d", 'pt'), lang: 'pt', weight: 1, google: true, israel: true, mixed: true, every: 10 },
  { id: 'il-world-nl', name: 'Google News', url: gnews("(\"Maccabi Tel Aviv\" OR \"Maccabi Haifa\" OR \"Hapoel Beer Sheva\" OR \"Hapoel Tel Aviv\" OR \"Hapoel Jerusalem\" OR \"Beitar Jerusalem\") when:1d", 'nl'), lang: 'nl', weight: 1, google: true, israel: true, mixed: true, every: 10 },

  // ---------- World football (English) ----------
  { id: 'bbc-football', name: 'BBC Sport', url: 'https://feeds.bbci.co.uk/sport/football/rss.xml', lang: 'en', weight: 3, sport: 'football' },
  { id: 'bbc-sport', name: 'BBC Sport', url: 'https://feeds.bbci.co.uk/sport/rss.xml', lang: 'en', weight: 3 },
  { id: 'guardian-football', name: 'The Guardian', url: 'https://www.theguardian.com/football/rss', lang: 'en', weight: 3, sport: 'football' },
  { id: 'guardian-sport', name: 'The Guardian', url: 'https://www.theguardian.com/sport/rss', lang: 'en', weight: 3 },
  { id: 'sky-football', name: 'Sky Sports', url: 'https://www.skysports.com/rss/11095', lang: 'en', weight: 3, sport: 'football' },
  { id: 'sky-news', name: 'Sky Sports', url: 'https://www.skysports.com/rss/12040', lang: 'en', weight: 3 },
  { id: 'sky-transfers', name: 'Sky Sports', url: 'https://www.skysports.com/rss/12691', lang: 'en', weight: 3, sport: 'football' },
  { id: 'telegraph-football', name: 'The Telegraph', url: 'https://www.telegraph.co.uk/football/rss.xml', lang: 'en', weight: 3, sport: 'football' },
  { id: 'espn-epl', name: 'ESPN', url: 'https://site.api.espn.com/apis/site/v2/sports/soccer/eng.1/news?limit=50', lang: 'en', weight: 3, parser: 'espn', sport: 'football' },
  { id: 'espn-laliga', name: 'ESPN', url: 'https://site.api.espn.com/apis/site/v2/sports/soccer/esp.1/news?limit=50', lang: 'en', weight: 3, parser: 'espn', sport: 'football', every: 2 },
  { id: 'espn-seriea', name: 'ESPN', url: 'https://site.api.espn.com/apis/site/v2/sports/soccer/ita.1/news?limit=50', lang: 'en', weight: 3, parser: 'espn', sport: 'football', every: 3 },
  { id: 'espn-bundes', name: 'ESPN', url: 'https://site.api.espn.com/apis/site/v2/sports/soccer/ger.1/news?limit=50', lang: 'en', weight: 3, parser: 'espn', sport: 'football', every: 3 },
  { id: 'espn-ucl', name: 'ESPN', url: 'https://site.api.espn.com/apis/site/v2/sports/soccer/uefa.champions/news?limit=50', lang: 'en', weight: 3, parser: 'espn', sport: 'football', every: 2 },
  { id: 'espn-soccer', name: 'ESPN', url: 'https://site.api.espn.com/apis/site/v2/sports/soccer/all/news?limit=50', lang: 'en', weight: 3, parser: 'espn' },
  { id: 'espn-nba', name: 'ESPN', url: 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/news?limit=50', lang: 'en', weight: 3, parser: 'espn', sport: 'basketball' },
  { id: 'athletic', name: 'The Athletic', url: 'https://www.nytimes.com/athletic/rss/news/', lang: 'en', weight: 3, every: 3 },
  { id: 'espn-mls', name: 'ESPN', url: 'https://site.api.espn.com/apis/site/v2/sports/soccer/usa.1/news?limit=50', lang: 'en', weight: 2, parser: 'espn', sport: 'football', every: 5 },
  { id: 'independent-football', name: 'The Independent', url: 'https://www.independent.co.uk/sport/football/rss', lang: 'en', weight: 2, sport: 'football' },
  { id: 'standard-football', name: 'Evening Standard', url: 'https://www.standard.co.uk/sport/football/rss', lang: 'en', weight: 2, sport: 'football' },
  { id: 'mirror-football', name: 'Mirror', url: 'https://www.mirror.co.uk/sport/football/?service=rss', lang: 'en', weight: 1, sport: 'football' },
  { id: 'yahoo-soccer', name: 'Yahoo Sports', url: 'https://sports.yahoo.com/soccer/rss/', lang: 'en', weight: 2, sport: 'football' },
  { id: 'football-italia', name: 'Football Italia', url: 'https://football-italia.net/feed/', lang: 'en', weight: 1, sport: 'football' },
  { id: 'fourfourtwo', name: 'FourFourTwo', url: 'https://www.fourfourtwo.com/feeds.xml', lang: 'en', weight: 1, sport: 'football' },

  // ---------- ⚡ Reporters & outlets posting live (minutes, not hours) ----------
  { id: 'tg-romano', name: 'Fabrizio Romano', url: 'https://t.me/s/fabrizioromano', lang: 'en', weight: 3, parser: 'telegram', sport: 'football' },
  { id: 'tg-sport5', name: 'ספורט 5', url: 'https://t.me/s/sport5israel', lang: 'he', weight: 3, parser: 'telegram', reporter: false },
  { id: 'bs-shams', name: 'Shams Charania', url: 'https://public.api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed?actor=shamsbot.bsky.social&limit=30&filter=posts_no_replies', lang: 'en', weight: 3, parser: 'bluesky', sport: 'basketball' },
  { id: 'bs-ornstein', name: 'David Ornstein', url: 'https://public.api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed?actor=david-ornstein.bsky.social&limit=30&filter=posts_no_replies', lang: 'en', weight: 3, parser: 'bluesky', sport: 'football', every: 2 },
  { id: 'bs-jacobs', name: 'Ben Jacobs', url: 'https://public.api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed?actor=jacobsben.bsky.social&limit=30&filter=posts_no_replies', lang: 'en', weight: 2, parser: 'bluesky', sport: 'football', every: 2 },
  { id: 'bs-athletic', name: 'The Athletic', url: 'https://public.api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed?actor=theathleticfc.bsky.social&limit=30&filter=posts_no_replies', lang: 'en', weight: 3, parser: 'bluesky', sport: 'football', reporter: false },
  { id: 'dimarzio', name: 'Gianluca Di Marzio', url: 'https://gianlucadimarzio.com/rss', lang: 'it', weight: 3, sport: 'football', reporter: true, every: 2 },
  { id: 'relevo', name: 'Relevo', url: 'https://www.relevo.com/rss/', lang: 'es', weight: 2, reporter: true, every: 3 },
  { id: 'bs-bbcsport', name: 'BBC Sport', url: 'https://public.api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed?actor=bbcsport.xmirror.bot&limit=30&filter=posts_no_replies', lang: 'en', weight: 3, parser: 'bluesky', reporter: false },

  // ---------- World basketball (English) ----------
  { id: 'bbc-basket', name: 'BBC Sport', url: 'https://feeds.bbci.co.uk/sport/basketball/rss.xml', lang: 'en', weight: 3, sport: 'basketball' },
  { id: 'guardian-basket', name: 'The Guardian', url: 'https://www.theguardian.com/sport/basketball/rss', lang: 'en', weight: 3, sport: 'basketball' },
  { id: 'cbs-nba', name: 'CBS Sports', url: 'https://www.cbssports.com/rss/headlines/nba/', lang: 'en', weight: 2, sport: 'basketball' },
  { id: 'yahoo-nba', name: 'Yahoo Sports', url: 'https://sports.yahoo.com/nba/rss/', lang: 'en', weight: 2, sport: 'basketball' },
  { id: 'realgm', name: 'RealGM', url: 'https://basketball.realgm.com/rss/wiretap/0/0.xml', lang: 'en', weight: 2, sport: 'basketball' },
  { id: 'eurohoops', name: 'Eurohoops', url: 'https://www.eurohoops.net/en/feed/', lang: 'en', weight: 2, sport: 'basketball' },
  { id: 'hoopsrumors', name: 'Hoops Rumors', url: 'https://www.hoopsrumors.com/feed', lang: 'en', weight: 2, sport: 'basketball', every: 2 },
  { id: 'talkbasket', name: 'TalkBasket', url: 'https://www.talkbasket.net/feed', lang: 'en', weight: 1, sport: 'basketball', every: 2, max: 60 },
  { id: 'sportando', name: 'Sportando', url: 'https://www.sportando.basketball/en/feed/', lang: 'en', weight: 1, sport: 'basketball' },

  // ---------- Top sports headlines (Google News) ----------
  { id: 'gn-en-sports', name: 'Google News', url: 'https://news.google.com/rss/headlines/section/topic/SPORTS?hl=en-GB&gl=GB&ceid=GB:en', lang: 'en', weight: 2, google: true, top: true },
  { id: 'gn-us-sports', name: 'Google News', url: 'https://news.google.com/rss/headlines/section/topic/SPORTS?hl=en-US&gl=US&ceid=US:en', lang: 'en', weight: 2, google: true, top: true, usa: true },

  // ---------- Biggest sports stories in other countries (translated in the app) ----------
  { id: 'top-es', name: 'Google News', url: gtop('es'), lang: 'es', country: 'Spain', weight: 2, google: true, top: true, every: 5 },
  { id: 'top-it', name: 'Google News', url: gtop('it'), lang: 'it', country: 'Italy', weight: 2, google: true, top: true, every: 5 },
  { id: 'top-de', name: 'Google News', url: gtop('de'), lang: 'de', country: 'Germany', weight: 2, google: true, top: true, every: 5 },
  { id: 'top-fr', name: 'Google News', url: gtop('fr'), lang: 'fr', country: 'France', weight: 2, google: true, top: true, every: 5 },
  { id: 'top-pt', name: 'Google News', url: gtop('pt'), lang: 'pt', country: 'Portugal', weight: 2, google: true, top: true, every: 8 },
  { id: 'top-br', name: 'Google News', url: gtop('pt-BR'), lang: 'pt', country: 'Brazil', weight: 2, google: true, top: true, every: 8 },
  { id: 'top-ar', name: 'Google News', url: gtop('es-AR'), lang: 'es', country: 'Argentina', weight: 2, google: true, top: true, every: 8 },
  { id: 'top-tr', name: 'Google News', url: gtop('tr'), lang: 'tr', country: 'Turkey', weight: 2, google: true, top: true, every: 8 },
  { id: 'top-gr', name: 'Google News', url: gtop('el'), lang: 'el', country: 'Greece', weight: 2, google: true, top: true, every: 8 },
  { id: 'top-nl', name: 'Google News', url: gtop('nl'), lang: 'nl', country: 'Netherlands', weight: 2, google: true, top: true, every: 8 },
  { id: 'top-be', name: 'Google News', url: gtop('nl-BE'), lang: 'nl', country: 'Belgium', weight: 2, google: true, top: true, every: 8 },
  { id: 'top-be-fr', name: 'Google News', url: gtop('fr-BE'), lang: 'fr', country: 'Belgium', weight: 1, google: true, top: true, every: 10 },
  { id: 'top-cy', name: 'Google News', url: gtop('el-CY'), lang: 'el', country: 'Cyprus', weight: 1, google: true, top: true, every: 10 },

  // ---------- World (other languages, translated in the app) ----------
  { id: 'marca-laliga', name: 'Marca', url: 'https://e00-marca.uecdn.es/rss/futbol/primera-division.xml', lang: 'es', weight: 2, sport: 'football' },
  { id: 'marca-basket', name: 'Marca', url: 'https://e00-marca.uecdn.es/rss/baloncesto.xml', lang: 'es', weight: 2, sport: 'basketball' },
  { id: 'as', name: 'AS', url: 'https://feeds.as.com/mrss-s/pages/as/site/as.com/portada/', lang: 'es', weight: 2 },
  { id: 'mundodeportivo', name: 'Mundo Deportivo', url: 'https://www.mundodeportivo.com/rss/home.xml', lang: 'es', weight: 2 },
  { id: 'tuttosport', name: 'Tuttosport', url: 'https://www.tuttosport.com/rss/calcio', lang: 'it', weight: 2, sport: 'football' },
  { id: 'lequipe', name: "L'Équipe", url: 'https://dwh.lequipe.fr/api/edito/rss?path=/', lang: 'fr', weight: 2 },
  { id: 'rmc-football', name: 'RMC Sport', url: 'https://rmcsport.bfmtv.com/rss/football/', lang: 'fr', weight: 2, sport: 'football' },
  { id: 'kicker', name: 'kicker', url: 'https://newsfeed.kicker.de/news/aktuell', lang: 'de', weight: 2 },
  // YouTube: official channels only (free channel feeds; see src/youtube.js for what's kept)
  ...[
    ['sport5', 'ספורט 5', 'UCyXf5cz6E9IIL40aivg7tOw', 'he', { israel: true }],
    ['ifa', 'ההתאחדות לכדורגל', 'UC-5AVLhL2v04-lfbVzejRZQ', 'he', { israel: true, sport: 'football' }],
    ['winner', 'ליגת ווינר', 'UCNWMa_pdt1GIWH_zwbTldEQ', 'he', { israel: true, sport: 'basketball' }],
    ['mta-fc', 'מכבי תל אביב', 'UC-oWQqnf8B8a_TsmVi0mTUg', 'he', { israel: true, sport: 'football' }],
    ['mta-bc', 'מכבי תל אביב כדורסל', 'UCqxNoI856R_vgs7aQolQhlg', 'he', { israel: true, sport: 'basketball' }],
    ['haifa', 'מכבי חיפה', 'UCDZGX5VO_QP03nhbru4PsiA', 'he', { israel: true, sport: 'football' }],
    ['hbs', 'הפועל באר שבע', 'UCNm-8pzv9gl5N7ioPXfU8_A', 'he', { israel: true, sport: 'football' }],
    ['hta-fc', 'הפועל תל אביב', 'UCWUw3MyL0wErNjk54vBY8Lw', 'he', { israel: true, sport: 'football' }],
    ['hta-bc', 'הפועל תל אביב כדורסל', 'UC_NezmJH4nzURv6TSvOarEA', 'he', { israel: true, sport: 'basketball' }],
    ['euroleague', 'EuroLeague', 'UCGr3nR_XH9r6E5b09ZJAT9w', 'en', { sport: 'basketball' }],
    ['nba', 'NBA', 'UCWJ2lWNubArHWmf3FIHbfcQ', 'en', { sport: 'basketball' }],
    ['skynews', 'Sky Sports News', 'UCcw05gGzjLIs5dnxGkQHMvw', 'en', {}],
    ['blazers', 'Trail Blazers', 'UCXk66yyzXo7-2M1BMqLhltQ', 'en', { sport: 'basketball' }],
    ['nets', 'Brooklyn Nets', 'UCTenKHt0h3VjdMvRWP6Lbvw', 'en', { sport: 'basketball' }],
    ['palace', 'Crystal Palace', 'UCWB9N0012fG6bGyj486Qxmg', 'en', { sport: 'football' }],
    ['westham', 'West Ham United', 'UCCNOsmurvpEit9paBOzWtUg', 'en', { sport: 'football' }],
    ['saints', 'Southampton FC', 'UCxvXjfiIHQ2O6saVx_ZFqnw', 'en', { sport: 'football' }],
    ['ajax', 'AFC Ajax', 'UCGpf7WX7R1one-NwOvg_PbQ', 'en', { sport: 'football' }],
  ].map(([id, name, ch, lang, extra]) => ({ id: `yt-${id}`, name: `${name} · YouTube`, url: ytFeed(ch), lang, weight: 1, parser: 'youtube', assist: true, official: true, every: 5, ...extra })),

  // Israelis abroad: outlets that follow their clubs closely
  { id: 'netsdaily', name: 'NetsDaily', url: 'https://www.netsdaily.com/rss/index.xml', lang: 'en', weight: 1, sport: 'basketball', every: 3 },
  { id: 'blazersedge', name: "Blazer's Edge", url: 'https://www.blazersedge.com/rss/index.xml', lang: 'en', weight: 1, sport: 'basketball', every: 3 },
  { id: 'dailyecho-saints', name: 'Daily Echo', url: 'https://www.dailyecho.co.uk/sport/saints/rss/', lang: 'en', weight: 1, sport: 'football', every: 3 },
  { id: 'zurnal', name: 'Sportski žurnal', url: 'https://www.zurnal.rs/rss', lang: 'sr', country: 'Serbia', weight: 1, assist: true, every: 3 },
  { id: 'nortecastilla', name: 'El Norte de Castilla', url: 'https://www.elnortedecastilla.es/rss/2.0/portada', lang: 'es', country: 'Spain', weight: 1, mixed: true, assist: true, every: 5 },
  { id: 'informacion', name: 'Información', url: 'https://www.informacion.es/rss/', lang: 'es', country: 'Spain', weight: 1, mixed: true, assist: true, noDates: true, every: 5 },

  // Direct national outlets: minutes instead of Google's hours. "assist" = local stories show only when they
  // involve a known team/player, something Israeli, or join a story other outlets carry (no local clutter).
  { id: 'cds', name: 'Corriere dello Sport', url: 'https://www.corrieredellosport.it/rss/calcio', lang: 'it', country: 'Italy', weight: 2, sport: 'football', assist: true, every: 2 },
  { id: 'abola', name: 'A Bola', url: 'https://www.abola.pt/rss-articles.xml', lang: 'pt', country: 'Portugal', weight: 2, assist: true, every: 3, max: 60 },
  { id: 'record', name: 'Record', url: 'https://www.record.pt/rss', lang: 'pt', country: 'Portugal', weight: 2, assist: true, every: 3 },
  { id: 'ge-globo', name: 'ge', url: 'https://ge.globo.com/rss/ge/', lang: 'pt', country: 'Brazil', weight: 2, assist: true, every: 3, max: 60 },
  { id: 'ole', name: 'Olé', url: 'https://www.ole.com.ar/rss/ultimas-noticias/', lang: 'es', country: 'Argentina', weight: 2, assist: true, every: 3 },
  { id: 'fotomac', name: 'Fotomaç', url: 'https://www.fotomac.com.tr/rss/anasayfa.xml', lang: 'tr', country: 'Turkey', weight: 2, assist: true, every: 3 },
  { id: 'novasports', name: 'Novasports', url: 'https://www.novasports.gr/rss', lang: 'el', country: 'Greece', weight: 2, assist: true, every: 3 },
  { id: 'vi-nl', name: 'Voetbal International', url: 'https://www.vi.nl/rss', lang: 'nl', country: 'Netherlands', weight: 2, sport: 'football', assist: true, every: 3 },
  { id: 'nu-voetbal', name: 'NU.nl', url: 'https://www.nu.nl/rss/Voetbal', lang: 'nl', country: 'Netherlands', weight: 1, sport: 'football', assist: true, every: 3 },
  // Portugal, Netherlands, Belgium
  { id: 'maisfutebol', name: 'Maisfutebol', url: 'https://maisfutebol.iol.pt/rss.xml', lang: 'pt', country: 'Portugal', weight: 2, sport: 'football', assist: true, every: 3 },
  { id: 'zerozero', name: 'zerozero', url: 'https://www.zerozero.pt/rss/noticias.php', lang: 'pt', country: 'Portugal', weight: 1, sport: 'football', assist: true, every: 4, max: 50 },
  { id: 'voetbalprimeur', name: 'VoetbalPrimeur', url: 'https://www.voetbalprimeur.nl/rss/nieuws.xml', lang: 'nl', country: 'Netherlands', weight: 1, sport: 'football', assist: true, every: 3 },
  { id: 'ad-sport', name: 'AD', url: 'https://www.ad.nl/sport/rss.xml', lang: 'nl', country: 'Netherlands', weight: 2, assist: true, every: 3 },
  { id: 'sporza', name: 'Sporza', url: 'https://sporza.be/nl.rss.xml', lang: 'nl', country: 'Belgium', weight: 2, assist: true, every: 3 },
  { id: 'hln-sport', name: 'HLN', url: 'https://www.hln.be/sport/rss.xml', lang: 'nl', country: 'Belgium', weight: 2, assist: true, every: 3 },
  { id: 'dhnet', name: 'La DH', url: 'https://www.dhnet.be/rss/section/sports.xml', lang: 'fr', country: 'Belgium', weight: 2, assist: true, every: 3, max: 60 },
  { id: 'voetbalkrant', name: 'Voetbalkrant', url: 'https://www.voetbalkrant.com/nl/rss', lang: 'nl', country: 'Belgium', weight: 1, sport: 'football', assist: true, every: 5, max: 60 },
  { id: 'walfoot', name: 'Walfoot', url: 'https://www.walfoot.be/rss', lang: 'fr', country: 'Belgium', weight: 1, sport: 'football', assist: true, every: 5, max: 60 },
  // Turkey, Greece, Cyprus, Serbia
  { id: 'aspor', name: 'A Spor', url: 'https://www.aspor.com.tr/rss/anasayfa.xml', lang: 'tr', country: 'Turkey', weight: 2, assist: true, every: 3, max: 60 },
  { id: 'athletiko', name: 'Athletiko', url: 'https://www.athletiko.gr/feed', lang: 'el', country: 'Greece', weight: 1, assist: true, every: 3 },
  { id: 'sportal-gr', name: 'Sportal', url: 'https://www.sportal.gr/feed', lang: 'el', country: 'Greece', weight: 1, assist: true, every: 3 },
  { id: 'to10', name: 'to10', url: 'https://www.to10.gr/feed/', lang: 'el', country: 'Greece', weight: 1, assist: true, every: 5 },
  { id: 'eurohoops-gr', name: 'Eurohoops', url: 'https://www.eurohoops.net/el/feed/', lang: 'el', country: 'Greece', weight: 2, sport: 'basketball', assist: true, every: 3 },
  { id: 'cyprusmail-sport', name: 'Cyprus Mail', url: 'https://cyprus-mail.com/category/sport/feed/', lang: 'en', country: 'Cyprus', weight: 1, assist: true, every: 5 },
  { id: 'sportklub', name: 'Sport Klub', url: 'https://sportklub.n1info.rs/feed/', lang: 'sr', country: 'Serbia', weight: 2, assist: true, every: 3 },
  { id: 'novosti-sport', name: 'Novosti', url: 'https://www.novosti.rs/rss/sport', lang: 'sr', country: 'Serbia', weight: 1, assist: true, every: 5, max: 60 },
  { id: 'sportske', name: 'Sportske', url: 'https://www.sportske.net/rss', lang: 'sr', country: 'Serbia', weight: 1, assist: true, every: 5 },
  { id: 'gsp', name: 'Gazeta Sporturilor', url: 'https://www.gsp.ro/rss.xml', lang: 'ro', country: 'Romania', weight: 1, assist: true, every: 5, max: 40 },

  // ---------- Round 5 (2026-10-11): the big leagues, transfers, NBA / European basketball, Japan ----------
  // Feeds checked live before adding (fresh items, HTTP 200). Sites whose feeds are blocked or stale are read
  // through Google News by site (as with Israel Hayom). Basketnews, the EuroLeague site, MLSsoccer and NBA.com
  // are not in Google News and have no working feed.
  { id: 'tmw', name: 'TuttoMercatoWeb', url: 'https://www.tuttomercatoweb.com/rss/', lang: 'it', country: 'Italy', weight: 2, sport: 'football', every: 2 },
  { id: 'gazzetta-gn', name: 'La Gazzetta dello Sport', url: gnews('site:gazzetta.it when:1d', 'it'), lang: 'it', country: 'Italy', weight: 3, google: true, every: 3 },
  { id: 'skysport-it-gn', name: 'Sky Sport', url: gnews('site:sport.sky.it when:1d', 'it'), lang: 'it', country: 'Italy', weight: 2, google: true, every: 4 },
  { id: 'sport-es-gn', name: 'Sport', url: gnews('site:sport.es when:1d', 'es'), lang: 'es', country: 'Spain', weight: 2, google: true, every: 3 },
  { id: 'gigantes', name: 'Gigantes del Basket', url: 'https://www.gigantes.com/feed/', lang: 'es', country: 'Spain', weight: 1, sport: 'basketball', every: 3 },
  { id: 'footmercato', name: 'Foot Mercato', url: 'https://www.footmercato.net/flux-rss', lang: 'fr', country: 'France', weight: 2, sport: 'football', every: 2 },
  { id: 'lequipe-basket', name: "L'Équipe", url: 'https://dwh.lequipe.fr/api/edito/rss?path=/Basket/', lang: 'fr', country: 'France', weight: 2, sport: 'basketball', every: 3 },
  { id: 'sofoot-gn', name: 'So Foot', url: gnews('site:sofoot.com when:1d', 'fr'), lang: 'fr', country: 'France', weight: 1, google: true, every: 5 },
  { id: 'sportschau', name: 'Sportschau', url: 'https://www.sportschau.de/fussball/index~rss2.xml', lang: 'de', country: 'Germany', weight: 2, sport: 'football', every: 3 },
  { id: 'transfermarkt-de', name: 'Transfermarkt', url: 'https://www.transfermarkt.de/rss/news', lang: 'de', country: 'Germany', weight: 1, sport: 'football', every: 3 },
  { id: 'bild-gn', name: 'Bild', url: gnews('site:bild.de/sport when:1d', 'de'), lang: 'de', country: 'Germany', weight: 2, google: true, every: 4 },
  { id: 'sport1-de-gn', name: 'Sport1', url: gnews('site:sport1.de when:1d', 'de'), lang: 'de', country: 'Germany', weight: 1, google: true, every: 5 },
  { id: 'dailymail-football', name: 'Daily Mail', url: 'https://www.dailymail.co.uk/sport/football/index.rss', lang: 'en', weight: 2, sport: 'football', every: 2, max: 60 },
  { id: 'football-london', name: 'football.london', url: 'https://www.football.london/?service=rss', lang: 'en', weight: 1, sport: 'football', every: 3 },
  { id: 'transfermarkt-en', name: 'Transfermarkt', url: 'https://www.transfermarkt.com/rss/news', lang: 'en', weight: 1, sport: 'football', every: 3 },
  { id: 'athletic-nba', name: 'The Athletic', url: 'https://www.nytimes.com/athletic/rss/nba/', lang: 'en', weight: 3, sport: 'basketball', every: 3 },
  { id: 'clutchpoints-nba', name: 'ClutchPoints', url: 'https://clutchpoints.com/nba/feed', lang: 'en', weight: 1, sport: 'basketball', every: 3 },
  // Japan (Neta Lavi): only stories with a known player / team / Israeli angle are kept (assist); no country, so the language marks them local
  { id: 'gekisaka', name: 'ゲキサカ', url: 'https://web.gekisaka.jp/feed', lang: 'ja', weight: 1, sport: 'football', assist: true, every: 5 },
  { id: 'soccer-king', name: 'サッカーキング', url: 'https://www.soccer-king.jp/feed', lang: 'ja', weight: 1, sport: 'football', assist: true, every: 5 },
  // ---------- Round 6 (2026-10-14): the desk's list of foreign sites ----------
  // Direct feeds where they work; Google News for the site where the feed is blocked or missing. Local-market sites
  // are "assist": only their stories that name a known club / player or have an Israeli angle get in.
  // Romania · Serbia · Bulgaria · Croatia
  { id: 'digisport-ro', name: 'Digi Sport', url: 'https://www.digisport.ro/rss', lang: 'ro', country: 'Romania', weight: 2, assist: true, every: 3 },
  { id: 'informer-rs', name: 'Informer', url: 'https://informer.rs/rss/sport', lang: 'sr', country: 'Serbia', weight: 1, assist: true, every: 3 },
  { id: 'mondo-rs', name: 'Mondo', url: 'https://mondo.rs/rss/644/Sport', lang: 'sr', country: 'Serbia', weight: 1, assist: true, every: 3 },
  { id: 'telegraf-rs', name: 'Telegraf', url: 'https://www.telegraf.rs/rss/sport', lang: 'sr', country: 'Serbia', weight: 1, assist: true, every: 3 },
  { id: 'kurir-rs', name: 'Kurir', url: 'https://www.kurir.rs/rss/sport', lang: 'sr', country: 'Serbia', weight: 1, assist: true, every: 3 },
  { id: 'sportal-bg', name: 'Sportal.bg', url: 'https://sportal.bg/rss', lang: 'bg', country: 'Bulgaria', weight: 1, assist: true, every: 3 },
  { id: 'vecernji-hr', name: 'Večernji list', url: 'https://www.vecernji.hr/feeds/section/sport', lang: 'hr', country: 'Croatia', weight: 1, assist: true, every: 3 },
  { id: '24sata-hr', name: '24sata', url: 'https://www.24sata.hr/feeds/sport.xml', lang: 'hr', country: 'Croatia', weight: 1, assist: true, every: 3 },
  // Greece
  { id: 'pickandroll-gr', name: 'Pick and Roll', url: 'https://www.pickandroll.gr/feed/', lang: 'el', country: 'Greece', weight: 2, sport: 'basketball', assist: true, every: 3 },
  { id: 'sdna-gn', name: 'SDNA', url: gnews('site:sdna.gr when:1d', 'el'), lang: 'el', country: 'Greece', weight: 1, google: true, assist: true, every: 5 },
  { id: 'gazzetta-gr-gn', name: 'Gazzetta.gr', url: gnews('site:gazzetta.gr when:1d', 'el'), lang: 'el', country: 'Greece', weight: 2, google: true, assist: true, every: 5 },
  { id: 'sport24-gr-gn', name: 'Sport24', url: gnews('site:sport24.gr when:1d', 'el'), lang: 'el', country: 'Greece', weight: 2, google: true, assist: true, every: 5 },
  { id: 'sportdog-gn', name: 'Sportdog', url: gnews('site:sportdog.gr when:1d', 'el'), lang: 'el', country: 'Greece', weight: 1, google: true, assist: true, every: 5 },
  // Turkey · Czechia · Poland · Sweden · Denmark
  { id: 'sabah-spor', name: 'Sabah Spor', url: 'https://www.sabah.com.tr/rss/spor.xml', lang: 'tr', country: 'Turkey', weight: 1, assist: true, every: 3 },
  { id: 'fanatik-gn', name: 'Fanatik', url: gnews('site:fanatik.com.tr when:1d', 'tr'), lang: 'tr', country: 'Turkey', weight: 2, google: true, assist: true, every: 5 },
  { id: 'denik-gn', name: 'Deník', url: gnews('site:denik.cz sport when:1d', 'cs'), lang: 'cs', country: 'Czechia', weight: 1, google: true, assist: true, mixed: true, every: 8 },
  { id: 'przeglad', name: 'Przegląd Sportowy', url: 'https://przegladsportowy.onet.pl/.feed', lang: 'pl', country: 'Poland', weight: 2, assist: true, every: 3 },
  { id: 'meczyki-gn', name: 'Meczyki', url: gnews('site:meczyki.pl when:1d', 'pl'), lang: 'pl', country: 'Poland', weight: 1, google: true, assist: true, every: 5 },
  { id: 'expressen-sport', name: 'Expressen', url: 'https://feeds.expressen.se/sport/', lang: 'sv', country: 'Sweden', weight: 1, assist: true, every: 3 },
  { id: 'tipsbladet-gn', name: 'Tipsbladet', url: gnews('tipsbladet when:1d', 'da'), lang: 'da', country: 'Denmark', weight: 1, google: true, assist: true, every: 8 },
  // Netherlands · Belgium · Switzerland
  { id: 'telegraaf', name: 'De Telegraaf', url: 'https://www.telegraaf.nl/rss', lang: 'nl', country: 'Netherlands', weight: 2, assist: true, mixed: true, every: 3 },
  { id: 'nieuwsblad', name: 'Het Nieuwsblad', url: 'https://www.nieuwsblad.be/rss', lang: 'nl', country: 'Belgium', weight: 1, assist: true, mixed: true, every: 3 },
  { id: 'blick-sport', name: 'Blick', url: 'https://www.blick.ch/sport/rss.xml', lang: 'de', country: 'Switzerland', weight: 1, assist: true, every: 3 },
  { id: 'rts-gn', name: 'RTS Sport', url: gnews('site:rts.ch/sport when:1d', 'fr-CH'), lang: 'fr', country: 'Switzerland', weight: 1, google: true, assist: true, every: 8 },
  // USA · Canada · Australia (English)
  { id: 'si-soccer-gn', name: 'Sports Illustrated', url: gnews('site:si.com/soccer when:1d'), lang: 'en', weight: 2, google: true, sport: 'football', every: 5 },
  { id: 'espn-soccer-gn', name: 'ESPN', url: gnews('site:espn.com/soccer when:1d'), lang: 'en', weight: 2, google: true, sport: 'football', every: 5 },
  { id: 'tsn-gn', name: 'TSN', url: gnews('site:tsn.ca when:1d', 'en-CA'), lang: 'en', country: 'Canada', weight: 1, google: true, assist: true, every: 8 },
  { id: 'globeandmail-sport', name: 'The Globe and Mail', url: 'https://www.theglobeandmail.com/arc/outboundfeeds/rss/category/sports/', lang: 'en', country: 'Canada', weight: 1, assist: true, every: 5 },
  { id: 'abc-au-sport', name: 'ABC Sport', url: 'https://www.abc.net.au/news/feed/45924/rss.xml', lang: 'en', country: 'Australia', weight: 1, assist: true, every: 5 },
  { id: 'foxsports-au', name: 'Fox Sports Australia', url: 'https://www.foxsports.com.au/content-feeds/football/', lang: 'en', country: 'Australia', weight: 1, sport: 'football', assist: true, every: 5 },
  // Argentina · Brazil · Uruguay · Costa Rica (Spanish / Portuguese)
  { id: 'clarin-dep', name: 'Clarín', url: 'https://www.clarin.com/rss/deportes/', lang: 'es', country: 'Argentina', weight: 2, assist: true, every: 3 },
  { id: 'tyc-gn', name: 'TyC Sports', url: gnews('site:tycsports.com when:1d', 'es-AR'), lang: 'es', country: 'Argentina', weight: 2, google: true, assist: true, every: 5 },
  { id: 'lance-gn', name: 'Lance!', url: gnews('site:lance.com.br when:1d', 'pt-BR'), lang: 'pt', country: 'Brazil', weight: 1, google: true, assist: true, every: 5 },
  { id: 'ovacion-gn', name: 'Ovación (El País Uruguay)', url: gnews('site:elpais.com.uy/ovacion when:1d', 'es-UY'), lang: 'es', country: 'Uruguay', weight: 1, google: true, assist: true, every: 8 },
  { id: 'referi-gn', name: 'Referí (El Observador)', url: gnews('site:elobservador.com.uy deportes when:1d', 'es-UY'), lang: 'es', country: 'Uruguay', weight: 1, google: true, assist: true, mixed: true, every: 8 },
  { id: 'nacion-cr', name: 'La Nación (Costa Rica)', url: 'https://www.nacion.com/arc/outboundfeeds/rss/category/puro-deporte/?outputType=xml', lang: 'es', country: 'Costa Rica', weight: 1, assist: true, every: 5 },
  { id: 'lateja-cr', name: 'La Teja', url: 'https://www.lateja.cr/arc/outboundfeeds/rss/category/deportes/?outputType=xml', lang: 'es', country: 'Costa Rica', weight: 1, assist: true, every: 5 },
  // Cyprus (2026-10-19, from the desk)
  { id: 'protathlima-cy', name: 'Protathlima (Cyprus Times)', url: 'https://protathlima.cyprustimes.com/feed/', lang: 'el', country: 'Cyprus', weight: 1, assist: true, every: 3 },
  { id: 'alphanews-cy', name: 'Alphanews', url: 'https://www.alphanews.live/category/sports/feed/', lang: 'el', country: 'Cyprus', weight: 1, assist: true, every: 3 },
  { id: '24sports-gn', name: '24sports', url: gnews('site:24sports.com.cy when:1d', 'el-CY'), lang: 'el', country: 'Cyprus', weight: 1, google: true, assist: true, mixed: true, every: 5 }, // no feed of its own
  // Saudi Arabia · Ghana · Japan
  { id: 'aljazirah-gn', name: 'Al Jazirah', url: gnews('site:al-jazirah.com when:1d', 'ar-SA'), lang: 'ar', country: 'Saudi Arabia', weight: 1, google: true, assist: true, mixed: true, every: 8 },
  { id: 'ghanaweb', name: 'GhanaWeb', url: 'https://cdn.ghanaweb.com/feed/newsfeed.xml', lang: 'en', country: 'Ghana', weight: 1, assist: true, mixed: true, every: 5 },
  { id: 'ghanasoccernet', name: 'Ghanasoccernet', url: 'https://ghanasoccernet.com/feed', lang: 'en', country: 'Ghana', weight: 1, sport: 'football', assist: true, every: 5 },
  { id: 'nikkansports', name: 'Nikkan Sports', url: 'https://www.nikkansports.com/soccer/atom.xml', lang: 'ja', weight: 1, sport: 'football', assist: true, every: 5 },
  { id: 'yahoo-jp-sports', name: 'Yahoo! Japan Sports', url: 'https://news.yahoo.co.jp/rss/categories/sports.xml', lang: 'ja', weight: 1, assist: true, every: 5 },
];
