# The sorting-aware 1,200-story pool (flag `CAP_G1`, off by default)

Background: `docs/missed-news-cap-verdict.md` (audit branch) and `docs/sorting-aware.md`. The cap used to publish the Israeli stories and then the newest stories by last-article time, so every tab and slider position drew on the same last ~3.5 hours (the Basketball tab had 69 stories). The first version of this flag (a shared 50/50 editorial/freshness fill) fixed only the Top tab and is **replaced** by what is described here.

## What it does

`CAP_G1` (repository variable, read by `src/capselect.js`):

| Value | Effect |
|---|---|
| unset / anything else | **off**: exactly today's behaviour (the same `capStories`, now living in `src/capselect.js` and still exported from `src/collect.js`) |
| `shadow` | the pool is computed and logged (`[cap-g1] shadow: {...}`) but the **legacy list is published**. Use this first: it runs on production's real inputs (watchlist, desk labels, Sport5 coverage) |
| `1`, `true`, `on`, `yes` | the data files hold the pool |

The pool, with the flag on:

1. **Israeli tier first**, unchanged: Israeli / abroad / watch-Israel stories, newest first, up to 1,200.
2. The other slots hold **what the slider can show**. The page sorts the published stories by the slider mix and shows the first 300 (120 from slider 70) of each tab. For the Top, Football and Basketball tabs at slider positions 0, 25, 50, 75 and 100, and for the Israeli monitoring tab at its default slider (40, popularity formula), the collector builds the same list the page would build, from **every eligible story** (about 9,000), and takes the lists in turn (best story of every list, then second best ...) until 1,200 are chosen. The formulas are the page's own: the existing `editorialRank` score, `w x score/100 + (1 - w) x exp(-(now - first)/6h)`, the tab rules, the local / low / minor collapse, and the stories only Israeli sites carry left out of the three tabs (`foreignOnly`). No new ranking rule.
3. **Deterministic**: every list is a total order (mix, then the later last article, then the story id); the selection does not depend on the input order. A story with a missing field (NaN) sorts last.
4. **Little churn**: a story the previous run published counts as 3 places better when the pool is trimmed (`STICKY_RANKS`); remembered as `state.capKept.ids` (written only when the flag is not off).
5. The published list keeps the legacy order (newest last article first). It is exactly 1,200 stories whenever more are eligible, or the run falls back (below).

What reads what (`src/collect.js`): the **legacy list** (`core`) still goes to Telegram, the summaries and their translations, the morning brief, the trends board, the source report and the diagnostics, so a story that only the pool admits is display-only: **no Telegram post, no Gemini call, no brief place**. The **published list** goes to `news.json` / `news-more.json`. Nothing about the files' format, the front end, search, filters, story ids or corrections changes. No new model call.

**Failure is safe.** The selection runs inside a try/catch: if it throws, or the pool does not have exactly the expected number of stories, the run logs `[cap-g1] failed, the legacy cap is used` and publishes the legacy list.

## Keeping the page and the collector in step

The collector copies the page's ranking formulas. `test/pool-drift.test.js` extracts the page's **own functions** from `public/app.js` (`israeliAngle`, `foreignOnly`, `inTab`, `rankMix`, `mixVal`, `editorialTab`, the tab sets) and runs them in a sandbox against random stories, then compares with the collector: tab membership, the mix value at 9 slider positions in each tab, the full lists (filter, sort, slice) at every position including 69 and 70, the Israeli monitoring tab's popularity formula, and the constants (slider defaults 50 and 40, list sizes 300 / 120 from 70, freshness half-life, the off-beat rule). If the page changes any of these, a test fails and says which.

## Telegram access

Telegram still reads the legacy list. The alert links to the source article and the site's front page, not to the story. Replay (`scripts/bench-g1-telegram.mjs`: 49 runs 30 minutes apart over 24 hours, 66 stories posted by the channel's own rule), share of posted stories still in the published files:

| After the post | Stories checked | Old cap | Pool alone | **Pool + retention** |
|---|---|---|---|---|
| 0, 1, 3 h | 66, 58, 42 | 100% | 100% | 100% |
| 6 h | 32 | 93.8% | 87.5% | **100%** |
| 11 h | 21 | 76.2% | 61.9% | 76.2% |
| 12 h | 18 | 83.3% | 66.7% | **88.9%** |

(The others at 11 h are no longer eligible stories, in any list.) The retention rule (`telegramPinIds`, only with the flag on): a posted story is added to the published list while it is eligible, if it was posted in the last **12 hours**, or in the last **36 hours** while the old cap would still publish it (so the pool never hides a posted story the old cap still showed), at most **60** stories, most recent first. Each takes the place of the lowest-priority non-Israeli pool story, so the total stays 1,200 (maximum in the replay: 1,200). Pinned per run: median 18, maximum 53. A story is matched by any of its articles (a late-indexed older article can change its key).

## Measured (saved state of 2026-10-19 22:10 UTC)

`node scripts/bench-sorting-aware.mjs --state <state.json>` (5 snapshots 3 hours apart, 13 five-minute runs for churn), `bench-g1.mjs`, `bench-g1-telegram.mjs`. "Recall" = share of the list the page would build from every eligible story that is in the published stories. The replay has no watchlist, desk labels or Sport5 check; it does use the source configuration for Israeli-only stories.

| | Today | Earlier fill (50/50 mix) | **Pool** |
|---|---|---|---|
| Stories published | 1,200 | 1,200 | **1,200** (+0 KB, the files keep their size) |
| Worst list, any tab, any slider position | 18.6% | 20.6% | **85.9%** |
| Top tab, mean over positions | 86.7% | 99.8% | **99.8%** |
| Football tab, mean (positions 0 / 50 / 100) | 73.2% (67 / 68 / 65) | 97.8% | **92.7%** (88 / 90 / 100) |
| Basketball tab, mean (0 / 50 / 100) | 24.2% (19 / 19 / 27) | 27.8% | **94.4%** (86 / 92 / 100) |
| Israeli monitoring tab, default slider | 73.1% | 74.0% | **94.6%** |
| Slider positions the pool was not built for (10, 35, 65, 85) | | | 88 to 100% |
| Older high-value stories restored (the cut stories at the timeless top 10%) | 0% | 6.5% | **23.8%** |
| Stories entering / leaving per 5-minute run | 17.3 / 17.3 | 14.3 / 14.3 | **9.2 / 9.2** |
| Overlap of consecutive runs (Jaccard) | 0.972 (min 0.959) | | **0.985** (min 0.972) |
| Top lists at the last run (newest / default / editorial slider) | 78 / 83 / 95% | | **100 / 100 / 100%** |

Every list the page can build at the positions tested is better covered than today. Filters (Top tab, slider 0 / 100, today -> pool): Premier League 26 -> 31% / 55 -> 75%; NBA 19 -> 71% / 28 -> 92%; Euroleague 16 -> 48% / 29 -> 69%; Champions League 43 -> 54% / 64 -> 90%; Hebrew articles 47 -> 73%.

**The Israeli monitoring list is a trade.** Without it the pool measured Football 98.8% (positions 0 to 65: 97 to 99%), Basketball 98.6%, worst list 94.0% but the Israeli monitoring tab 65% (below today's 73%: 189 stories that only Israeli sites carry, 19 kept today, 0 kept). With it that tab is 94.6% and Football is 92.7%. No tab is worse than today either way; the second was chosen so the desk's Israeli view does not regress.

**Cost of scoring every eligible story before the cap** (about 9,000): 0.74 to 0.78 s median, 0.96 s worst per run (scoring plus selection), +30 MB heap, 475 MB peak RSS for the whole replay (it holds the 78 MB state; the collector already does). Measured on this PC (Node 22), not on a GitHub runner: check `selectMs` in the shadow log there. A run is about 5 minutes and the existing stages take longer than this. Published size: the same 1,200 stories, the same files (about 1.04 MB gzipped), the same parse time and memory in the browser.

**Flag modes** (13 replayed runs): with `off` or `shadow` the published list is exactly the legacy list (same stories, same order) in 13 of 13; with `on`, the list Telegram, summaries, translations and the brief read is exactly the legacy list in 13 of 13. With `off` no editorial score is computed (a test makes the scoring function throw). Every call that can reach Gemini, a translator or Telegram takes the legacy list in every mode (checked by a test), so there are **no new model calls**; stories only the pool adds get no summary unless one was cached.

## Remaining weaknesses

- **Filters.** League and language filters apply before the sort; the pool is built without them, so filtered lists are served only in part (above). Adding the top 100 of each league would raise them (Premier League slider 0: 47%; Euroleague 70%) but needs about 390 more stories (+324 KB gzipped, +29% per download); not done.
- **Football tab 88 to 90% at slider 0 to 65** (the price of the Israeli monitoring list).
- **Replay inputs.** No watchlist, desk labels or Sport5 check, and one 48-hour window. Production's real scores differ somewhat: hence `shadow` first and the recall in its log (`recallLegacy` / `recallPool`, per tab).
- **Older stories.** Freshness is half of the mix and part of the editorial score, so day-old stories are still mostly out (23.8% of the high-value ones come back).
- **Tabs not listed:** the 'other sports' tab, 'my topics' and the Israeli tiers' own tabs are served by the Israeli tier or by chance, not by a list.
- **The Israeli tier is unbounded, as today.** If Israeli stories fill 1,200, nothing else gets in.
- **The tab rules are copies** guarded by `test/pool-drift.test.js`; a new tab or a new off-beat rule on the page needs the collector updated, and the test will say so.
- Time and memory on the real runner are not measured here.

## Enable, check, roll back

1. Merge `g1-editorial-cap` into `main` (you push). The workflow already passes the variable (`CAP_G1: ${{ vars.CAP_G1 }}` in `.github/workflows/collect.yml`); unset is off.
2. Set the repository variable `CAP_G1=shadow`. After one or two runs read the `[cap-g1] shadow` line in the Actions log: `selectMs` (well under 2 s), `israeli` (the legacy count), `added` / `dropped` (about 400 each), `recallLegacy` against `recallPool` (mean and worst, per tab: expect the pool's worst near 85% and the legacy's near 20%), `jaccardWithLastRun` (about 0.98).
3. When satisfied set `CAP_G1=on`. The first run after switching publishes the pool; Telegram and summaries are unaffected. Check that the Telegram volume and the Gemini request count did not change.
4. Rollback: set `CAP_G1` to empty or delete it (the next run, 5 minutes, is the legacy cap again; `state.capKept` is ignored). To remove the code, `git revert` the merge commit.
