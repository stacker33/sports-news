import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { cleanRequest, toAthlete, processAthleteRequests, userAthletes, publicAthleteList } from '../src/userathletes.js';
import { normalizeAthlete, buildMatchers } from '../src/athletes.js';
import { loadFeedback } from '../src/feedback.js';

const now = Date.parse('2026-10-23T20:00:00Z');
const env = { TELEGRAM_BOT_TOKEN: 'test-token', TELEGRAM_ADMIN_CHAT: '111' };
const builtin = JSON.parse(readFileSync(new URL('../config/athletes.json', import.meta.url), 'utf8')).map(normalizeAthlete);
const req = (o = {}) => ({ name: 'Dor Peretz', name_he: 'דור פרץ', team: 'Venezia', team_he: 'ונציה', country: 'italy', sport: 'football', role: 'player', by: 'דני', note: 'קשר ההרכב', at: now, ...o });

function fakeTg() {
  const calls = [];
  let id = 900;
  return { calls, tg: async (method, body) => (calls.push({ method, body }), method === 'sendMessage' ? { message_id: ++id } : true) };
}
const fromLink = (url) => {
  const q = new URLSearchParams(new URL(url).hash.slice(1));
  return { a: q.get('a'), id: q.get('id'), s: q.get('s') };
};

test('only a full Latin-script name and a team are accepted; unknown fields are dropped', () => {
  assert.equal(cleanRequest(req({ name: 'Peretz' })), null); // one word
  assert.equal(cleanRequest(req({ name: 'דור פרץ' })), null); // Hebrew only: the foreign press writes it in Latin letters
  assert.equal(cleanRequest(req({ team: '' })), null);
  const r = cleanRequest(req({ country: 'atlantis', sport: 'tennis', role: 'owner', evil: 1 }));
  assert.deepEqual([r.country, r.sport, r.role, r.evil], ['other', 'football', 'player', undefined]);
});

test('an approved suggestion becomes an athlete found in Hebrew and English headlines', () => {
  const a = toAthlete({ ...cleanRequest(req()), status: 'approved' });
  assert.equal(a.user, true);
  assert.deepEqual(a.alt, ['Peretz', 'פרץ']);
  const m = buildMatchers([a], {});
  assert.ok(m.players('dor peretz scores again for venezia').includes('Dor Peretz'));
  assert.ok(m.players('דור פרץ כבש לוונציה'.toLowerCase()).includes('Dor Peretz'));
});

test('suggest → the admin gets ✅ / ❌ links → a signed ✅ adds the person for everyone; 🗑️ removes', async () => {
  const t1 = fakeTg();
  const r1 = await processAthleteRequests({}, [req()], { now, builtin, env, tg: t1.tg });
  const ask = t1.calls.find((c) => c.method === 'sendMessage');
  assert.match(ask.body.text, /Dor Peretz/);
  assert.match(ask.body.text, /דני/);
  const [ok] = ask.body.reply_markup.inline_keyboard[0];
  assert.match(ok.url, /approve\.html#a=ok&id=[a-f0-9]{8}&h=Dor%20Peretz&k=p&s=[a-f0-9]{24}$/);
  assert.deepEqual(userAthletes(r1.userAthletes, builtin), []); // nothing before the ✅
  assert.equal(JSON.stringify(r1.userAthletes.list).includes('דני'), false); // the editor's name isn't kept

  const forged = await processAthleteRequests(r1.userAthletes, [], { now, builtin, env, tg: fakeTg().tg, decisions: [{ ...fromLink(ok.url), s: '0'.repeat(24) }] });
  assert.equal(forged.userAthletes.list[0].status, 'pending');
  const t2 = fakeTg();
  const r2 = await processAthleteRequests(r1.userAthletes, [], { now, builtin, env, tg: t2.tg, decisions: [fromLink(ok.url)] });
  assert.equal(r2.userAthletes.list[0].status, 'approved');
  const [added] = userAthletes(r2.userAthletes, builtin);
  assert.equal(added.name, 'Dor Peretz');
  assert.equal(publicAthleteList(r2.userAthletes)[0].status, 'approved');
  const rm = t2.calls.find((c) => c.method === 'editMessageText').body.reply_markup.inline_keyboard[0][0].url;
  const r3 = await processAthleteRequests(r2.userAthletes, [], { now, builtin, env, tg: fakeTg().tg, decisions: [fromLink(rm)] });
  assert.deepEqual(userAthletes(r3.userAthletes, builtin), []);
});

test('someone already on the list (built-in or suggested) is noted, not asked again', async () => {
  const t = fakeTg();
  const r = await processAthleteRequests({}, [req({ name: 'Oscar Gloukh', name_he: '', team: 'Ajax' }), req(), req({ name_he: '' })], { now, builtin, env, tg: t.tg });
  assert.deepEqual(r.userAthletes.list.map((e) => [e.name, e.status]), [['Oscar Gloukh', 'exists'], ['Dor Peretz', 'pending'], ['Dor Peretz', 'exists']]);
  assert.equal(t.calls.filter((c) => c.method === 'sendMessage').length, 1);
});

test('the feedback channel carries suggestions (20 a day per device)', async () => {
  const lines = [];
  for (let i = 0; i < 7; i++) lines.push(JSON.stringify({ id: `m${i}`, event: 'message', time: now / 1000, message: JSON.stringify({ v: 1, device: 'dev1', type: 'athlete', name: `Player Number${i}`, team: 'Ajax' }) }));
  const before = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, text: async () => lines.join('\n') });
  try {
    const { athleteReqs } = await loadFeedback({}, now);
    assert.equal(athleteReqs.length, 7); // under the 20-a-day limit
  } finally {
    globalThis.fetch = before;
  }
});
