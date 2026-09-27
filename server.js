// Local mode: collect every minute + serve the app + save edits to the Israelis-abroad list.
//   npm start   →  http://localhost:3000  (and your phone on the same Wi-Fi via the LAN address)
import { createServer } from 'node:http';
import { readFile, stat, writeFile, mkdir, rename } from 'node:fs/promises';
import { networkInterfaces } from 'node:os';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { collect } from './src/collect.js';
import { loadAthletes, saveAthletes } from './src/athletes.js';

const PORT = Number(process.env.PORT) || 3000;
const INTERVAL_MS = (Number(process.env.INTERVAL_MIN) || 1) * 60 * 1000;
const PUBLIC = fileURLToPath(new URL('./public/', import.meta.url));
const ROOT = fileURLToPath(new URL('./', import.meta.url));

async function readBody(req, limit = 200_000) {
  let size = 0;
  const chunks = [];
  for await (const c of req) {
    size += c.length;
    if (size > limit) throw Object.assign(new Error('too large'), { status: 413 });
    chunks.push(c);
  }
  return Buffer.concat(chunks).toString('utf8');
}

const json = (res, status, data) =>
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }).end(JSON.stringify(data));

// API: the athlete list can be edited from the app when running locally
async function api(req, res, path) {
  if (path === '/api/athletes' && req.method === 'GET') return json(res, 200, { editable: true, athletes: await loadAthletes(ROOT) });
  if (path === '/api/athletes' && req.method === 'PUT') {
    const list = JSON.parse(await readBody(req));
    if (!Array.isArray(list)) return json(res, 400, { error: 'expected a list' });
    const saved = await saveAthletes(ROOT, list);
    console.log(new Date().toLocaleTimeString(), `[athletes] list saved (${saved.length} players), collecting…`);
    await tick();
    return json(res, 200, { ok: true, athletes: saved });
  }
  // "Ignore" a suggestion for the Israelis-abroad list (remembered so it isn't suggested again)
  if (path === '/api/athletes/ignore' && req.method === 'POST') {
    const { key } = JSON.parse(await readBody(req));
    if (typeof key !== 'string' || key.length > 200) return json(res, 400, { error: 'bad key' });
    const file = join(ROOT, 'private', 'ignored.json');
    let list = [];
    try { list = JSON.parse(await readFile(file, 'utf8')); } catch {}
    if (!list.includes(key)) list.push(key);
    await mkdir(join(ROOT, 'private'), { recursive: true });
    await writeFile(file, JSON.stringify(list));
    tick(); // refresh suggestions in the background
    return json(res, 200, { ok: true });
  }
  // Reading history for the 'For you' tab — shared by every device that uses this PC (phone on Wi-Fi too)
  if (path === '/api/profile' && req.method === 'GET') return json(res, 200, await readProfile());
  if (path === '/api/profile' && req.method === 'DELETE') {
    await updateProfile(() => ({ events: [] }));
    return json(res, 200, { ok: true });
  }
  if (path === '/api/clicks' && req.method === 'POST') {
    const events = JSON.parse(await readBody(req));
    if (!Array.isArray(events)) return json(res, 400, { error: 'expected a list' });
    const profile = await updateProfile((p) => {
      const byId = new Map(p.events.map((e) => [e.id, e]));
      for (const e of events) {
        if (!e || typeof e.id !== 'string' || !Array.isArray(e.f) || !Number.isFinite(e.ts)) continue;
        if (!byId.has(e.id)) byId.set(e.id, { id: e.id.slice(0, 40), ts: e.ts, f: e.f.slice(0, 30).map((x) => String(x).slice(0, 80)) });
      }
      return { events: [...byId.values()].sort((a, b) => a.ts - b.ts).slice(-2000) };
    });
    return json(res, 200, profile);
  }
  return json(res, 404, { error: 'not found' });
}

// Stored outside public/ so it is never published
const PROFILE = join(ROOT, 'private', 'profile.json');
async function readProfile() {
  try {
    const p = JSON.parse(await readFile(PROFILE, 'utf8'));
    return { events: Array.isArray(p.events) ? p.events : [] };
  } catch {
    return { events: [] };
  }
}
// read → change → write, one at a time (PC and phone may click at the same moment)
let profileLock = Promise.resolve();
function updateProfile(change) {
  const run = profileLock.then(async () => {
    const next = change(await readProfile());
    await mkdir(join(ROOT, 'private'), { recursive: true });
    await writeFile(PROFILE + '.tmp', JSON.stringify(next));
    await rename(PROFILE + '.tmp', PROFILE);
    return next;
  });
  profileLock = run.catch(() => {});
  return run;
}

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

const server = createServer(async (req, res) => {
  try {
    let path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (path.startsWith('/api/')) return await api(req, res, path);
    if (path.endsWith('/')) path += 'index.html';
    const file = normalize(join(PUBLIC, path));
    if (!file.startsWith(normalize(PUBLIC)) || file.endsWith('state.json')) throw Object.assign(new Error(), { code: 'ENOENT' });
    await stat(file);
    let body = await readFile(file);
    const headers = { 'content-type': TYPES[extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' };
    if (/gzip/.test(req.headers['accept-encoding'] || '') && body.length > 1024) {
      body = gzipSync(body);
      headers['content-encoding'] = 'gzip';
    }
    res.writeHead(200, headers).end(body);
  } catch (e) {
    if (e.status || e instanceof SyntaxError) return json(res, e.status || 400, { error: e.message });
    res.writeHead(e.code === 'ENOENT' ? 404 : 500).end(e.code === 'ENOENT' ? 'Not found' : 'Error');
  }
});

let running = false;
async function tick() {
  while (running) await new Promise((r) => setTimeout(r, 200)); // wait for a run in progress
  running = true;
  try {
    await collect({ log: (m) => console.log(new Date().toLocaleTimeString(), m) });
  } catch (e) {
    console.error('collect failed:', e.message);
  } finally {
    running = false;
  }
}

server.listen(PORT, () => {
  const lan = Object.values(networkInterfaces())
    .flat()
    .filter((i) => i && i.family === 'IPv4' && !i.internal)
    .map((i) => `http://${i.address}:${PORT}`);
  console.log(`\n  Sports Radar running`);
  console.log(`  PC:    http://localhost:${PORT}`);
  if (lan.length) console.log(`  Phone (same Wi-Fi): ${lan.join('  ')}`);
  console.log(`  Collecting every ${INTERVAL_MS / 60000} min\n`);
  tick();
  setInterval(tick, INTERVAL_MS);
});
