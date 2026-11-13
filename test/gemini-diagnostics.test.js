import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// A fake Gemini on localhost: nothing here touches Google, a real key or the real quota.
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const KEY = 'k-test-SECRET-123';
const dir = mkdtempSync(join(tmpdir(), 'gem-'));

async function withServer(handler, fn) {
  const seen = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => (body += d));
    req.on('end', () => { seen.push({ method: req.method, url: req.url, headers: req.headers, body }); handler(req, res, body, seen); });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try { return await fn(`http://127.0.0.1:${server.address().port}/v1beta/openai`, seen); } finally { server.close(); }
}
const run = (script, args, env) => new Promise((resolve) => {
  const p = spawn(process.execPath, [script, ...args], { cwd: ROOT, env: { ...process.env, ...env } });
  let out = '', err = '';
  p.stdout.on('data', (d) => (out += d));
  p.stderr.on('data', (d) => (err += d));
  p.on('close', (status) => resolve({ status, out, err }));
});
const json = (res, status, obj) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };

test('model check: one read-only list request, key in a header only, says which configured models exist', async () => {
  await withServer((req, res) => json(res, 200, { models: [
    { name: 'models/gemini-flash-latest', supportedGenerationMethods: ['generateContent'] },
    { name: 'models/gemini-flash-lite-latest', supportedGenerationMethods: ['generateContent'] },
    { name: 'models/embedding-001', supportedGenerationMethods: ['embedContent'] },
  ] }), async (base, seen) => {
    const r = await run('scripts/check-gemini-models.mjs', [], { AI_BASE_URL: base, AI_API_KEY: KEY });
    assert.equal(r.status, 0, r.err);
    assert.equal(seen.length, 1); // exactly one request
    assert.equal(seen[0].method, 'GET');
    assert.match(seen[0].url, /^\/v1beta\/models\?/);
    assert.doesNotMatch(seen[0].url, /key=/); // the key is not in the URL
    assert.equal(seen[0].headers['x-goog-api-key'], KEY);
    assert.doesNotMatch(r.out + r.err, /SECRET/); // and never printed
    assert.match(r.out, /main \(AI_MODEL\)\s+gemini-flash-latest\s+AVAILABLE/);
    assert.match(r.out, /backup \(AI_MODEL_ALT\)\s+gemini-2\.5-flash\s+NOT LISTED.*404/);
    assert.match(r.out, /light \(AI_MODEL_FALLBACK\)\s+gemini-flash-lite-latest\s+AVAILABLE/);
    assert.doesNotMatch(r.out, /embedding-001/); // only models that can generate
  });
});

test('model check: an invalid key is explained and the key is not echoed even when the server echoes it', async () => {
  await withServer((req, res) => json(res, 400, { error: { message: `API key not valid: ${KEY}` } }), async (base) => {
    const r = await run('scripts/check-gemini-models.mjs', [], { AI_BASE_URL: base, AI_API_KEY: KEY });
    assert.equal(r.status, 1);
    assert.match(r.err, /HTTP 400/);
    assert.match(r.err, /invalid, restricted/);
    assert.doesNotMatch(r.out + r.err, /SECRET/);
  });
  const none = await run('scripts/check-gemini-models.mjs', [], { AI_API_KEY: '' });
  assert.equal(none.status, 2);
});

// the case of the last real run: main 503, backup 404, light 429
const chat = (req, res, body) => {
  const model = JSON.parse(body).model;
  if (model === 'gemini-flash-latest') return json(res, 503, { error: { code: 503, message: 'The model is overloaded' } });
  if (model === 'gemini-2.5-flash') return json(res, 404, { error: { code: 404, message: 'models/gemini-2.5-flash is not found for API version v1beta' } });
  return json(res, 429, { error: { code: 429, message: 'You exceeded your current quota' } });
};

test('review script: the backup model known to answer 404 is skipped (no wasted request); --try-alt asks for it', async () => {
  await withServer(chat, async (base, seen) => {
    const out = join(dir, 'a.md');
    const r = await run('scripts/eval-summaries-live.mjs', ['--yes', '--n', '5', '--out', out], { AI_BASE_URL: base, AI_API_KEY: KEY });
    assert.equal(r.status, 0, r.err);
    const models = seen.filter((s) => s.method === 'POST').map((s) => JSON.parse(s.body).model);
    assert.deepEqual(models, ['gemini-flash-latest', 'gemini-flash-lite-latest']); // 2 requests, none to gemini-2.5-flash
    const md = readFileSync(out, 'utf8');
    assert.match(md, /HTTP statuses: 503, 429/);
    assert.match(md, /HTTP 429/);
    assert.equal((md.match(/No summary was produced/g) || []).length, 5); // stated, nothing made up
    assert.doesNotMatch(md + r.out + r.err, /SECRET/);
  });
  await withServer(chat, async (base, seen) => {
    const r = await run('scripts/eval-summaries-live.mjs', ['--yes', '--n', '5', '--try-alt', '--out', join(dir, 'b.md')], { AI_BASE_URL: base, AI_API_KEY: KEY });
    assert.equal(r.status, 0, r.err);
    assert.deepEqual(seen.filter((s) => s.method === 'POST').map((s) => JSON.parse(s.body).model), ['gemini-flash-latest', 'gemini-2.5-flash', 'gemini-flash-lite-latest']);
  });
});

test.after(() => rmSync(dir, { recursive: true, force: true }));
