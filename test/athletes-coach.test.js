import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildMatchers, normalizeAthlete } from '../src/athletes.js';
import { loadPlayerCards } from '../src/playercards.js';

const list = JSON.parse(readFileSync(new URL('../config/athletes.json', import.meta.url), 'utf8'));
const coach = list.find((a) => a.name === 'Barak Yitzhaki');

test('a coach on the Israelis abroad list keeps his role and country through normalisation', () => {
  assert.ok(coach, 'Barak Yitzhaki is on the list');
  const n = normalizeAthlete(coach);
  assert.equal(n.role, 'coach');
  assert.equal(n.country, 'cyprus'); // a known country (Greek-language search), not "other"
  assert.equal(normalizeAthlete({ name: 'X', role: 'manager' }).role, undefined); // only "coach" is kept
});

test('the coach is found in Hebrew, English and Greek headlines; another Yitzhaki is not him', () => {
  const m = buildMatchers(list.map(normalizeAthlete), {});
  const hit = (t) => m.players(t.toLowerCase()).includes('Barak Yitzhaki');
  assert.ok(hit('רשמית: ברק יצחקי מונה למאמן אנורתוזיס פמגוסטה'));
  assert.ok(hit('Anorthosis appoint Barak Itzhaki as head coach'));
  assert.ok(hit('Ο Μπάρακ Ιτζάκι νέος προπονητής της Ανόρθωσης'));
  assert.ok(hit('יצחקי: "באתי לאנורתוזיס כדי לזכות"')); // surname alone with the club named
  assert.ok(!hit('אורי יצחקי חתם בקבוצה חדשה')); // a different Yitzhaki, no club context
});

test('a coach gets no player card (no "didn\'t play" / "not in squad" for him), players still do', async () => {
  const calls = [];
  const fetchBefore = globalThis.fetch;
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    throw new Error('network disabled in this test');
  };
  try {
    const st = await loadPlayerCards([normalizeAthlete(coach)], {}, { cards: { 'Barak Yitzhaki': { stale: true } } }, Date.now());
    assert.equal(st.cards['Barak Yitzhaki'], undefined); // an old card is dropped
    assert.equal(calls.length, 0); // no lookup for a coach
  } finally {
    globalThis.fetch = fetchBefore;
  }
});
