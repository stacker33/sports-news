# G1: an editorial-aware 1,200-story cap (flag, off by default)

Background: `docs/missed-news-cap-verdict.md` (on the audit branch). The cap that decides which 1,200 stories are published used to look only at the age of a story's last article. G1 keeps the same total and the same Israeli-first rule and fills the other slots with the stories that score highest on the app's default sorting mix.

## What it does

`CAP_G1` (repository variable, read by `src/capselect.js`):

| Value | Effect |
|---|---|
| unset / anything else | **off**: exactly today's behaviour (the same `capStories`, now living in `src/capselect.js` and still exported from `src/collect.js`) |
| `shadow` | the G1 selection is computed and logged (`[cap-g1] shadow: {...}`) but the **legacy list is published**. Use this first: it runs on production's real inputs (watchlist, desk labels, Sport5 coverage) |
| `1`, `true`, `on`, `yes` | the data files hold the G1 list |

Selection with the flag on:

1. **Israeli tier first**, unchanged: Israeli / abroad / watch-Israel stories, newest first, up to 1,200.
2. The remaining slots go to the non-Israeli stories with the highest `0.5 x editorial score/100 + 0.5 x exp(-(now - first)/6h)`, the app's default slider mix (`public/app.js rankMix`, `mixF = 50`). The editorial score is the existing `editorialRank` (`src/rank.js`), computed before the cap from the same inputs as it is later, so a published story's score is the same number as before.
3. **Deterministic**: ties break on the later last article, then the smaller story id. A story with a missing field (NaN) sorts last. Same input gives the same selection whatever the input order.
4. **Little churn**: a story the previous run published gets a +0.02 bonus in the mix (`KEEP_BONUS`), remembered as `state.capKept.ids` (written only when the flag is not off).
5. The published list keeps the legacy order (newest last article first), so the files and the front end's tie-breaks look the same.

What reads what (`src/collect.js`): the **legacy list** (`core`) still goes to Telegram, the summaries and their translations, the morning brief, the trends board, the source report and the diagnostics, so a story that only G1 admits is display-only: **no Telegram post, no Gemini call, no brief place**. The **published list** goes to `news.json` / `news-more.json`. The brief's stories are added to the published list if G1 did not keep them, and the same number of the lowest-ranked non-Israeli G1 stories are given up, so the total stays exactly 1,200. A failure in the new code falls back to the legacy cap and logs `[cap-g1] failed`.

Unchanged: the cap (1,200), story ids, summaries and Telegram inputs, corrections, the front end and its sorting controls, every ranking rule. No new model call.

## Measured (saved state of 2026-10-19 22:10 UTC; 13 consecutive 5-minute runs)

`node --expose-gc scripts/bench-g1.mjs --state <state.json> --runs 13 --json docs/g1-cap-bench.json`

| | Legacy | G1 |
|---|---|---|
| Newest list (top 300) contained in the published 1,200 | 91.0% | **99.7%** |
| Default list (top 300) contained | 95.3% | **100%** |
| Editorial-rank list (top 120) contained | 100% | 100% |
| Stories swapped at the last run | – | 255 added, 255 dropped (of 1,200) |
| Overlap of consecutive runs (Jaccard, 12 pairs) | 0.972 (min 0.959) | **0.978** (min 0.969); 0.977 without the keep bonus |

These recall numbers are slightly different from the audit's (95.3 against 94.8, 91.0 against 93.4) because this replay applies the cap's other filters in the order collect.js does.

**Cost of scoring every eligible story before the cap** (about 9,000 stories): **0.65 s median, 0.89 s worst** per run, +27 MB of heap, 472 MB peak RSS for the whole replay (it holds the 78 MB state and all articles; the collector already holds the same). Measured on this PC (Node 22), not on a GitHub Actions runner: expect a similar order, check the `selectMs` in the shadow log there. A run is about 5 minutes and the existing stages take longer than this.

## Remaining risks

- **The replay score lacks the watchlist, desk labels and Sport5 check.** In production they are present before the cap and raise some scores, so the real list will differ somewhat from the replay. Hence `shadow` first; compare `added` / `dropped` with the figures above.
- **Freshness is half the mix.** A day-old story rarely beats a fresh one, so G1 does not bring back old important stories (the audit measured 6.7% of them). That needs a separate decision (the audit's G2).
- **The Israeli tier is unbounded, as today.** If Israeli stories ever fill 1,200 nothing else gets in; no floor was added because the requirement was to keep the priority as it is.
- **The churn bonus is small** (+0.02): consecutive runs overlap 97.8%, a little better than before, but the cut boundary still moves by about 25 stories per run.
- **Stories that G1 adds get no AI summary** unless one was cached earlier (summaries are limited to the legacy list by design); they show the feed's own description.
- **Legacy-only stories that G1 drops** (255 at the last run) are still posted to Telegram and summarised, but are not in the data files if G1 dropped them and the brief did not name them: a Telegram link to a story that is absent from the page is possible for a story G1 judged low value. The page opens by id on the main list only.
- Memory and time on the real runner are not measured here.

## Enable, check, roll back

1. Review and merge `g1-editorial-cap` (you push).
2. Set the repository variable `CAP_G1=shadow`. After one or two runs read the `[cap-g1] shadow` line in the Actions log: `selectMs`, `added` / `dropped` (about 250 expected), `jaccardWithLastRun` (about 0.97), `israeli` (same as the legacy count).
3. When satisfied set `CAP_G1=on`. The first run after switching publishes the G1 list; Telegram and summaries are unaffected.
4. Rollback: set `CAP_G1` to empty or delete it (the next run, 5 minutes, is the legacy cap again; `state.capKept` is ignored). To remove the code, `git revert` the merge commit.
5. The workflow passes the variable to the collector (`CAP_G1: ${{ vars.CAP_G1 }}` in `.github/workflows/collect.yml`, next to `AI_RICH_SUMMARIES`); an unset variable is an empty string, which is off.
