// ➕ Sources added by editors from the page. Shared by everyone: the request goes through the feedback channel, the
// collector finds the site's feed and sends the admin a private Telegram message with ✅ / ❌ buttons, and an approved
// site is read from the next run on, for every editor. Nothing joins the radar without the admin's ✅.
//
// - The site's own RSS/Atom feed when it has one (declared in the page, or the usual /feed/, /rss paths); otherwise
//   Google News for that site (the same way many built-in sources are read).
// - Added sources are cautious: weight 1, "mixed" unless the address says sport (non-sport items are dropped), and foreign-language sites only show
//   stories with a known team / player or an Israeli angle ("assist"), like the desk's foreign sites.
// - The admin's button presses are read with Telegram's getUpdates every run (the bot has no webhook). Only presses
//   by TELEGRAM_ADMIN_CHAT count. An approved source keeps a 🗑️ button in that message to remove it later.

import { randomBytes } from 'node:crypto';
import { fetchFeed, decodeEntities } from './feeds.js';
import { gnews, GN_LOCALES } from '../config/sources.js';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36';
const API = 'https://api.telegram.org/bot';
const PER_RUN = 2; // finding a feed can take several requests: the rest wait for the next run
const KEEP_DAYS = 14; // pending / rejected / removed entries are forgotten after this (approved ones stay)
const QUEUE_HOURS = 24;

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
export const hostOf = (u) => {
  try {
    return new URL(u).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
};

// hosts the radar already reads (direct feeds and "site:" Google News queries)
export function builtinHosts(sources) {
  const hosts = new Set();
  for (const s of sources) {
    if (!s.url) continue;
    const site = s.google ? decodeURIComponent(s.url).match(/site:([^\s/&]+)/)?.[1] : null;
    const h = site ? site.toLowerCase().replace(/^www\./, '') : s.google ? '' : hostOf(s.url);
    if (h && !/(^|\.)google\.com$/.test(h)) hosts.add(h);
  }
  return hosts;
}

// a public website address (no local / private addresses)
export function cleanUrl(raw) {
  let u;
  try {
    u = new URL(String(raw).trim());
  } catch {
    return null;
  }
  if (!/^https?:$/.test(u.protocol) || u.username || u.password || u.port) return null;
  const h = u.hostname.toLowerCase();
  if (!h.includes('.') || /^[\d.]+$/.test(h) || h.includes(':') || /(^|\.)(localhost|local|internal|lan)$/.test(h)) return null;
  u.hash = '';
  return u.href;
}

// the country ending of the address when the page doesn't say (some sites block the page fetch)
const TLD_LANG = { il: 'he', de: 'de', at: 'de', it: 'it', es: 'es', ar: 'es', mx: 'es', uy: 'es', fr: 'fr', pt: 'pt', br: 'pt', gr: 'el', cy: 'el', nl: 'nl', be: 'nl', tr: 'tr', pl: 'pl', ro: 'ro', rs: 'sr', hr: 'hr', cz: 'cs', sk: 'sk', si: 'sl', bg: 'bg', hu: 'hu', se: 'sv', no: 'no', dk: 'da', jp: 'ja', ua: 'uk', sa: 'ar', is: 'is', fi: 'fi' };
function guessLang(htmlLang, titles, host = '') {
  if (htmlLang && /^[a-z]{2}$/.test(htmlLang)) return htmlLang;
  const t = titles.join(' ');
  if (/[֐-׿]/.test(t)) return 'he';
  if (/[Ͱ-Ͽ]/.test(t)) return 'el';
  if (/[؀-ۿ]/.test(t)) return 'ar';
  if (/[぀-ヿ]/.test(t)) return 'ja';
  return TLD_LANG[host.split('.').pop()] || 'en';
}

// Find a working feed for a website: { url, google, lang, sample: [3 headlines] } or null
export async function discoverFeed(site, { fetchImpl = fetch, probe = fetchFeed } = {}) {
  let finalUrl = site;
  let htmlLang = '';
  const cands = [];
  try {
    const res = await fetchImpl(site, { headers: { 'user-agent': UA, accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' }, redirect: 'follow', signal: AbortSignal.timeout(12000) });
    if (res.ok) {
      finalUrl = res.url || site;
      const body = (await res.text()).slice(0, 1500000);
      if (/^\s*(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*<(rss|feed|rdf:RDF)\b/i.test(body)) cands.push(finalUrl);
      else {
        for (const tag of body.match(/<link\b[^>]*>/gi) || []) {
          if (!/\brel=["']?alternate\b/i.test(tag) || !/\btype=["']?application\/(rss|atom)\+xml/i.test(tag)) continue;
          const href = tag.match(/\bhref=["']([^"']+)["']/i)?.[1];
          if (!href) continue;
          try {
            cands.push(new URL(decodeEntities(href), finalUrl).href);
          } catch {}
        }
        htmlLang = (body.match(/<html\b[^>]*\blang=["']?([a-zA-Z]{2})/i)?.[1] || '').toLowerCase();
      }
    }
  } catch {}
  let origin;
  try {
    origin = new URL(finalUrl).origin;
  } catch {
    origin = new URL(site).origin;
  }
  for (const p of ['/feed/', '/rss', '/rss.xml']) cands.push(origin + p);
  const name = hostOf(site);
  for (const url of [...new Set(cands)].slice(0, 5)) {
    try {
      const items = await probe({ id: 'probe', name, url }, 10000);
      if (items.length >= 3) {
        const sample = items.slice(0, 3).map((i) => i.title);
        return { url, google: false, lang: guessLang(htmlLang, sample, name), sample };
      }
    } catch {}
  }
  // no feed of its own: Google News for that site (and section, when the address has one)
  const u = new URL(site);
  const path = u.pathname.replace(/\/+$/, '');
  const lang0 = guessLang(htmlLang, [], name);
  const url = gnews(`site:${hostOf(site)}${path} when:1d`, GN_LOCALES[lang0] ? lang0 : 'en');
  try {
    const items = await probe({ id: 'probe', name, url, google: true }, 10000);
    if (items.length) {
      const sample = items.slice(0, 3).map((i) => i.title);
      return { url, google: true, lang: guessLang(htmlLang, sample, name), sample };
    }
  } catch {}
  return null;
}

async function tgCall(method, body, { env = process.env } = {}) {
  const res = await fetch(`${API}${env.TELEGRAM_BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  const j = await res.json().catch(() => ({}));
  if (!j.ok) throw new Error(`Telegram ${method} ${res.status}: ${j.description || 'error'}`); // never the URL (it holds the token)
  return j.result;
}

const LANG_HE = { he: 'עברית', en: 'אנגלית', es: 'ספרדית', it: 'איטלקית', fr: 'צרפתית', de: 'גרמנית', pt: 'פורטוגזית', nl: 'הולנדית', el: 'יוונית', tr: 'טורקית', ar: 'ערבית', ru: 'רוסית', ja: 'יפנית' };
function requestText(e) {
  const lines = [
    `➕ <b>בקשה להוסיף מקור לרדאר</b>${e.by ? ` מ${esc(e.by)}` : ''}`,
    `<b>${esc(e.name)}</b>`,
    esc(e.site),
    e.google ? 'אין לאתר פיד RSS: ייקרא דרך Google News' : `פיד: ${esc(e.url)}`,
    `שפה: ${esc(LANG_HE[e.lang] || e.lang)}${['he', 'en'].includes(e.lang) ? '' : ' (יוצגו רק ידיעות עם קבוצה / שחקן מוכרים או זווית ישראלית)'}`,
  ];
  if (e.note) lines.push(`הערה: ${esc(e.note)}`);
  if (e.sample?.length) lines.push('', 'כותרות לדוגמה:', ...e.sample.map((t) => `• ${esc(t)}`));
  return lines.join('\n');
}
const DONE = { approved: '✅ <b>אושר</b>: נקרא בכל ריצה, אצל כל העורכים', rejected: '❌ <b>נדחה</b>', removed: '🗑️ <b>הוסר מהרדאר</b>' };

// prev = { offset, list: [entry], queue: [request], error }
// entry = { id, site, host, name, url, google, lang, sample, status, at, decided?, msg? }
// status: pending (waiting for the admin) | approved | rejected | removed | exists (already in the radar) | failed (no feed found)
export async function processSourceRequests(prev = {}, requests = [], { now = Date.now(), known = new Set(), env = process.env, discover = discoverFeed, tg = tgCall } = {}) {
  const st = {
    offset: prev.offset || 0,
    list: (prev.list || []).filter((e) => e.status === 'approved' || now - (e.decided || e.at) < KEEP_DAYS * 864e5),
    queue: [...(prev.queue || []), ...requests].filter((r) => now - r.at < QUEUE_HOURS * 3600e3),
    error: null,
  };
  const admin = env.TELEGRAM_ADMIN_CHAT;
  if (!env.TELEGRAM_BOT_TOKEN || !admin) return { userSources: { ...st, error: 'no admin chat' }, changed: 0 };
  const call = (m, b) => tg(m, b, { env });
  let changed = 0;

  // 1. the admin's button presses
  try {
    const updates = await call('getUpdates', { offset: st.offset || undefined, timeout: 0, limit: 100, allowed_updates: ['callback_query'] });
    // diagnostics (no ids, no text): when Telegram was asked, how many updates came back, of which kinds
    st.poll = { at: now, got: (updates || []).length, kinds: [...new Set((updates || []).map((u) => Object.keys(u).find((k) => k !== 'update_id')))].slice(0, 5) };
    for (const u of updates || []) {
      st.offset = Math.max(st.offset, u.update_id + 1);
      const cq = u.callback_query;
      const m = /^us:(ok|no|rm):([a-f0-9]{8})$/.exec(cq?.data || '');
      if (!m) continue;
      const answer = (text) => call('answerCallbackQuery', { callback_query_id: cq.id, text }).catch(() => {}); // too late after ~15 min: fine
      if (String(cq.from?.id) !== String(admin)) {
        await answer('רק המנהל יכול לאשר מקורות');
        continue;
      }
      const e = st.list.find((x) => x.id === m[2]);
      if (!e) {
        await answer('הבקשה לא נמצאה (אולי פגה)');
        continue;
      }
      const next = m[1] === 'ok' ? 'approved' : m[1] === 'no' ? 'rejected' : 'removed';
      const allowed = next === 'removed' ? e.status === 'approved' : e.status === 'pending';
      if (allowed) {
        e.status = next;
        e.decided = now;
        changed++;
      }
      await answer(allowed ? (next === 'approved' ? 'אושר' : next === 'rejected' ? 'נדחה' : 'הוסר') : 'כבר טופל');
      if (e.msg) {
        const keyboard = e.status === 'approved' ? { inline_keyboard: [[{ text: '🗑️ להסיר מהרדאר', callback_data: `us:rm:${e.id}` }]] } : { inline_keyboard: [] };
        await call('editMessageText', { chat_id: admin, message_id: e.msg, text: `${requestText(e)}\n\n${DONE[e.status] || ''}`, parse_mode: 'HTML', link_preview_options: { is_disabled: true }, reply_markup: keyboard }).catch(() => {});
      }
    }
  } catch (err) {
    st.error = String(err.message || err).slice(0, 200); // e.g. a webhook set on the bot (409): presses wait
  }

  // 2. new requests: find the feed, then ask the admin
  const later = [];
  let done = 0;
  for (const r of st.queue) {
    if (done >= PER_RUN) {
      later.push(r);
      continue;
    }
    const site = cleanUrl(r.url);
    const host = site && hostOf(site);
    if (!host) continue;
    // the same site twice (waiting, approved or recently decided) is one request
    if (st.list.some((e) => e.host === host && e.status !== 'removed')) continue;
    done++;
    const base = { id: randomBytes(4).toString('hex'), site, host, name: r.name || host, at: now };
    if (known.has(host)) {
      st.list.push({ ...base, status: 'exists' });
      changed++;
      continue;
    }
    const feed = await discover(site).catch(() => null);
    if (!feed) {
      st.list.push({ ...base, status: 'failed' });
      changed++;
      await call('sendMessage', { chat_id: admin, text: `➕ <b>בקשה להוסיף מקור</b>${r.by ? ` מ${esc(r.by)}` : ''}\n${esc(site)}\nלא מצאתי באתר ידיעות לקריאה (אין פיד, ו-Google News לא מחזיר ממנו כלום). הבקשה לא נוספה.`, parse_mode: 'HTML', link_preview_options: { is_disabled: true } }).catch(() => {});
      continue;
    }
    const e = { ...base, url: feed.url, google: feed.google, lang: feed.lang, sample: feed.sample, status: 'pending' };
    try {
      const msg = await call('sendMessage', {
        chat_id: admin,
        text: requestText({ ...e, by: r.by, note: r.note }),
        parse_mode: 'HTML',
        link_preview_options: { is_disabled: true },
        reply_markup: { inline_keyboard: [[{ text: '✅ לאשר', callback_data: `us:ok:${e.id}` }, { text: '❌ לדחות', callback_data: `us:no:${e.id}` }]] },
      });
      e.msg = msg?.message_id;
      st.list.push(e);
      changed++;
    } catch (err) {
      st.error = String(err.message || err).slice(0, 200);
      later.push(r); // Telegram unreachable: ask again next run
    }
  }
  st.queue = later;
  return { userSources: st, changed };
}

// a sports site or section by its address or name (otherwise its non-sport items are dropped)
export const sportSite = (e) => /sport|spor|deport|desport|calcio|futbol|football|soccer|basket|kosar|ספורט|כדור/i.test(`${e.site} ${e.url} ${e.name}`);

// Approved sites as radar sources
export function userSources(st = {}) {
  return (st.list || [])
    .filter((e) => e.status === 'approved' && e.url)
    .map((e) => ({
      id: `u-${e.id}`,
      name: e.name,
      url: e.url,
      lang: e.lang || 'en',
      weight: 1,
      ...(sportSite(e) ? {} : { mixed: true }), // a general-news site: only its sport items
      every: e.google ? 5 : 3,
      ...(e.google ? { google: true } : {}),
      ...(['he', 'en'].includes(e.lang) ? {} : { assist: true }),
      user: true,
    }));
}

// For the page's system panel: what was asked and what happened (no editor names)
export const publicList = (st = {}) => (st.list || []).map((e) => ({ name: e.name, host: e.host, status: e.status, at: e.at, decided: e.decided || null }));
