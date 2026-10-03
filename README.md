# Sports Radar · רדאר ספורט

Live sports news and scores in one place, in Hebrew and English.

**Live site:** https://stacker33.github.io/sports-news/ (updates about every 5 minutes)

**News tabs**
- 🔥 Top
- 🇮🇱 Israeli football · 🇮🇱 Israeli basketball · 🇮🇱 Olympic & more
- ✈️ Israelis abroad, with two inner tabs:
  - 📰 **News**: a row of small player cards for filtering (status icon, name, next game), with the news below
  - 👤 **Players**: a full card for each player, grouped ⚽ Football / 🏀 Basketball: club and league position, status (🤕 injured / 🟥 suspended / 🇮🇱 with the national team), last game played (minutes, rating) or "hasn't played since…", next game with the TV channel, season stats in his club's league, and his latest news. Tapping a card opens that player's news.
- ⚽ World football · 🏀 World basketball · 🏆 Other sports (biggest stories only)

**Side panel** (on a phone it's the bottom menu)
- 📊 **Live scores:** today, yesterday or tomorrow. Covers the Israeli leagues (football and basketball), the European cups, the top-5 leagues, the NBA and EuroLeague. Games of clubs with an Israeli player are pinned at the top with a ⭐, with a line for each player: starting / on the bench / came on 63' / subbed off, ⚽ goals, 🅰️ assists, 🟨🟥 cards, rating, or why he's missing (injury with expected return, suspension, national team), plus 📺 the Israeli TV channel. Data comes from 365Scores: the scores are read by the browser, the game details by the collector.
- ⚡ **Just in:** every new story the moment it's collected.

**Notifications (🔔):** choose which stories alert you: Israelis abroad, Israeli sport, big or breaking stories, goals and results for Israelis' clubs, or everything. They work while the app is open, including in the background.

**Sources:** about 100 feeds.
- Israeli: ONE, Walla, Ynet, Sport5, Sport1, Haaretz, Maariv, Israel Hayom, Kan, JPost.
- World: BBC, Sky, Guardian, Telegraph, ESPN, The Athletic, Yahoo, CBS, RealGM, Eurohoops, Marca, AS, Gazzetta, L'Équipe, kicker and more.
- Direct, without Google's delay: ESPN (8 leagues incl. MLS, JSON feed), The Athletic, sport1 (WordPress feed), Sport5 (homepage).
- Direct national outlets: Corriere dello Sport, A Bola, Record, ge (Brazil), Olé, Fotomaç, Novasports, Voetbal International, NU.nl, Gazeta Sporturilor. Their purely local stories appear only when they involve a known team or player or an Israeli angle, or join a story other outlets carry, so they speed things up without clutter.
- ⚡ Reporters posting live: Fabrizio Romano (Telegram), Shams Charania, David Ornstein, Ben Jacobs, The Athletic and BBC Sport (Bluesky). Stories they post about get a purple ⚡ badge.
- Automatically, for each player abroad: Google News searches in English and Hebrew, their club's local press in its own language, and a BBC club feed for English clubs.

Stories that many outlets report are merged into one card and ranked higher.

**World coverage**
- Headlines in other languages are translated automatically into Hebrew and English, using Google Translate's free web endpoint.
- The same story is merged across languages. For example, English, Hebrew, Greek and Dutch articles about Israel–Ireland become one card.
- **Opponents' press:** before and after every game of Israel's national teams, and of Israeli clubs in Europe, the app automatically searches the opponent's own media, in its own language. For example, Irish press for Israel–Ireland, Turkish press for Maccabi–Beşiktaş. Filter it with the 🆚 buttons in the Israeli tabs.
- **Biggest sports stories in 10 other countries:** Spain, Italy, Germany, France, Portugal, Brazil, Argentina, Turkey, Greece and the Netherlands.
- **Israeli clubs in the world press:** ongoing searches in 10 countries, in each language and spelling (e.g. Μακάμπι, Makabi). Any article tagged with an Israeli club joins the Israeli tabs.
- Betting, odds and live-score widget pages are filtered out in all languages.
- **⭐ My topics:** save a topic (e.g. "Deni & the Blazers") with search words in any language and/or teams, players and competitions picked from the tags, plus optional filters (sport, Israeli / world, sites, last 1–48 hours). Each topic is a button above the feed with a count of new stories; opening it shows every matching story from all tabs, and 🔔 can notify on new matches. Matching (and the search box) covers every headline in the story, the translations, the summaries and the tags — so a Hebrew word also finds the Greek or Spanish articles. Saved on the device.
- **🎥 YouTube, the smart way:** 18 official channels only (Sport5, the Israel FA, Winner League, Maccabi / Hapoel Tel Aviv, Maccabi Haifa, Hapoel Be'er Sheva, EuroLeague, NBA, Sky Sports News, and the Israelis-abroad clubs), read through their free channel feeds — never a YouTube search. Shorts, compilations, top-10s, live streams, podcasts and archive games are dropped; press conferences, interviews and announcements are kept; highlights only from Israeli channels, or from the global ones when an Israeli club/player is in them. A video joins the story it belongs to (🎥 on the card) and gets its own card only with an Israeli angle or a known team/player. About 45 uploads a day across the channels → roughly 10 shown.
- **Sorting by sport** uses the strongest evidence first: the site's own section (URL path, Sport5 folder), a sport-specific feed, names from the 365Scores knowledge base that exist in one sport only (a basketball player, Hapoel Holon, EuroLeague), clear keywords, a basketball-range score (98:102), then a small word model trained every run on the articles whose sport is certain. Clubs that exist in both sports (Maccabi / Hapoel Tel Aviv, Real Madrid) follow what they're in the news for that day. Non-sport sections (cars, lifestyle) are dropped. Stories never mix football and basketball, and an article must match a story's first articles to join it.
- **🏷️ Wrong category?** Every story has a small tag button: move it to football / basketball / other sport, mark it Israeli or not, or hide it as not relevant. The change applies immediately on that device and is sent to a public [ntfy.sh](https://ntfy.sh) topic (free, no account). The collector reads it within 5 minutes, applies it for everyone (kept 14 days per article), and trains the sport model on it.

**Ranking ("🔥 Top")** combines:
- how many outlets report the story, weighted by reliability
- how many languages or countries it appears in
- how fast it spread
- Google Top Stories placement
- 📈 Google Trends search volume in 10 countries
- 👍 Reddit hot lists (r/soccer, r/nba, r/Euroleague)
- 📚 Wikipedia attention: yesterday's most-viewed articles (English and Hebrew), plus each Israeli abroad's views compared with their normal level
- freshness

**Topic tags on every story:** each story is tagged with what it's about, for example 🏆 La Liga · 🛡️ Real Madrid · 👤 Kylian Mbappé. Israeli clubs and Israelis abroad are highlighted in blue. Tap a tag to see only stories about it; tap it again to clear.
- Tags are recognized in any language, from the headline or its translation, including Hebrew with prefixes (e.g. "בריאל מדריד" → Real Madrid).
- The knowledge base comes from 365Scores league tables and squads, in Hebrew and English: about 330 teams in 17 leagues and all their players. It's stored in `public/data/entities.json` and refreshed weekly.

**The 🕒 ↔ 🔥 slider** changes the order in every tab, from "newest first" to "most popular". The middle mixes both.

**⭐ For you:** learns from the stories you open (players, teams, opponents, topics, sources). Each card explains "because you read about…". Older reads fade over about a month.
- When the PC version is running, your reading history syncs between the PC and a phone on the same Wi-Fi.
- It's stored only on your PC, in `private/profile.json`, which is never published.
- "Reset learning" clears it.

## Run on your PC

```bash
npm install
npm start
```

Open http://localhost:3000. The console also prints an address for your phone while it's on the same Wi-Fi. News updates every minute. Google News searches are spaced out (every 3–8 minutes) to avoid being blocked.

## Edit the Israelis-abroad list

In the app, go to **✈️ Israelis abroad → ✏️ Edit list**. You can add, remove or change players, their club, the club's country and alternative spellings. When you save, the app immediately starts collecting news for the players and their clubs, and adds their clubs' games to the scoreboard.

**Automatic updates:** the editor compares your list with the current squads on 365Scores and suggests changes, which you approve with one tap:
- 🔄 a player moved to another club abroad → update his club
- 🏠 a player returned to an Israeli club → remove him
- ➕ an Israeli (by nationality) is playing at a club abroad and isn't on your list → add him

"Ignore" hides a suggestion permanently. Coverage is the 17 leagues in the knowledge base; players in other leagues (Japan, Romania…) are still kept up to date by hand. The button shows the number of updates, e.g. "✏️ Edit list · 2 updates".

**📝 Summary on every story:** one or two sentences in a bubble, taken from the feed's description or from the article page (Google News links are decoded to the real article). Summaries in foreign languages are translated automatically. Missing summaries are fetched gradually, 8 per minute, most important stories first.

If a club shows "⚠ not found on the scoreboard", add its common short name under "Other team names" (for example, "DC United" for "D.C. United").

The list lives in `config/athletes.json`.

## Cloud version (GitHub, free, 24/7)

See `.github/workflows/collect.yml`. GitHub Actions collects news and GitHub Pages hosts the app.

- **Every 5 minutes:** GitHub's own schedule is unreliable (it ran about every 4.5 hours), so an external free timer at cron-job.org starts the collection every 5 minutes through GitHub's "run workflow" API. It uses a GitHub key limited to this project's Actions, stored only at cron-job.org. GitHub's schedule stays as a backup.
- **Typical delay from publication to the site:** about 2 minutes for reporters, about 11 minutes for direct sites, and longer (hours) for anything that comes through Google News. The cloud version can't save list edits from the app, so edit the list on the PC version and push it, or edit `config/athletes.json` on github.com.

## Customize

- `config/sources.js`: news sites, their reliability weight and how often each is fetched.
- `config/athletes.json`: Israelis abroad.
- `src/classify.js`: keywords that decide the sport, whether a story is Israeli, and breaking-news words.
- `public/scores.js`: which leagues appear on the scoreboard.
