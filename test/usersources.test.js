import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SOURCES } from '../config/sources.js';
import { cleanUrl, builtinHosts, discoverFeed, processSourceRequests, userSources, publicList, signDecision, validDecision } from '../src/usersources.js';
import { loadFeedback } from '../src/feedback.js';

const now = Date.parse('2026-10-23T10:00:00Z');
const env = { TELEGRAM_BOT_TOKEN: 'test-token', TELEGRAM_ADMIN_CHAT: '111' };

test('only public website addresses are accepted', () => {
  assert.equal(cleanUrl('https://www.marca.com/futbol/'), 'https://www.marca.com/futbol/');
  for (const bad of ['http://localhost/feed', 'http://127.0.0.1/', 'http://10.0.0.1/rss', 'https://user:pw@site.com/', 'https://site.com:8080/', 'ftp://site.com/', 'javascript:alert(1)', 'https://intranet/', 'not a url']) assert.equal(cleanUrl(bad), null, bad);
});

test('sites the radar already reads are recognised (direct feeds and Google News "site:")', () => {
  const hosts = builtinHosts(SOURCES);
  for (const h of ['one.co.il', 'sport5.co.il', 'gazzetta.it', 'bild.de', 'digisport.ro']) assert.ok(hosts.has(h), h);
  assert.ok(![...hosts].some((h) => h.endsWith('google.com')));
});

const page = (links) => ({ ok: true, url: 'https://www.site.gr/', text: async () => `<html lang="el"><head>${links}</head><body></body></html>` });

test('a declared RSS feed is found and tested; without one, Google News for the site', async () => {
  const probed = [];
  const probe = async (src) => {
    probed.push(src.url);
    if (src.url === 'https://www.site.gr/rss/sport.xml') return [{ title: 'Α' }, { title: 'Β' }, { title: 'Γ' }, { title: 'Δ' }];
    if (src.google) return [{ title: 'Ολυμπιακός νίκη' }];
    throw new Error('HTTP 404');
  };
  const direct = await discoverFeed('https://www.site.gr/', { fetchImpl: async () => page('<link rel="alternate" type="application/rss+xml" href="/rss/sport.xml">'), probe });
  assert.deepEqual({ url: direct.url, google: direct.google, lang: direct.lang }, { url: 'https://www.site.gr/rss/sport.xml', google: false, lang: 'el' });
  assert.equal(direct.sample.length, 3);
  const viaGoogle = await discoverFeed('https://www.other.gr/podosfairo/', { fetchImpl: async () => page(''), probe });
  assert.equal(viaGoogle.google, true);
  assert.match(decodeURIComponent(viaGoogle.url), /site:other\.gr\/podosfairo when:1d/);
  assert.match(viaGoogle.url, /hl=el/);
  const none = await discoverFeed('https://www.dead.gr/', { fetchImpl: async () => ({ ok: false }), probe: async () => [] });
  assert.equal(none, null);
});

// a fake Telegram: records calls
function fakeTg() {
  const calls = [];
  let msgId = 500;
  const tg = async (method, body) => {
    calls.push({ method, body });
    if (method === 'sendMessage') return { message_id: ++msgId };
    return true;
  };
  return { tg, calls };
}
const feed = { url: 'https://www.site.gr/rss', google: false, lang: 'el', sample: ['Α', 'Β', 'Γ'] };
// what the approve page posts when the admin confirms a link
const fromLink = (url) => {
  const q = new URLSearchParams(new URL(url).hash.slice(1));
  return { a: q.get('a'), id: q.get('id'), s: q.get('s') };
};

test('decision links are signed with the bot token; a forged or edited link is refused', () => {
  const sig = signDecision('test-token', 'ok', 'abcd1234');
  assert.match(sig, /^[a-f0-9]{24}$/);
  assert.equal(validDecision('test-token', 'ok', 'abcd1234', sig), true);
  assert.equal(validDecision('test-token', 'rm', 'abcd1234', sig), false); // the ✅ signature doesn't remove
  assert.equal(validDecision('test-token', 'ok', 'abcd1235', sig), false);
  assert.equal(validDecision('other-token', 'ok', 'abcd1234', sig), false);
  assert.equal(validDecision('test-token', 'ok', 'abcd1234', 'x'.repeat(24)), false);
  assert.equal(validDecision('', 'ok', 'abcd1234', sig), false);
});

test('a request asks the admin with ✅ / ❌ links; only a signed decision counts; approved sites become cautious sources', async () => {
  const t1 = fakeTg();
  const r1 = await processSourceRequests({}, [{ url: 'https://www.site.gr/', name: 'Site GR', by: 'דני', note: 'כדורגל יווני', at: now }], { now, env, known: new Set(), discover: async () => feed, tg: t1.tg });
  const ask = t1.calls.find((c) => c.method === 'sendMessage');
  assert.equal(ask.body.chat_id, '111');
  assert.match(ask.body.text, /דני/);
  const [ok, no] = ask.body.reply_markup.inline_keyboard[0];
  assert.match(ok.url, /^https:\/\/stacker33\.github\.io\/sports-news\/approve\.html#a=ok&id=[a-f0-9]{8}&h=site\.gr&s=[a-f0-9]{24}$/);
  assert.match(no.url, /#a=no&/);
  assert.equal(ok.url.includes('test-token'), false); // the token itself never appears
  const e = r1.userSources.list[0];
  assert.equal(e.status, 'pending');
  assert.equal(JSON.stringify(r1.userSources.list).includes('דני'), false); // the editor's name is not kept in the state
  assert.deepEqual(userSources(r1.userSources), []); // nothing joins before the ✅

  // a forged decision is ignored; then the admin's signed ✅
  const t2 = fakeTg();
  const forged = { a: 'ok', id: e.id, s: '0'.repeat(24) };
  const r2a = await processSourceRequests(r1.userSources, [], { now: now + 300e3, env, discover: async () => assert.fail('no new request'), tg: t2.tg, decisions: [forged] });
  assert.equal(r2a.userSources.list[0].status, 'pending');
  const r2 = await processSourceRequests(r2a.userSources, [], { now: now + 300e3, env, tg: t2.tg, decisions: [fromLink(ok.url)] });
  assert.equal(r2.userSources.list[0].status, 'approved');
  const edit = t2.calls.find((c) => c.method === 'editMessageText');
  assert.match(edit.body.text, /אושר/);
  const rm = edit.body.reply_markup.inline_keyboard[0][0];
  assert.match(rm.url, /#a=rm&/); // a 🗑️ link for later
  const [src] = userSources(r2.userSources);
  assert.equal(src.url, feed.url);
  assert.equal(src.weight, 1);
  assert.equal(src.assist, true); // Greek: only stories with a known team / player or an Israeli angle
  assert.equal(src.mixed, true); // the address doesn't say sport: non-sport items are dropped
  assert.equal(publicList(r2.userSources)[0].status, 'approved');

  // replaying the ✅ later changes nothing; 🗑️ removes it
  const t3 = fakeTg();
  const r3 = await processSourceRequests(r2.userSources, [], { now: now + 600e3, env, tg: t3.tg, decisions: [fromLink(rm.url), fromLink(ok.url)] });
  assert.equal(r3.userSources.list[0].status, 'removed');
  assert.deepEqual(userSources(r3.userSources), []);
});

test('a request asked with the old buttons gets the link buttons', async () => {
  const t = fakeTg();
  const old = { list: [{ id: 'abcd1234', site: 'https://visir.is/', host: 'visir.is', name: 'visir.is', url: 'https://x/rss', status: 'pending', at: now, msg: 108 }] };
  const r = await processSourceRequests(old, [], { now, env, tg: t.tg });
  const upd = t.calls.find((c) => c.method === 'editMessageReplyMarkup');
  assert.equal(upd.body.message_id, 108);
  assert.match(upd.body.reply_markup.inline_keyboard[0][0].url, /#a=ok&id=abcd1234&h=visir\.is&s=/);
  assert.equal(r.userSources.list[0].links, true);
  const again = fakeTg();
  await processSourceRequests(r.userSources, [], { now, env, tg: again.tg });
  assert.equal(again.calls.filter((c) => c.method === 'editMessageReplyMarkup').length, 0); // once
});

test('a site already in the radar, a repeat request, or no admin chat: no question asked', async () => {
  const t = fakeTg();
  const r = await processSourceRequests({}, [{ url: 'https://www.one.co.il/', at: now }, { url: 'https://one.co.il/x', at: now }], { now, env, known: builtinHosts(SOURCES), discover: async () => assert.fail('not probed'), tg: t.tg });
  assert.deepEqual(r.userSources.list.map((x) => x.status), ['exists']);
  assert.equal(t.calls.filter((c) => c.method === 'sendMessage').length, 0);
  const off = await processSourceRequests({}, [{ url: 'https://www.site.gr/', at: now }], { now, env: {}, discover: async () => assert.fail(), tg: async () => assert.fail() });
  assert.equal(off.userSources.list.length, 0);
});

test('a site with sport in its address is not filtered as general news', async () => {
  const t = fakeTg();
  const r = await processSourceRequests({}, [{ url: 'https://www.marca.com/futbol/', at: now }], { now, env, known: new Set(), discover: async () => ({ url: 'https://e00-marca.uecdn.es/rss/futbol/primera-division.xml', google: false, lang: 'es', sample: ['a'] }), tg: t.tg });
  const ok = t.calls.find((c) => c.method === 'sendMessage').body.reply_markup.inline_keyboard[0][0].url;
  const r2 = await processSourceRequests(r.userSources, [], { now, env, tg: fakeTg().tg, decisions: [fromLink(ok)] });
  assert.equal(userSources(r2.userSources)[0].mixed, undefined);
});

test('the feedback channel carries mail and add-site messages with per-device limits', async () => {
  const lines = [];
  const msg = (id, j) => lines.push(JSON.stringify({ id: `m${id}`, event: 'message', time: now / 1000, message: JSON.stringify({ v: 1, device: 'dev1', ...j }) }));
  msg(1, { type: 'mail', title: 'כותרת\nשנייה', text: 'גוף', name: 'דני', to: 'evil@x.com' });
  for (let i = 0; i < 7; i++) msg(10 + i, { type: 'source', url: `https://site${i}.com/`, by: 'דני' });
  msg(30, { type: 'source', url: 'javascript:alert(1)' });
  const fetchBefore = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, text: async () => lines.join('\n') });
  try {
    const { mails, sourceReqs } = await loadFeedback({}, now);
    assert.deepEqual(mails.map(({ title, text, name }) => ({ title, text, name })), [{ title: 'כותרת שנייה', text: 'גוף', name: 'דני' }]);
    assert.equal(mails[0].to, undefined); // the recipient never comes from the message
    assert.equal(sourceReqs.length, 5); // 5 a day per device
  } finally {
    globalThis.fetch = fetchBefore;
  }
});
