# Step 3: event-aware merging, translated stand-ins, national-team matches

Base: production b41bfe2 (Step 2). Branch `step3-event`.
No AI calls, no new services, no change to summaries, the frontend, workflows, stored data or editor votes.

## What was found

1. **Card backlog.** Cards are written only for foreign-led stories and only 2 calls x 20 stories per run. On the saved memory
   (47,708 articles) 13,582 of 20,110 foreign-led groups (68%) have no card, so the card merge ignores them. All of them already
   have a free cached machine translation of the headline (`tr.he`, used to show them on the page).
2. **Event identity.** Reports of one event are worded differently in every language, so "shares rare words" misses them. The same
   player's injury is the clearest case: on the memory one injury (Nuno Mendes) was 6 stories.
3. **National teams.** The radar tags clubs only. A national-team match has no team tags, so "two different matches" and "two phases of
   one match" never applied: two TV-listing pages for different matches share a template and joined.

## What changed

- `src/merge.js`
  - A card-less foreign group stands in with its cached Hebrew translation (`standInCard`, flag `mt`). It runs after the Hebrew-led
    pass, so Step 2 decisions are untouched. Pairs with a translated stand-in need **both** teams/players in common, a near-identical
    tag set, and two rare shared words or a shared score/number plus a rare word. A score alone is never enough.
  - New pass 4, **injury events**: two groups about one player's injury (the dominant player of both, same kind of news, within 36 h)
    are one story. Vetoes: a return from injury, a hypothetical ("if he is injured"), a quote or clip, a score or match report, two
    matches, a phase clash, more than one dominant player. Coach sacking and appointment were tried and left out (the editors ruled
    "risks the sack" vs "cost of sacking" separate, r026).
  - Word indexes make the Hebrew-led and translated passes about as fast as before (merge step 3.1 s to 4.5 s on the full memory).
- `src/cluster.js`: `nationalFixture` reads two nations from a football headline ("Armenia vs. Cyprus", "Italy-France", "lineup for
  Kosovo"). It is a post-step (`splitNational`) that only ever SPLITS a group holding two national matches or two phases of one; it never
  makes two groups join (the first version did, through knock-on effects in junk "World Cup" groups: found and removed in the final check).
  Football only (a cricket Test also names two nations).
- `src/telegram.js`: `GROUPING` 3 to 4 (one quiet run after deploy, no reposts).
- Evaluation: `scripts/eval-step3-compare.mjs` (frozen `before-step3/`), corpus carries the cached translation (`he`) so the set
  behaves like production, gate `baseline.json` re-saved, previous gate kept as `baseline-step2-final.json`.

## Measured (same articles, cards and pairs; before = b41bfe2)

| set | correct merges | false merges |
|---|---|---|
| all 283 pairs | 38 to 39 of 72 | 18 to 18 of 211 |
| editor-approved MERGE (10) | 0 to 1 (r211, Alisson Santos injury) | n/a |
| editor-approved SEPARATE_BUT_RELATED (83) | n/a | 8 to 8 merged (the same 8 as before; none new, none fixed) |
| 264 original pairs / 169 unreviewed | 31 to 32 / 31 to 31 | 18 to 18 / 10 to 10 |
| 19 Step 2 review pairs | 7 of 7 | 0 of 12 |
| 24 synthetic | missed 0 to 0 | 1 to 1 |

Precision 67.9 to 68.4 percent, recall 52.8 to 54.2 percent.

Full memory: word groups 20,932 to 20,935; stories 20,262 to 20,239. Labelled pairs 35 to 36 of 72 correct, false merges 21 to 21.
Biggest stories unchanged (268, 223, 199...); stories of 50+ articles 70 to 70. Story ids: 24.1 to 24.1 percent of articles move,
stories losing their id 178 to 188.

The merge step's own joins (all read by hand): 16 stories join old ones. Right: Kane 100th game, Ramos to Getafe, Betis-Barcelona report, Conceicao shoulder
(4 reports), Semenyo (3), Dybala, Ventura, Mendes (2, 60 articles), Kompany, Dembele, Leao (2 joins), Alisson Santos (3), Karetsas (3),
Allegri week-of-truth (3 near-copies), Ben Simmons (5 reports, 193 articles). The Szoboszlai / Frimpong join (a small group that named both players, "Szoboszlai's injury recurs, Frimpong substituted", joined Frimpong's new injury of the next day) was a distinct-event
merge: fixed by a general rule (a small group naming a second player in a quarter of its articles is no one player's injury event). 16 joins remain, none clearly wrong.

## National-team matches (79 football articles name one in the saved memory, the October break was mostly youth teams)

Groups mixing two national matches 3 to 1; groups mixing two phases of one match 1 to 0. On the full memory the grouping now changes in
exactly 2 old groups, both splits (a Poland-Nigeria / Germany-Morocco item out of a junk "World Cup" group; Spain-Portugal roller hockey
out of a cycling group), 0 joins. Read: all correct. The live site today (international window) is not replayable with full data.

## Honest limits

- The 10 editor-approved MERGE pairs: 1 of 10. The other 9 are "same person, another fact" (a quote, a transfer clause, a coach's words):
  a rule that merges them also merges the editors' 83 related pairs. r146 (Zoma) has no player tag at all. Not forced.
- The 17 joins and the national-team splits are my reading, not an editor's.
- National-team recognition needs an English headline with the nation's English name; Hebrew-only headlines are not read.

## Deploy and roll back

Deploy: push the commit. First run after deploy posts nothing from page stories (GROUPING bump).
Check: no story of 100+ articles that was not there before; injury stories of one player appear once; two nation listings apart.
Roll back: revert the Step 3 commit and set `GROUPING` to 5 so merged stories are not reposted.
