import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isStreamSpam } from '../src/classify.js';
import { trimLocal } from '../src/trim.js';

test('"free live stream" spam is caught; real headlines about streams are not', () => {
  for (const t of [
    '[!LIVESTREAMs!]Tv] Philly Eagles vs Jaguars 𝐋𝐈𝐕𝐄 Ｆｒｅｅ ＯＮ Ｔｖ Ｃｈａｎｎｅｌ streaming Stream',
    '【LIVESTREAMS】FREE] Ipswich Town vs Nottm Forest 𝐋𝐈𝐕𝐄 Reddit Ｓｔｒｅａｍｓ Ｆｒｅｅ ＯＮ Ｔｖ Ｃｈａｎ ｎ e l',
    '~$!【LIVE@STREAMs】 Gloucester vs. Bath Rugby Rugby 𝐋𝐈𝐕𝐄 Ｓｔｒｅａｍｓ ＯＮ Ｔｖ Ｃｈａｎｎｅｌ 22 October 2026',
    '%*[[[SPORT TV>]* Al Hilal vs Al Qadsiah live stream,',
    '[WATCH@LIVE-GAME] Patriots vs Bears Live NFL Thursday Games October, 22, 2026 jgn',
    '!+[Here’s Way To Watch] Bears vs Patriots Live Broadcast today game',
    '( YOUTUBE LIVE ) New England Patriots vs Chicago Bears Live Broadcast',
    '$$@#[LIVESTREAMs]!F,R,E,E!=]Union St.-Gilloise vs Hapoel Be\'er LIVE Online StReAm UEFA 22 October 2026',
    'Ipswich vs Forest Reddit Streams',
  ]) assert.ok(isStreamSpam(t), t);
  for (const t of [
    'How to watch Como vs Man Utd: TV channel and live stream for Champions League today',
    'Darts heute live: Darts-EM im Free-TV & Livestream – mit Springer und Schindler',
    'LIVESTREAM: Zizou Bergs staat een set in het krijt in zijn kwartfinale op European Open',
    'ＭＦ佐野航大、脅威の公式戦１０戦連続フルタイム出場…欧州ＣＬでＰＳＶの初勝利貢献、ポルトに１―０(スポーツ報知)',
    'דני אבדיה בחמישייה: איפה לצפות במשחק של פורטלנד',
    '(VIDEO) Avdija scores 30 as Blazers beat Suns',
  ]) assert.ok(!isStreamSpam(t), t);
});

test('the save-time trim drops only old local-source articles with nothing to show', () => {
  const now = Date.parse('2026-10-23T20:00:00Z');
  const h = (n) => now - n * 3600e3;
  const items = [
    { id: 'jp-old', assist: true, seen: h(7) }, // dropped
    { id: 'jp-new', assist: true, seen: h(2) }, // still young: may join a story
    { id: 'jp-team', assist: true, seen: h(7), ents: ['t1234'] }, // names a tracked team
    { id: 'jp-player', assist: true, seen: h(7), ents: ['p55'] },
    { id: 'jp-comp', assist: true, seen: h(7), ents: ['c7'] }, // a competition alone isn't enough → dropped
    { id: 'jp-il', assist: true, seen: h(7), israel: true },
    { id: 'jp-abroad', assist: true, seen: h(7), athletes: ['Neta Lavi'] },
    { id: 'jp-shown', assist: true, seen: h(7) }, // in a published story
    { id: 'bbc-old', seen: h(30) }, // not a local-market source: never trimmed
  ];
  const { keep, trimmed } = trimLocal(items, { now, shownIds: new Set(['jp-shown']) });
  assert.deepEqual(trimmed.map((i) => i.id), ['jp-old', 'jp-comp']);
  assert.equal(keep.length, items.length - 2);
});
