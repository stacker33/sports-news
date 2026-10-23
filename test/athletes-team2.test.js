import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildMatchers, normalizeAthlete, resolveTeams } from '../src/athletes.js';
import { loadGameInfo } from '../src/gameinfo.js';

const list = JSON.parse(readFileSync(new URL('../config/athletes.json', import.meta.url), 'utf8')).map(normalizeAthlete);
const goren = list.find((a) => a.name === 'Orian Goren');

test('Orian Goren: Barça Atlètic, with the first team as a second team', () => {
  assert.ok(goren);
  assert.deepEqual([goren.team365, goren.team2, goren.team2_365], [7613, 'Barcelona', 132]);
});

test('his surname counts next to either team; another Goren does not; Barcelona stories are not tagged as his team', async () => {
  const cache = await resolveTeams(list, {}); // team365 ids: no network
  assert.equal(cache['football|FC Barcelona Atlètic'].id, 7613);
  assert.equal(cache['football|Barcelona'].id, 132);
  const m = buildMatchers(list, cache);
  const who = (t) => m.players(t.toLowerCase()).includes('Orian Goren');
  assert.ok(who('Orian Goren trains with the first team'));
  assert.ok(who('Barça: Flick calls up Goren for the trip to Vigo'));
  assert.ok(who('בארסה: פליק זימן את גורן לסגל'));
  assert.ok(who('Barça Atlètic win, Goren on target'));
  assert.ok(!who('Flick praises Lamine Yamal and Raphinha'));
  assert.ok(!who('Leon Goren scores in Bundesliga'));
  // the team tag is his own team only: a first-team story is not an Israelis-abroad team story
  assert.deepEqual(m.teams('barcelona beat sevilla 3-0'.toLowerCase()), []);
  assert.deepEqual(m.teams('barça atlètic draw with nàstic'), ['FC Barcelona Atlètic']);
});

test('the first team’s games are watched for his lineup status', async () => {
  const asked = [];
  const before = globalThis.fetch;
  globalThis.fetch = async (url) => {
    asked.push(String(url));
    return { ok: true, json: async () => ({ games: [] }) };
  };
  try {
    await loadGameInfo([goren], { 'football|FC Barcelona Atlètic': { id: 7613 }, 'football|Barcelona': { id: 132 } }, {}, Date.now());
  } finally {
    globalThis.fetch = before;
  }
  const comps = decodeURIComponent(asked[0].match(/competitors=([^&]+)/)[1]).split(',').sort();
  assert.deepEqual(comps, ['132', '7613']);
});
