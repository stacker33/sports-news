import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// The review-sheet script, run with --mock: no network, no key. Regression: "--n" without a number became NaN, selected no story and
// wrote a sheet with only its header ("planned at most NaN").
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const run = (...a) => spawnSync(process.execPath, ['scripts/eval-summaries-live.mjs', '--mock', ...a], { cwd: ROOT, encoding: 'utf8', timeout: 60000 });
const dir = mkdtempSync(join(tmpdir(), 'sheet-'));
const sheet = (name) => join(dir, name);

test('--n 12 selects 12 distinct stories of several kinds, plans 3 requests and writes every story', () => {
  const out = sheet('a.md');
  const r = run('--n', '12', '--out', out);
  assert.equal(r.status, 0, r.stderr);
  const md = readFileSync(out, 'utf8');
  assert.doesNotMatch(md, /NaN/);
  assert.match(md, /Requests: 3 \(planned at most 3\)/);
  const heads = md.split('\n').filter((l) => l.startsWith('## '));
  assert.equal(heads.length, 12);
  assert.equal(new Set(heads).size, 12);
  assert.ok(new Set(heads.map((h) => h.match(/\[([^\]]+)\]/)[1])).size >= 5, 'a spread of story kinds');
  assert.equal((md.match(/\*\*Summary \(new\)\*\*/g) || []).length, 12);
  assert.match(r.stdout, /12 stories, 3 requests/);
  // the same with the "=" form, and the default
  assert.equal(run('--n=12', '--out', sheet('b.md')).status, 0);
  assert.equal(readFileSync(sheet('b.md'), 'utf8').split('\n').filter((l) => l.startsWith('## ')).length, 12);
  assert.equal(run('--out', sheet('c.md')).status, 0);
  assert.equal(readFileSync(sheet('c.md'), 'utf8').split('\n').filter((l) => l.startsWith('## ')).length, 12);
});

test('a bad or missing --n stops with a message and writes no sheet', () => {
  for (const args of [['--n'], ['--n', '--out', sheet('d.md')], ['--n', '12abc'], ['--n', '0'], ['--n', '16'], ['-n', '12'], ['--nn', '12'], ['12']]) {
    const out = sheet('bad.md');
    const r = run(...args.filter((x) => x !== '--out' || args.includes('--n')), '--out', out);
    assert.equal(r.status, 2, JSON.stringify(args) + ' ' + r.stdout);
    assert.ok(r.stderr.length > 10, JSON.stringify(args));
    assert.equal(existsSync(out), false, JSON.stringify(args));
  }
  assert.equal(existsSync(sheet('d.md')), false);
});

test('without --mock the script needs --yes and a key, and says so before anything else', () => {
  const r = spawnSync(process.execPath, ['scripts/eval-summaries-live.mjs', '--n', '3', '--out', sheet('e.md')], { cwd: ROOT, encoding: 'utf8', env: { ...process.env, AI_API_KEY: '' }, timeout: 60000 });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /AI_API_KEY/);
  assert.equal(existsSync(sheet('e.md')), false);
});

test.after(() => rmSync(dir, { recursive: true, force: true }));
