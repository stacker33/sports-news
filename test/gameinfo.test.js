import { test } from 'node:test';
import assert from 'node:assert/strict';
import { playerInGame } from '../src/gameinfo.js';

// the Nets game of 2026-10-14 (365Scores game 4811413), trimmed: basketball has no substitution events
const det = {
  members: [{ id: 1, name: 'Danny Wolf' }, { id: 2, name: 'Ben Saraf' }],
  homeCompetitor: { id: 10, lineups: { members: [
    { id: 1, status: 2, statusText: 'Substitute', hasStats: true, stats: [{ name: 'Minutes', value: '10:08' }, { name: 'Points', value: '0' }, { name: 'Rebounds', value: '2' }, { name: 'Assists', value: '0' }] },
    { id: 2, status: 2, statusText: 'Substitute', didNotPlayed: true, didNotPlayedReason: "DNP - Coach's Decision", hasStats: false },
  ] } },
  awayCompetitor: { id: 11, lineups: { members: [] } },
  events: [],
};

test('a basketball bench player who played has his minutes and box score; a DNP is marked', () => {
  const wolf = playerInGame(det, { name: 'Danny Wolf' }, 10);
  assert.equal(wolf.s, 'bench');
  assert.equal(wolf.min, 10);
  assert.deepEqual(wolf.box, { pts: '0', reb: '2', ast: '0' });
  const saraf = playerInGame(det, { name: 'Ben Saraf' }, 10);
  assert.equal(saraf.dnp, true);
  assert.equal(saraf.min, undefined);
});
