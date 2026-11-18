# Source reliability changes

Branch `source-reliability`, from `main` at `68f215b` (`CAP_G1=on`). Four focused changes from the source-reliability audit. Nothing in `CAP_G1`, the sorting-aware pool, ranking, clustering rules, Telegram selection, Gemini limits, summaries or the published data format was touched. No live request was made; everything below was measured offline on the saved state of 2026-10-19 (52,106 articles) and with the real collector run in a child process against a mocked network.

## 1. Feed timestamps

**What the data showed** (more precisely than the audit's "constant 12-hour offset"): `voetbalkrant` and `walfoot` date their articles on a 12-hour clock that **loses the PM**. Articles collected before 11:00 UTC have a lag of about 1 minute (right); articles collected after have a lag of about 721 minutes (exactly 12 hours early); no article is dated between 11:00 and 22:59 UTC. So a blanket "+12 hours" would break every morning article. The raw feed strings are not in the saved state and no live request was allowed, so the cause inside the feed (a dropped PM marker or a mis-read one) is a hypothesis; the measured pattern is not.

**The rule** (`src/feedtime.js`, enabled per feed by `clock12: 'Europe/Brussels'` in `config/sources.js`, applied in `src/collect.js`):
- Only a **new** article of a source that has already been read once is considered (the first read of a source returns old articles: never corrected).
- Its feed date plus 12 hours of wall clock must land within the last 30 minutes (or at most 5 minutes ahead). A morning article can never qualify (plus 12 hours is in the future); a genuinely old article does not land in the window either. Anything else keeps the feed's date.
- Daylight saving: "12 hours of wall clock" is 11 or 13 elapsed hours when a change lies between the two instants, so the rule also tries the date plus 12 hours moved by the change in the zone's UTC offset (tested for the changes of 2026-03-29 and 2026-10-25).
- The feed's own date is kept on the article as `feedPublished` when the time is a correction. An article seen before keeps the time it was given when first seen (the feed repeats its wrong date each run, and the correction only fits while the article is fresh).

**`clarin-dep` is not corrected.** The audit's heuristic flagged it as "constant about 1 hour", but its lag is spread (p10 44, median 54, p90 62 minutes). An exact clock error of an hour would give 60 to 65. This looks like a real feed delay, so there is nothing reliable to correct.

## 2. Backoff for failing sources (`src/backoff.js`)

| Answer | Before | Now |
|---|---|---|
| 5xx, timeout, network, invalid feed | 15 minutes flat | **unchanged** |
| 429 | 15 minutes flat | 15 min doubling per consecutive 429, at most 3 h; `Retry-After` (seconds or date) respected up to 12 h, never shorter than the doubling |
| 401, 403, 404, 410 | 15 minutes flat, forever | 15 min for the first two failures and for the first hour of failing; then 30 min doubling, at most **24 h** |

Never disabled: the longest wait is 24 hours, so a parked source is asked again every day; one success replaces the record (counters reset); a new source or a short failure keeps the old 15 minutes; healthy feeds are never touched (the code runs only after a failure). `fetchFeed` now throws errors that carry `status` and `retryAfter` (the message stays `HTTP 403`, so the health list is unchanged). Records saved before this change (no `failKind`, `kindStreak`, `failSince`) are read from the old `failStreak` and the error text: a source that has failed 980 times goes straight to the long wait, one that failed once does not.

## 3. State cleanup (`src/metaprune.js`)

Removes a `trend-*` entry of the per-source record when its source is not in this run's list **and** it was last fetched more than 48 hours ago (the radar keeps articles for 48 hours, so nothing it found is still in memory). Active sources, recent trend entries and every other kind of source stay. Only the schedule entry is removed: articles, ids, provenance (`via`, `paths`) and story ids are untouched. If a pruned search comes back it is fetched at once as a new source, and an article it returns that is already known is recognised by its id (`known`), so nothing is fetched twice or duplicated.

## 4. Stage timing (`src/timing.js`)

One line per run: `[timing] {"setup":55,"fetch":9,"parse":19,"enrich":548,"cluster":28,"rank":7,"ai":1,"notify":8,"publish":25,"total":700}` (milliseconds, measured at the real boundaries of `collect()`):

| Key | From the previous mark to |
|---|---|
| `setup` | the start of the run to the start of the feed fetch (state, athletes, teams, rivals, game info, player cards, the source list) |
| `fetch` | all feeds read |
| `parse` | the new articles filtered, dated and de-duplicated (`items` built) |
| `enrich` | title translation, entities and tags, corrections, the sport model, popularity signals |
| `cluster` | grouping into stories and the story filters |
| `rank` | the cap (`CAP_G1`), evidence, the editorial rank |
| `ai` | summaries, their translations, the language model's cards |
| `notify` | Telegram, trends, the morning brief, the source report |
| `publish` | the data files, feedback, mail, source requests, the saved state |

The nine stages add up to `total` (a test checks it). Nine fixed keys, one line, no per-source data.

## 5. Files changed

New: `src/feedtime.js`, `src/backoff.js`, `src/metaprune.js`, `src/timing.js`; `scripts/validate-reliability.mjs`; `test/feedtime.test.js` (11 tests), `test/backoff.test.js` (11), `test/metaprune.test.js` (4), `test/collector-reliability.test.js` (6, the real collector against a mocked network), `test/fixtures/reliability-fetch.mjs`; `docs/reliability-validation.json`, this file.
Changed: `src/feeds.js` (HTTP errors carry the status and `Retry-After`), `src/collect.js` (failure record, cleanup, clock correction, timing marks), `config/sources.js` (`clock12` on two feeds, a line in the field list).

## 6. Measured (saved state of 2026-10-19; `node scripts/validate-reliability.mjs --state <state.json>`)

**Timestamps** (each article replayed as the collector first saw it):

| | Articles | Looked 12 h early | Corrected | Median lag before | after | Correct articles touched |
|---|---|---|---|---|---|---|
| voetbalkrant | 105 | 67 | 67 | 720.6 min | **0.7 min** | 0 |
| walfoot | 85 | 54 | 51 | 720.6 min | **0.7 min** | 0 |

The few not corrected (3 of 54 for walfoot, none for voetbalkrant; 2 and 8 articles remain over 11 hours old in total) were first collected more than 30 minutes after publication: the rule is deliberately conservative and leaves them as the feed gave them (no worse than today). Risk check: the same rule applied to every other feed would touch 295 of 49,421 articles (60 per 10,000), all genuinely 12 to 12.5 hours old on first collection; that is why it is enabled only on the two feeds with the measured fault and never on a first read.

**Backoff** (a source answering the same error for 7 days, runs every 5 minutes): 403 or 404: **672 requests before, 14 after**; 429: 672 before, 59 after (never longer than 3 h between tries); 429 with `Retry-After: 7200`: 18 in two days; 503 and timeouts: 672, unchanged. The two sources failing live (`ghanasoccernet` 403 for 980 tries, `maisfutebol` 403 for 284) go from about 192 requests a day together to about 4. The 2,059 sources that were healthy in the saved state have no cooldown and are never touched; the one failing source in that state (502) keeps 15 minutes.

**Cleanup**: 2,075 entries to 1,270 (805 removed; of the 1,758 trend entries the rest were fetched within 48 hours and stay), the record 250.5 KB to 152.0 KB (39% smaller), 0.56 ms; every removed entry was a trend search, none polled in the last 48 hours, none active; all 52,106 articles kept (16 whose first finder was a pruned search keep their `via`).

**Story coverage**: with the two feeds' dates corrected, 21,055 stories become 21,062; 118 articles change date; 30 of them change story: 11 join a bigger story (Voetbalkrant's Ronaldo-ban article joins the 12-article story it belongs to), 19 end in a smaller one (Walfoot's Antwerp article leaves a Serbian-coach story it did not belong to). No article is lost. Grouping now follows true publication times for those two feeds.

**Runtime**: the new work per run is the clock correction (2.2 ms for 120 articles), the backoff record (3 ms for 400 failures) and the cleanup (0.6 ms): about 5 ms in a run of 2.4 minutes. Fewer pointless requests are made. The mocked end-to-end run of the real collector takes about 0.7 s.

## 7. Remaining limitations

- The cause of the PM loss is inferred from the pattern; the raw `pubDate` strings were not available offline. A third feed with the same fault would need its own `clock12` entry after the same check (the audit's `constantOffsetFeeds` list shows only these).
- Evening articles first collected more than 30 minutes late stay mis-dated (about 6% of the replayed ones), and articles from before the deployment keep their stored dates.
- The backoff acts on the answer's status; a site that blocks with a 200 page or a redirect is not detected. A 403 that is caused by a one-off block is retried after at most a day.
- Cleanup keeps entries fetched within 48 hours, so the record still holds about 950 trend entries; it is now bounded instead of growing.
- The timing line shows where the 2.4-minute run goes; it does not shorten it. `enrich` (translation, entities, signals) was 548 of 700 ms in the mocked run, which is not representative of production (no real network); the first production lines will say.
- clarin-dep, `yahoo-nba`, `sky-football`, ONE and ynet-sport are slow in the audit's data and are not changed here.

## 8. Effects on editor workflows

- Evening articles of Voetbalkrant and Walfoot now show their real (fresh) time and are grouped with the stories they belong to; they were 12 hours old in the radar. Both feeds are national-outlet `assist` sources, so their local-only stories still need a known team, player or Israeli angle to show.
- `ghanasoccernet` and `maisfutebol` (403) are asked about once a day instead of 96 times; nothing editors see changes (they produced nothing). The admin's existing daily "source down" message is unchanged.
- No change to the page, the data files' format, Telegram, summaries or the brief. The Actions log gains one `[timing]` line per run, and `[meta] removed N stale trend-search entries` when the cleanup removes something.
- State: `meta` entries gain `failKind`, `kindStreak`, `failSince` while failing; two feeds' articles can carry `feedPublished`. Older code ignores them.

## 9. Deploy and roll back

Deploy: merge `source-reliability` into `main` and push (the collector runs from `main`; nothing to configure, no variable, no secret). The first run after the merge reads the existing state: the persistent 403 sources get their long wait on their next failure; the stale trend entries are removed in that run. Check in the Actions log of the first runs: one `[timing]` line, `[meta] removed ~800 stale trend-search entries` once, no failed run. After a day, `ghanasoccernet` should no longer be requested more than once.

Rollback: `git revert <merge commit>` and push. The state written by the new code is read by the old code without change (extra fields ignored); the removed trend entries were dormant. No manual step.
