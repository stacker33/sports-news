// Preloaded into the child process by scripts/profile-collector.mjs: replaces fetch so nothing leaves the machine and counts every request by
// purpose and by the collector step it happened in (globalThis.__after is set by the timer marks of the profiled copy of collect.js).
//   translation (Google web endpoints)  answered with a copy of each text (MOCK_TRANSLATE=1), so the cache fills as in a real run
//   Gemini (generativelanguage)          answered HTTP 503 at once (MOCK_AI=503), the failure the radar sees when the model is overloaded
//   everything else                      fails at once, like any failing source
// On exit it prints one line: PROFILE_FETCH {requests by purpose, by step, Gemini calls by model, translation batches, peak memory}.
const classify = (u) => {
  if (/clients5\.google\.com\/translate_a|translate\.googleapis\.com/.test(u)) return 'translate';
  if (/generativelanguage\.googleapis\.com/.test(u)) return 'gemini';
  if (/news\.google\.com\/(rss\/articles|_\/DotsSplashUi)/.test(u)) return 'google-news-decode';
  if (/news\.google\.com/.test(u)) return 'google-news-feed';
  if (/api\.telegram\.org/.test(u)) return 'telegram';
  if (/ntfy\.sh/.test(u)) return 'ntfy';
  if (/365scores/.test(u)) return '365scores';
  if (/wikipedia|wikimedia/.test(u)) return 'wikipedia';
  if (/reddit|trends\.google|googleapis\.com\/trends/.test(u)) return 'signals';
  if (/youtube|bsky|t\.me/.test(u)) return 'social-feed';
  return 'feed-or-page';
};
if (process.env.FREEZE_NOW) { // a stopped clock: same input + same code = same bytes
  const T = Number(process.env.FREEZE_NOW), RealDate = Date;
  globalThis.Date = class extends RealDate { constructor(...a) { a.length ? super(...a) : super(T); } static now() { return T; } };
}
const requests = {};
const byStage = {};
const ai = {};
let translateBatches = [];
const bump = (o, k) => { o[k] = (o[k] || 0) + 1; };
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  const kind = classify(u);
  bump(requests, kind);
  const stage = globalThis.__after || 'start';
  ((byStage[stage] ||= {})[kind] = (byStage[stage][kind] || 0) + 1);
  const resp = (status, body, headers = {}) => ({ ok: status >= 200 && status < 300, status, headers: { get: (k) => headers[String(k).toLowerCase()] ?? null }, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)), json: async () => (typeof body === 'string' ? JSON.parse(body) : body), arrayBuffer: async () => new TextEncoder().encode(typeof body === 'string' ? body : JSON.stringify(body)).buffer });
  if (kind === 'translate' && process.env.MOCK_TRANSLATE) {
    if (/clients5/.test(u)) {
      const q = new URLSearchParams(String(opts.body)).getAll('q');
      translateBatches.push(q.length);
      return resp(200, q.map((t) => [`tr:${t}`, 'xx']));
    }
    const q = decodeURIComponent((u.match(/[?&]q=([^&]*)/) || [])[1] || '').split('\n');
    translateBatches.push(q.length);
    return resp(200, [[[q.map((t) => `tr:${t}`).join('\n'), q.join('\n')]]]);
  }
  if (kind === 'gemini' && process.env.MOCK_AI === '503') {
    let model = '?';
    try { model = JSON.parse(opts.body).model; } catch {}
    ai[`${stage} ${model}`] = (ai[`${stage} ${model}`] || 0) + 1;
    return resp(503, { error: { code: 503, message: 'This model is currently experiencing high demand. Spikes in demand are usually temporary. Please try again later.', status: 'UNAVAILABLE' } });
  }
  throw new Error('network disabled in this test');
};
process.on('exit', () => process.stdout.write(`\nPROFILE_FETCH ${JSON.stringify({ requests, byStage, ai, translateBatches, maxRssMB: Math.round(process.resourceUsage().maxRSS / 1024) })}\n`));
