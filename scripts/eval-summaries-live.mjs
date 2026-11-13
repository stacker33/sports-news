// Editorial review sheet for the multi-source summaries, with the REAL model.
//
// Run it yourself, in your own shell, so the key never leaves your machine and never touches this repository:
//
//   AI_API_KEY=<your Gemini key> node scripts/eval-summaries-live.mjs --yes [--n 12] [--out review.md]
//
// It sends at most ceil(n/5) summary requests (5 stories each, n at most 15) with the pipeline as it is (src/ai.js), the cards and
// headline requests switched off (the card budget is marked spent in the throw-away state), from an EMPTY state: nothing is read from or written to the radar's saved state. It stops at the
// first error (a 429 included) and says so. Add SR_MEMORY=<state.json> to show the earlier (old format) summaries next to the new ones.
// `--mock` runs the same sheet with a canned answer and no network (to try the tool).
//
// The sheet shows, per story: the sources as sent (headlines and descriptions), the generated Hebrew summary, every claim with the
// TEXT of the source it cites (so you can judge support, not just a matching number), what the checks dropped, and the old summary.
import dns from 'node:dns';
import net from 'node:net';
import tls from 'node:tls';
import { readFileSync, writeFileSync } from 'node:fs';
// Some networks drop IPv6 to Google without an error, and Node's fetch then waits on it instead of using IPv4 ("fetch failed").
// IPv4 first fixes that, in this script only.
dns.setDefaultResultOrder('ipv4first');
import { gunzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const args = process.argv.slice(2);
const flag = (f) => args.includes(f);
const opt = (f, d) => (args.includes(f) ? args[args.indexOf(f) + 1] : d);
const mock = flag('--mock');
const HOST = new URL(process.env.AI_BASE_URL || 'https://generativelanguage.googleapis.com').hostname;

// What went wrong at the network level, without the key and without any request to the model: the error's real cause and what it usually means.
function explain(e) {
  const c = e?.cause || e;
  const codes = [c?.code, ...(c?.errors || []).map((x) => x.code + (x.address ? '@' + x.address : ''))].filter(Boolean);
  const proxy = ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy', 'ALL_PROXY'].filter((k) => process.env[k]);
  let hint = 'unknown: run with --check';
  const txt = codes.join(' ') + ' ' + (c?.message || '');
  if (/ENOTFOUND|EAI_AGAIN/.test(txt)) hint = 'DNS: the name did not resolve (offline, VPN or DNS filter)';
  else if (/ETIMEDOUT|ENETUNREACH|EHOSTUNREACH/.test(txt) && /:.*:/.test(txt)) hint = 'IPv6 route blocked (this script already prefers IPv4; check the firewall)';
  else if (/ETIMEDOUT|ENETUNREACH|EHOSTUNREACH|timeout/i.test(txt)) hint = 'connection timed out or no route: firewall, VPN or proxy';
  else if (/CERT|SELF_SIGNED|UNABLE_TO_VERIFY|ERR_TLS|SSL/i.test(txt)) hint = 'TLS: a security product or proxy is replacing the certificate (set NODE_EXTRA_CA_CERTS to its root certificate)';
  else if (/ECONNREFUSED|ECONNRESET|socket hang up/.test(txt)) hint = 'connection refused or reset: firewall or proxy';
  if (proxy.length) hint += ` | a proxy variable is set (${proxy.join(', ')}); Node's fetch ignores it`;
  return `${e?.name || 'Error'}: ${e?.message}; cause: ${codes.join(',') || c?.message || '-'}; host: ${HOST}; ${hint}`;
}

// --check: DNS, then a TCP and a TLS handshake to the model's host. No HTTP request, no key, no quota.
if (flag('--check')) {
  const step = async (label, f) => { const t0 = Date.now(); try { console.log(label.padEnd(14), 'OK  ', Date.now() - t0 + 'ms', (await f()) ?? ''); } catch (e) { console.log(label.padEnd(14), 'FAIL', e.code || '', e.message); } };
  await step('DNS IPv4', async () => (await dns.promises.resolve4(HOST)).slice(0, 2).join(','));
  await step('DNS IPv6', async () => (await dns.promises.resolve6(HOST)).slice(0, 1).join(','));
  for (const family of [4, 6]) await step('TCP 443 IPv' + family, () => new Promise((res, rej) => { const sock = net.connect({ host: HOST, port: 443, family, timeout: 6000 }, () => { sock.destroy(); res(); }); sock.on('error', rej); sock.on('timeout', () => { sock.destroy(); rej(new Error('timeout')); }); }));
  await step('TLS', () => new Promise((res, rej) => { const sock = tls.connect({ host: HOST, port: 443, servername: HOST, timeout: 6000 }, () => { const r = `${sock.getProtocol()} verified=${sock.authorized}${sock.authorizationError ? ' ' + sock.authorizationError : ''}`; sock.destroy(); res(r); }); sock.on('error', rej); sock.on('timeout', () => { sock.destroy(); rej(new Error('timeout')); }); }));
  console.log('Node', process.version, '| IPv6 failing while IPv4 works is the usual cause of "fetch failed"; this script now prefers IPv4.');
  process.exit(0);
}
const n = Math.min(15, Math.max(1, Number(opt('--n', 12))));
if (!mock && (!flag('--yes') || !process.env.AI_API_KEY)) {
  console.error('Needs AI_API_KEY in your environment and --yes. It sends about ' + Math.ceil(n / 5) + ' requests to the model (the free quota). Use --mock to try the tool without the network.');
  process.exit(2);
}
if (mock) process.env.AI_API_KEY = 'mock';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const { aiSummaries } = await import('../src/ai.js');
const SS = await import('../src/storysum.js');
const fx = JSON.parse(gunzipSync(readFileSync(join(ROOT, 'test', 'fixtures', 'summaries', 'stories.json.gz'))).toString('utf8'));
const old = process.env.SR_MEMORY ? JSON.parse(readFileSync(process.env.SR_MEMORY, 'utf8')).ai?.res || {} : {};

// the stories: a spread of the fixture's kinds, then the rest
const order = ['transfer', 'official', 'reporter', 'duplicates', 'hebrew+foreign', 'headlines-only', 'large', 'general'];
const picked = [];
for (let round = 0; picked.length < n && round < 6; round++) for (const l of order) { const s = fx.stories.filter((x) => x.label === l)[round]; if (s && picked.length < n) picked.push(s); }
const mk = (s) => {
  const members = s.members.map((m) => ({ ...m }));
  const first = Math.min(...members.map((m) => m.published));
  return { label: s.label, title: members[0].title, lang: members[0].lang, first, score: 1, sport: 'football', sourceCount: new Set(members.map((m) => String(m.publisher).toLowerCase())).size, _members: members, tags: [] };
};
const stories = picked.map(mk);

// count every request and its tokens; stop at the first failure
const realFetch = globalThis.fetch;
const calls = [];
let netError = null;
globalThis.fetch = async (url, init) => {
  if (mock) {
    const body = JSON.parse(init.body);
    const user = body.messages[1].content;
    const out = { stories: [...user.matchAll(/### id: (s\d+)\n([\s\S]*?)(?=\n### id:|$)/g)].map(([, id, block]) => {
      const first = (block.match(/\n(S\d+) \(/) || [])[1];
      return { id, title_he: 'כותרת לדוגמה', summary_he: 'סיכום לדוגמה של הסיפור לפי המקורות.', summary_en: 'Example.', facts_he: [], claims: first ? [{ he: 'עובדה לדוגמה', src: [first], kind: 'reported' }] : [], added: [], conflicts: [] };
    }) };
    const sys = body.messages[0].content;
    calls.push({ ok: true, tokens: 0, kind: /numbered sports headlines/.test(sys) ? 'heads' : /story cards/.test(sys) ? 'cards' : 'summary', n: user.split('### id:').length - 1 });
    return { ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: JSON.stringify(out) } }], usage: { total_tokens: 0 } }) };
  }
  let res;
  try { res = await realFetch(url, init); } catch (e) { netError = explain(e); throw e; } // the key is never part of the message
  const text = await res.text();
  let tokens = 0;
  try { tokens = JSON.parse(text).usage?.total_tokens || 0; } catch {}
  calls.push({ ok: res.ok, status: res.status, tokens, model: JSON.parse(init.body).model, err: res.ok ? null : text.slice(0, 200) });
  return { ok: res.ok, status: res.status, text: async () => text };
};

// the card step is switched off by a state that says today's card budget is spent (an env value of 0 would mean the default)
// the radar only summarises stories under 18 hours old: for this review every story is treated as one hour old
const now = Date.now();
for (const s of stories) s.first = now - 3600e3;
let st = { cls: { day: new Date(now).toISOString().slice(0, 10), used: 1e9 } }; // today's card budget marked spent: no card requests
const errors = [];
for (let i = 0; i < stories.length; i += 5) {
  const batch = stories.slice(i, i + 5);
  const r = await aiSummaries(batch, {}, st, now, new Map(), {});
  st = r.ai;
  if (st.error) { errors.push(netError ? `${st.error} -- ${netError}` : st.error); break; }
  if (calls.length > Math.ceil(n / 5)) { errors.push('more requests than planned: stopped'); break; }
}
globalThis.fetch = realFetch;

// ---- the sheet ----
const keyOf = (s) => [...s._members].sort((a, b) => a.published - b.published || (a.id < b.id ? -1 : 1))[0].id;
const clip = (t, k) => (t && t.length > k ? t.slice(0, k - 1) + '…' : t || '');
const L = [];
L.push(`# Summary review sheet (${mock ? 'MOCK, no model' : 'real model'})`, '');
L.push(`Requests: ${calls.length} (planned at most ${Math.ceil(n / 5)}). Tokens: ${calls.reduce((s, c) => s + c.tokens, 0)}. Models: ${[...new Set(calls.map((c) => c.model).filter(Boolean))].join(', ') || '-'}. HTTP statuses: ${calls.map((c) => c.status || 200).join(', ') || '-'}. Errors: ${errors.join(' | ') || 'none'}.`, '');
L.push('Judge each claim against the cited source TEXT shown with it: supported / partly / not supported; then note invented details, misleading attribution, missing uncertainty, awkward Hebrew, omissions.', '');
stories.forEach((s, i) => {
  const res = st.res?.[keyOf(s)];
  const sel = SS.selectSources(s._members, {});
  L.push(`## ${i + 1}. [${s.label}] ${clip(s.title, 110)}`, '', `${sel.total} outlets, ${sel.sel.length} sent, ${sel.copies} copies dropped, ${sel.omitted} omitted.`, '', '**Sources as sent**', '');
  for (const x of sel.sel) L.push(`- ${x.sid} ${x.m.publisher}${x.official ? ' (official)' : ''}${x.reporter ? ' (journalist)' : ''} [${x.m.lang}]: ${clip(x.m.title, 200)}${x.desc ? `\n  - description: ${clip(x.desc, 320)}` : '\n  - (headline only)'}`);
  L.push('');
  if (!res) { L.push('**No summary was produced** (error or rejected answer).', ''); return; }
  L.push('**Summary (new)**', '', `> ${res.title_he}`, `> ${res.summary_he}`, '');
  const byId = new Map((res.rich?.sel || []).map((x) => [x.sid, sel.sel.find((y) => y.sid === x.sid)]));
  const cite = (sid) => { const y = byId.get(sid) || sel.sel.find((z) => z.sid === sid); return y ? `${y.m.publisher}: "${clip(y.m.title, 160)}"${y.desc ? ` / "${clip(y.desc, 200)}"` : ''}` : '?'; };
  L.push('**Claims**', '');
  for (const c of res.rich?.claims || []) L.push(`- [${c.kind}] ${c.he}\n  - cites ${c.src.map((q) => `${q} → ${cite(q)}`).join('\n  - cites ')}`);
  for (const a of res.rich?.added || []) L.push(`- [added by ${a.src}] ${a.he}\n  - source text: ${cite(a.src)}`);
  for (const k of res.rich?.conflicts || []) L.push(`- [conflict${k.det ? ', deterministic' : ''}] ${k.topic_he}: ${k.positions.map((p) => `${p.src}: ${p.he}`).join(' | ')}`);
  if (!(res.rich?.claims || []).length) L.push('- (none survived the checks)');
  L.push('', `Checks dropped so far in this run: ${JSON.stringify({ claims: st.rich?.droppedClaims, other: st.rich?.droppedOther })}`, '');
  const o = old[keyOf(s)];
  L.push('**Old format**', '', o ? `> ${o.summary_he}` : '(no earlier summary for this story)', '');
});
const out = opt('--out', mock ? 'summary-review-sheet.mock.md' : 'summary-review-sheet.md');
writeFileSync(out, L.join('\n'));
if (mock) console.log(calls.map((c) => c.kind + ':' + c.n).join(' '));
console.log(`wrote ${out}: ${stories.length} stories, ${calls.length} requests, ${calls.reduce((s, c) => s + c.tokens, 0)} tokens, errors: ${errors.join(' | ') || 'none'}`);
