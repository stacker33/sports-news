// Preloaded into a child process by test/collector-reliability.test.js: replaces fetch so nothing leaves the machine. The sources named in the
// scenario (env MOCK_SCENARIO, a JSON file: { "<url substring>": { status, headers, body } }) answer as described; every other request fails at
// once ("network disabled"), which the collector treats as any failing source. On exit it prints the URLs of the feeds it was asked for.
import { readFileSync } from 'node:fs';
const scenario = process.env.MOCK_SCENARIO ? JSON.parse(readFileSync(process.env.MOCK_SCENARIO, 'utf8')) : {};
const asked = [];
globalThis.fetch = async (url) => {
  const u = String(url);
  const hit = Object.entries(scenario).find(([k]) => u.includes(k));
  if (!hit) throw new Error('network disabled in this test');
  asked.push(hit[0]);
  const { status = 200, headers = {}, body = '' } = hit[1];
  const h = new Map(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return { ok: status >= 200 && status < 300, status, headers: { get: (k) => h.get(String(k).toLowerCase()) ?? null }, text: async () => body, json: async () => JSON.parse(body), arrayBuffer: async () => new TextEncoder().encode(body).buffer };
};
process.on('exit', () => process.stdout.write(`\nASKED ${JSON.stringify(asked)}\n`));
