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
  { id: 'israelhayom', name: 'ישראל היום', url: 'https://www.israelhayom.co.il/rss.xml', lang: 'he', weight: 2, mixed: true },
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
  { id: 'athletic', name: 'The Athletic', url: gnews('site:nytimes.com/athletic (football OR soccer OR NBA) when:1d'), lang: 'en', weight: 3, google: true, every: 5 },
  { id: 'independent-football', name: 'The Independent', url: 'https://www.independent.co.uk/sport/football/rss', lang: 'en', weight: 2, sport: 'football' },
  { id: 'standard-football', name: 'Evening Standard', url: 'https://www.standard.co.uk/sport/football/rss', lang: 'en', weight: 2, sport: 'football' },
  { id: 'mirror-football', name: 'Mirror', url: 'https://www.mirror.co.uk/sport/football/?service=rss', lang: 'en', weight: 1, sport: 'football' },
  { id: 'yahoo-soccer', name: 'Yahoo Sports', url: 'https://sports.yahoo.com/soccer/rss/', lang: 'en', weight: 2, sport: 'football' },
  { id: 'football-italia', name: 'Football Italia', url: 'https://football-italia.net/feed/', lang: 'en', weight: 1, sport: 'football' },
  { id: 'fourfourtwo', name: 'FourFourTwo', url: 'https://www.fourfourtwo.com/feeds.xml', lang: 'en', weight: 1, sport: 'football' },
  { id: 'transfermarkt', name: 'Transfermarkt', url: 'https://www.transfermarkt.com/rss/news', lang: 'en', weight: 1, sport: 'football' },

  // ---------- ⚡ Reporters & outlets posting live (minutes, not hours) ----------
  { id: 'tg-romano', name: 'Fabrizio Romano', url: 'https://t.me/s/fabrizioromano', lang: 'en', weight: 3, parser: 'telegram', sport: 'football' },
  { id: 'bs-shams', name: 'Shams Charania', url: 'https://public.api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed?actor=shamsbot.bsky.social&limit=30&filter=posts_no_replies', lang: 'en', weight: 3, parser: 'bluesky', sport: 'basketball' },
  { id: 'bs-ornstein', name: 'David Ornstein', url: 'https://public.api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed?actor=david-ornstein.bsky.social&limit=30&filter=posts_no_replies', lang: 'en', weight: 3, parser: 'bluesky', sport: 'football', every: 2 },
  { id: 'bs-jacobs', name: 'Ben Jacobs', url: 'https://public.api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed?actor=jacobsben.bsky.social&limit=30&filter=posts_no_replies', lang: 'en', weight: 2, parser: 'bluesky', sport: 'football', every: 2 },
  { id: 'bs-athletic', name: 'The Athletic', url: 'https://public.api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed?actor=theathleticfc.bsky.social&limit=30&filter=posts_no_replies', lang: 'en', weight: 3, parser: 'bluesky', sport: 'football' },
  { id: 'bs-bbcsport', name: 'BBC Sport', url: 'https://public.api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed?actor=bbcsport.xmirror.bot&limit=30&filter=posts_no_replies', lang: 'en', weight: 3, parser: 'bluesky' },

  // ---------- World basketball (English) ----------
  { id: 'bbc-basket', name: 'BBC Sport', url: 'https://feeds.bbci.co.uk/sport/basketball/rss.xml', lang: 'en', weight: 3, sport: 'basketball' },
  { id: 'guardian-basket', name: 'The Guardian', url: 'https://www.theguardian.com/sport/basketball/rss', lang: 'en', weight: 3, sport: 'basketball' },
  { id: 'cbs-nba', name: 'CBS Sports', url: 'https://www.cbssports.com/rss/headlines/nba/', lang: 'en', weight: 2, sport: 'basketball' },
  { id: 'yahoo-nba', name: 'Yahoo Sports', url: 'https://sports.yahoo.com/nba/rss/', lang: 'en', weight: 2, sport: 'basketball' },
  { id: 'realgm', name: 'RealGM', url: 'https://basketball.realgm.com/rss/wiretap/0/0.xml', lang: 'en', weight: 2, sport: 'basketball' },
  { id: 'eurohoops', name: 'Eurohoops', url: 'https://www.eurohoops.net/en/feed/', lang: 'en', weight: 2, sport: 'basketball' },
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

  // ---------- World (other languages, translated in the app) ----------
  { id: 'marca-laliga', name: 'Marca', url: 'https://e00-marca.uecdn.es/rss/futbol/primera-division.xml', lang: 'es', weight: 2, sport: 'football' },
  { id: 'marca-basket', name: 'Marca', url: 'https://e00-marca.uecdn.es/rss/baloncesto.xml', lang: 'es', weight: 2, sport: 'basketball' },
  { id: 'as', name: 'AS', url: 'https://feeds.as.com/mrss-s/pages/as/site/as.com/portada/', lang: 'es', weight: 2 },
  { id: 'mundodeportivo', name: 'Mundo Deportivo', url: 'https://www.mundodeportivo.com/rss/home.xml', lang: 'es', weight: 2 },
  { id: 'tuttosport', name: 'Tuttosport', url: 'https://www.tuttosport.com/rss/calcio', lang: 'it', weight: 2, sport: 'football' },
  { id: 'lequipe', name: "L'Équipe", url: 'https://dwh.lequipe.fr/api/edito/rss?path=/', lang: 'fr', weight: 2 },
  { id: 'rmc-football', name: 'RMC Sport', url: 'https://rmcsport.bfmtv.com/rss/football/', lang: 'fr', weight: 2, sport: 'football' },
  { id: 'kicker', name: 'kicker', url: 'https://newsfeed.kicker.de/news/aktuell', lang: 'de', weight: 2 },
];
