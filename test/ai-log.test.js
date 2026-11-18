// The [ai] diagnostic line: one per collector run, always (also with 0 requests and nothing paused), with accurate counters.
// The real collector in a child process, data in a temp folder, network replaced by test/fixtures/reliability-fetch.mjs (nothing leaves the machine).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const preload = pathToFileURL(fileURLToPath(new URL('./fixtures/reliability-fetch.mjs', import.meta.url))).href;
const MIN = 60e3;

const item = (id) => ({ id, title: `Article number ${id} about a football match`, link: `https://example.com/${id}`, publisher: 'Example', sourceId: 'one', lang: 'en', weight: 1, published: Date.now() - 60 * MIN, seen: Date.now() - 60 * MIN, sport: 'football' });
function run(env = {}, items = []) {
  const dir = mkdtempSync(join(tmpdir(), 'ailog-'));
  writeFileSync(join(dir, 'state.json'), JSON.stringify({ savedAt: Date.now() - 5 * MIN, items }));
  const scen = join(dir, 'scenario.json');
  writeFileSync(scen, JSON.stringify({}));
  const r = spawnSync(process.execPath, ['--import', preload, join(ROOT, 'src', 'collect.js')], { cwd: ROOT, env: { PATH: process.env.PATH, RADAR_DATA_DIR: dir, MOCK_SCENARIO: scen, STATE_ERROR_FILE: join(dir, '.err'), ...env }, encoding: 'utf8', timeout: 120000 });
  assert.equal(r.status, 0, r.stderr);
  return { lines: r.stdout.split('\n').filter((l) => l.startsWith('[ai] ')), out: r.stdout, state: JSON.parse(readFileSync(join(dir, 'state.json'), 'utf8')) };
}

test('0 requests and nothing paused: still exactly one [ai] line, with zero counters', () => {
  const r = run(); // no AI_API_KEY: nothing is asked
  assert.equal(r.lines.length, 1);
  assert.equal(r.lines[0], '[ai] 0 requests (0 failed) in 0 ms, failed ones 0 ms');
});

test('requests made (all failing here): one line whose counters match what was asked', () => {
  // saved foreign articles (kept 48 hours) form stories that need a card and a summary; with a key the collector asks, and the network is down
  const r = run({ AI_API_KEY: 'test-key' }, Array.from({ length: 6 }, (_, i) => item(`a${i}`)));
  assert.equal(r.lines.length, 1);
  const m = /^\[ai\] (\d+) requests \((\d+) failed\) in (\d+) ms, failed ones (\d+) ms/.exec(r.lines[0]);
  assert.ok(m, r.lines[0]);
  const [requests, failed, ms, failedMs] = m.slice(1).map(Number);
  assert.ok(requests >= 1, 'the card / summary requests were attempted: ' + r.lines[0]);
  assert.equal(failed, requests, 'the network is down in this test: every request failed');
  assert.ok(failedMs <= ms);
  assert.match(r.out, new RegExp(`AI summaries: 0 new, ${r.state.ai.used} requests today`), 'the counter in the other line agrees');
});
