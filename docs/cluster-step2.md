# Step 2: Hebrew-led stories join the foreign reports of the same event

Base: production d4c26d8 (Step 1 plus the Griezmann patch). Branch `step2-crosslang`.
No AI calls, no new services, no change to summaries, frontend, workflows or stored data.

## Why same-event reports stayed apart

1. The card merge (`src/merge.js`) compares AI-written Hebrew cards. Cards are written only for stories whose
   lead is not Hebrew (`src/ai.js`, `lang !== 'he'`), and only 2 calls x 20 stories per run. A Hebrew-led group has
   no card, so the merge ignored it. Many foreign groups also wait for a card.
2. The "rare word" filter drops words common in the whole card set (for example a famous coach's name), so two
   cards of one event with differently worded headlines often share no rare word.
3. Names alone are weak evidence. Two stories about the same coach or club are often two events.

## What changed

- A Hebrew-led group gets a stand-in card from its own Hebrew headline (`standInCard`). Digests with two or more
  different scores get none.
- The Step 1 merge runs first and unchanged (pass 1; word frequencies come from real cards only). Pass 2 lets
  Hebrew-led groups join an existing group, never the other way, never split anything.
- Pass 2 guards (pairs with a stand-in only): same match phase (English text and Hebrew markers `HE_PRE`,
  `HE_POST`, `HE_LIVE`); score clash is a veto; quote versus result is a veto (Griezmann rule kept); the subject's
  own name is not evidence; round-ups and three-club headlines are ignored; one match per group; frequency taken
  over all groups (`rareAll`).
- `GROUPING` in `src/telegram.js` 2 to 3, so the first run after deploy marks page stories as sent instead of
  reposting merged stories.
- Merge step is about 10x faster (28-42 s to 2.5-5 s on the full memory): cheap "grounded" test first.

Candidates dropped: a "same moment" time rule (about 12 false merges per 35 joins), counting stand-ins in word
frequencies (changed old decisions), single pass (lost r015, joined Fulham-Hull to Arsenal-Forest).

## Measured results (`node scripts/eval-step2-compare.mjs`)

Same word groups, before = frozen merge of d4c26d8 (`test/fixtures/cluster-eval/before-step2/merge.js`).

| set | correct merges | false merges |
|---|---|---|
| all 283 pairs | 30 of 72 to 38 of 72 | 18 of 211 to 18 of 211 |
| 264 pairs of Steps 0 and 1 | 30 to 31 of 65 | 18 to 18 of 199 |
| editor-approved 95 | 0 of 10 to 0 of 10 | 8 of 85 to 8 of 85 |
| 19 Step 2 review pairs (assistant labels, unverified) | 0 of 7 to 7 of 7 | 0 of 12 to 0 of 12 |
| 24 synthetic | false merges 1 to 1, missed 0 to 0 | |

Precision 62.5 to 67.9 percent, recall 41.7 to 52.8 percent. 1092 to 1083 stories on the set. Old stories split by the
new merge: 0 (additions only).

Full memory (47,708 articles, backup 2026-10-20): 20,284 to 20,262 stories, 19 extra joins, 0 old stories split.
All 19 joins read by hand. Results: 18 right, 1 ambiguous (Neymar / Barca "best player in the world"). Story ids:
24.0 percent of articles changed id with the old merge vs 24.1 with Step 2; ids lost 168 vs 178.

## Honest limits

- The 10 editor-approved MERGE pairs stay 0 of 10. 5 are foreign groups with no card (card backlog, outside this
  step), 5 have differently worded AI headlines. A rule that merged them also made false merges, so it was not used.
- The 19 review pairs and all gains outside labelled pairs are the assistant's reading, not an editor's.
- The Carrick example cannot be replayed: the live state is not public.
- Gains are small by design. Safe first.

## Files

`src/merge.js`, `src/telegram.js`, `test/merge.test.js` (10 new tests, mutation-checked), `test/cluster-eval.test.js`,
`test/fixtures/cluster-eval/` (+19 pairs, new gate `baseline.json`, history `baseline-step1-final.json`, frozen
`before-step2/merge.js`), `scripts/eval-step2-compare.mjs`.

## Deploy, monitor, roll back

Deploy: push the commit. Check after deploy: first run after the deploy posts nothing from page stories (GROUPING
bump); stories with a Hebrew headline now show the foreign sources under one card; no round-up or two-phase match
glued together. Roll back: revert the Step 2 commit and set `GROUPING` to 4 so merged stories are not reposted.
