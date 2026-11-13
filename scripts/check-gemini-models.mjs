// Which of the radar's Gemini models does THIS API key / project actually have? One read-only request ("list models"): no generation,
// no tokens, nothing from the free generation quota. The key is sent in a header, never printed, never put in a URL.
//
//   $env:AI_API_KEY = <your key, from a hidden prompt>;  node scripts/check-gemini-models.mjs
//
// It reads the same settings as the radar (AI_BASE_URL, AI_MODEL, AI_MODEL_ALT, AI_MODEL_FALLBACK) and says, for each configured model,
// whether it exists for the key and supports generateContent. A 404 on a model in the radar's logs means "not found for this API
// version / project", and a model missing from this list is the proof. A 429 or a 503 do NOT show here: those are quota and load.
import dns from 'node:dns';
dns.setDefaultResultOrder('ipv4first'); // some networks drop IPv6 to Google; Node's fetch then hangs

const BASE = (process.env.AI_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta/openai').replace(/\/$/, '');
const LIST = BASE.replace(/\/openai$/, '') + '/models';
const configured = [
  ['main (AI_MODEL)', process.env.AI_MODEL || 'gemini-flash-latest'],
  ['backup (AI_MODEL_ALT)', process.env.AI_MODEL_ALT || 'gemini-2.5-flash'],
  ['light (AI_MODEL_FALLBACK)', process.env.AI_MODEL_FALLBACK || 'gemini-flash-lite-latest'],
];
const key = process.env.AI_API_KEY;
if (!key) { console.error('Needs AI_API_KEY in your environment (see the top of this file).'); process.exit(2); }

let models = [];
let token = '';
try {
  for (let page = 0; page < 10; page++) {
    const res = await fetch(`${LIST}?pageSize=200${token ? `&pageToken=${encodeURIComponent(token)}` : ''}`, { headers: { 'x-goog-api-key': key }, signal: AbortSignal.timeout(20000) });
    const text = await res.text();
    if (!res.ok) {
      const hint = res.status === 400 || res.status === 403 ? 'the key is invalid, restricted, or the Generative Language API is not enabled for its project' : res.status === 429 ? 'rate limited (list requests have their own, much larger, limit)' : 'see the status';
      console.error(`List models failed: HTTP ${res.status} (${hint}). ${text.replace(key, '<key>').slice(0, 300)}`);
      process.exit(1);
    }
    const j = JSON.parse(text);
    models.push(...(j.models || []));
    token = j.nextPageToken || '';
    if (!token) break;
  }
} catch (e) {
  const c = e.cause || e;
  console.error(`Request failed before any answer: ${e.message}; cause: ${c.code || c.message || '-'}; endpoint host: ${new URL(LIST).host}. Run: node scripts/eval-summaries-live.mjs --check`);
  process.exit(1);
}

const short = (m) => String(m.name).replace(/^models\//, '');
const can = (m) => (m.supportedGenerationMethods || []).includes('generateContent');
const byName = new Map(models.map((m) => [short(m), m]));
console.log(`Endpoint: ${LIST.replace(/key=.*/, '')}  | models visible to this key: ${models.length}`);
for (const [role, name] of configured) {
  const m = byName.get(name);
  console.log(`${role.padEnd(26)} ${name.padEnd(28)} ${m ? (can(m) ? 'AVAILABLE (generateContent)' : 'listed but NO generateContent') : 'NOT LISTED: a request for it returns 404'}`);
}
const flash = models.filter((m) => can(m) && /flash/i.test(short(m))).map(short).sort();
console.log('\nFlash-family models this key can generate with:\n  ' + (flash.join('\n  ') || '(none)'));
console.log('\nNote: this does not show quota. 429 = quota or rate limit, 503 = the model is overloaded; both change with the hour and the project.');
