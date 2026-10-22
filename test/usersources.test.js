import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SOURCES } from '../config/sources.js';
import { cleanUrl, builtinHosts, discoverFeed, processSourceRequests, userSources, publicList } from '../src/usersources.js';
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

// a fake Telegram: records calls, serves queued updates
function fakeTg(updates = []) {
  const calls = [];
  let msgId = 500;
  const tg = async (method, body) => {
    calls.push({ method, body });
    if (method === 'getUpdates') return updates.splice(0).filter((u) => u.update_id >= (body.offset || 0));
    if (method === 'sendMessage') return { message_id: ++msgId };
    return true;
  };
  return { tg, calls };
}
const feed = { url: 'https://www.site.gr/rss', google: false, lang: 'el', sample: ['Α', 'Β', 'Γ'] };
const press = (id, data, from = 111) => ({ update_id: id, callback_query: { id: `cq${id}`, from: { id: from }, data } });

test('a request asks the admin with ✅ / ❌; only the admin can approve; approved sites become cautious sources', async () => {
  const t1 = fakeTg();
  const r1 = await processSourceRequests({}, [{ url: 'https://www.site.gr/', name: 'Site GR', by: 'דני', note: 'כדורגל יווני', at: now }], { now, env, known: new Set(), discover: async () => feed, tg: t1.tg });
  const ask = t1.calls.find((c) => c.method === 'sendMessage');
  assert.equal(ask.body.chat_id, '111');
  assert.match(ask.body.text, /דני/);
  const [ok, no] = ask.body.reply_markup.inline_keyboard[0];
  assert.match(ok.callback_data, /^us:ok:[a-f0-9]{8}$/);
  assert.match(no.callback_data, /^us:no:/);
  const e = r1.userSources.list[0];
  assert.equal(e.status, 'pending');
  assert.equal(JSON.stringify(r1.userSources.list).includes('דני'), false); // the editor's name is not kept in the state
  assert.deepEqual(userSources(r1.userSources), []); // nothing joins before the ✅

  // someone else presses ✅: ignored; then the admin does
  const t2 = fakeTg([press(10, ok.callback_data, 999), press(11, ok.callback_data)]);
  const r2 = await processSourceRequests(r1.userSources, [], { now: now + 300e3, env, discover: async () => assert.fail('no new request'), tg: t2.tg });
  assert.equal(r2.userSources.offset, 12);
  assert.equal(r2.userSources.list[0].status, 'approved');
  const edit = t2.calls.find((c) => c.method === 'editMessageText');
  assert.match(edit.body.reply_markup.inline_keyboard[0][0].callback_data, /^us:rm:/); // a 🗑️ button for later
  const [src] = userSources(r2.userSources);
  assert.equal(src.url, feed.url);
  assert.equal(src.weight, 1);
  assert.equal(src.assist, true); // Greek: only stories with a known team / player or an Israeli angle
  assert.equal(src.mixed, true); // the address doesn't say sport: non-sport items are dropped
  assert.equal(publicList(r2.userSources)[0].status, 'approved');

  // 🗑️ later removes it
  const t3 = fakeTg([press(12, `us:rm:${e.id}`)]);
  const r3 = await processSourceRequests(r2.userSources, [], { now: now + 600e3, env, tg: t3.tg });
  assert.equal(r3.userSources.list[0].status, 'removed');
  assert.deepEqual(userSources(r3.userSources), []);
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
  const id = r.userSources.list[0].id;
  const t2 = fakeTg([press(1, `us:ok:${id}`)]);
  const r2 = await processSourceRequests(r.userSources, [], { now, env, tg: t2.tg });
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
