# The two GitHub Actions warnings

Branch `actions-warnings`, from `origin/main` at `56729ec`. Evidence: the public check-run annotations and cache list of `stacker33/sports-news` (no log download: logs need a token), and the source / `action.yml` of each official action at the tags below. Verified 2026-11-18.

## 1. "Node.js 20 is deprecated"

**Exact cause.** The annotation on run 44411390464 names the actions: `actions/cache/restore@v4`, `actions/cache/save@v4`, `actions/checkout@v4`, `actions/configure-pages@v5`, `actions/deploy-pages@v4`, `actions/setup-node@v4`, `actions/upload-artifact@v4`. Each of those tags declares `using: node20` in its `action.yml`; the runner forces them onto Node 24 and warns. `upload-artifact@v4` is not in our files: it is used inside `actions/upload-pages-artifact@v3` (a composite action pinned to `upload-artifact@v4.6.2`). The collector itself already runs on Node 22 through `setup-node` (`node-version: 22`); that is unrelated to the warning.

**Upgrades** (each `action.yml` read at the tag; all `using: node24`):

| Action | Was | Now | Notes |
|---|---|---|---|
| actions/checkout | v4 | **v7** (v7.0.1) | v6 introduced credentials in a separate file (the workflows use no git push; the watchdog commits through the REST API); v7: ESM, blocks fork-PR checkout in `pull_request_target`/`workflow_run` (not used here) |
| actions/setup-node | v4 | **v7** (v7.1.0) | ESM; no longer exports a dummy `NODE_AUTH_TOKEN` (no registry auth used); `cache: npm` unchanged |
| actions/cache (restore, save) | v4 | **v6** (v6.1.0) | v5 = node24 (needs runner >= 2.327.1, hosted runners are newer); v6 = ESM migration |
| actions/configure-pages | v5 | **v6** (v6.0.0) | node24 only |
| actions/upload-pages-artifact | v3 | **v5** (v5.0.0) | composite, uses `upload-artifact` v7 (node24). v4 stopped including dotfiles; the published `public/` contains none (no tracked dotfile, the collector writes none, `*.download` files are removed first) |
| actions/deploy-pages | v4 | **v5** (v5.0.1) | node24 |

Runner requirement: node24 actions need runner >= 2.327.1; `ubuntu-latest` hosted runners are newer (the run's own log shows them forcing Node 24 today).

## 2. "Cache save failed."

**Exact cause.** It is the daily backup step, on every run except the first of each UTC day.
- `actions/cache` `saveOnlyRun` (src/saveImpl.ts): when `saveCache` returns `-1` it logs `core.warning('Cache save failed.')`. `-1` is what it returns when the key cannot be reserved because it already exists ("another job may be creating this cache", logged only as info).
- The step saves key `radar-backup-YYYYMMDD`; a key can be saved once. The first run after 00:00 UTC creates it, the other ~287 runs find it taken.
- Evidence: run 44204196608 (00:00 UTC, created `radar-backup-20261118` at 00:02) has only the Node warning; the next run, 44204630700, has both. The per-run state key (`radar-state-<run_id>-<attempt>`) and the watchdog key (`watchdog-<run_id>`) are unique, and both exist in the cache list, so they save.

It concerns **collector state caching** (the daily backup), not dependency caching (`setup-node`'s npm cache is a separate `node-cache-Linux-x64` entry and restores/saves in its own post step).

**Effect on production.** None on collection: the step is `continue-on-error`, the state save of that run already succeeded, and the backup already exists. No effect on duplicate processing, runtime (a failed reservation is a quick API call), or API usage (Gemini is not involved).

**Fix.** A lookup-only restore of today's exact key first (no download, no `restore-keys`), and the save runs only when it is not a hit. The first run of the day behaves as before; if the lookup step itself fails the save is still attempted (as before). Hosted effect: one tiny lookup call per run.

## 3. Found on the way: the backup cleanup never ran

In `Delete older state copies`, the second command had a literal backslash-n (`... --jq '.[3:][].id' \n            | xargs ...`), so the shell passed an extra argument `n` to `gh cache list` instead of continuing the pipeline. Evidence: the cache list holds **7** daily backups (20261112 to 20261118, 15 MB each) although the step is meant to keep 3. Fixed to a real line continuation. The first run after the deploy deletes the 4 oldest backups (the 3 newest stay, 45 MB); this is the documented intent, and the newest backup is never touched. The per-run state copies (5 kept) were not affected.

## Not changed (noted)
- 749 `watchdog-*` caches (269 bytes each) accumulate, 96 a day; harmless (0 MB) but never pruned. Leaving as is.
- The run annotations also carry a notice that the `ubuntu-latest` label is migrating to Ubuntu 26 (runner-images issue 14748). No action needed here; the workflow uses only checkout/Node/curl/gh.

## Tests
`test/workflow-actions.test.js` (4): no official action below its first Node 24 major; the backup lookup is exact, `lookup-only`, ordered before the save, and the save is conditional; the cleanup step has no literal `\n` and still prunes states to 5 and backups to 3; CAP_G1 still comes from the repository variable. `test/state-cache.test.js` updated to `@v6`. Both workflows parse as YAML (PyYAML), and the cleanup script passes `bash -n`. Full suite: 330 pass. A real Actions run is the only full proof and cannot be made offline.

## Expected result and uncertainty
- Node warning: should disappear: none of the listed actions is on Node 20 any more (`upload-artifact@v4` goes with `upload-pages-artifact@v5`, which pins v7). Residual risk: a Node 20 action not named in the annotation would show up in the new one; none is left in our workflow files.
- Cache warning: should disappear on every run after the first of the day; the first run of the day never had it.
- Uncertainty: the new majors (checkout v7, setup-node v7, cache v6) are recent and cannot be exercised offline; the cache `lookup-only` behaviour (`cache-hit` true only for an exact match) is documented but verified here only by reading the action. Watch the first 2-3 runs: both annotations gone, `Deploy` succeeded, site `version.json` advancing.

## Deploy / roll back
Push to `main` triggers a collect run by itself (`on: push`). Roll back with `git revert <commit>` and push: the workflows go back to v4 (warnings return, nothing else changes). The state and backups in the Actions cache are never touched by the workflow changes, except the 4 old daily backups pruned by the cleanup fix.
