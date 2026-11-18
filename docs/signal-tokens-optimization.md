# Signal tokenization optimization

Branch `signal-tokens-memo`, from `origin/main` at `dbca56b`. First optimization of `docs/collector-performance.md` (audit commit `9faf74d`).

## Change
`applySignals` (src/collect.js) compared every story with every Google Trends headline and Reddit title, calling `tokens()` on each headline again for each story (~21,000 stories x 327 headlines). `tokens()` is a pure function of its string, so `collect()` now makes one `signalTokenizer()` per run (a `Map` keyed by the headline text) and passes it to `applySignals`. Nothing else changed: same loops, same order, same thresholds, story titles still tokenized directly.

Cache safety: the cache is created inside `collect()` on every run (never at module level), so it cannot outlive a run. It is keyed by the headline text, so even a reused cache could not return a stale result for changed signals. Without the third argument `applySignals` behaves as before.

## Results (saved state of 2026-10-20, 33,219 articles, 21,055 stories)
| | Before | After |
|---|---|---|
| `applySignals` over all stories (`scripts/bench-signals-memo.mjs`) | 40,569 ms | 3,188 ms (12.7x) |
| Whole collector, frozen clock, CPU only, mocked network: cluster stage | 32,458 ms | 10,891 ms |
| Same run, total | 63,470 ms | 42,633 ms (-20.8 s) |
| Cache memory | - | about 3.3 MB heap for 327 headlines (measured with gc; the whole-run peak RSS, 845 vs 629 MB, is noise between runs and not a claim) |

Timings vary run to run on this PC (the earlier bench measured 33.9 s and 2.4 s). The two runs above differ only by this change.

## Identical output (verified)
The real collector ran twice on the same state with the clock frozen (`scripts/profile-collector.mjs --freeze --keep-data`), before and after. All 11 files written are **byte-identical**: `news.json`, `news-more.json`, `state.json` (story ids, scores, ranking, CAP_G1 selection), `status.json`, `watch.json`, etc. The mocked-network request counts are equal (Telegram/ntfy 2, Gemini 2, translate 39, ...): Gemini usage and limits are untouched. `applySignals` alone is identical on all 21,055 stories (144 with a trend/Reddit boost).

## Tests (`test/signal-tokens.test.js`, 6)
Identity against a frozen copy of the old function; duplicate headlines and duplicate Reddit titles; many stories sharing signals (and a warm second pass); empty, null and malformed signals (including throwing in exactly the same cases); consecutive runs with different signals; the cache is created inside `collect()`. Full suite: 326 pass.

## Expected effect on a production run
About -20 s on the 142.9 s run (cluster stage 36.9 s to about 15 s), assuming the local CPU ratio of ~1.16 seen in the audit. Publication happens about 20 s earlier. Gemini retry and cooldown behaviour untouched.

## Deploy / roll back
Merge `signal-tokens-memo` into `main` and push; no variable, secret or state change. Check the next `[timing]` line: `cluster` should drop to roughly 12-16 s. Roll back with `git revert <merge commit>`.
