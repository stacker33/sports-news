import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pickCached } from '../scripts/pick-state.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const T = 1792781729826;
const state = (savedAt, items = [{ id: 'a1', link: 'https://x/1', title: 'T', published: T - 1000 }]) => JSON.stringify({ savedAt, meta: {}, items });

function dir(files) {
  const d = mkdtempSync(join(tmpdir(), 'pick-'));
  for (const [name, body] of Object.entries(files)) writeFileSync(join(d, name), body);
  return d;
}

test('the cached memory is used only when valid and at least as new as the site’s latest publish', async () => {
  const d = dir({ 'same.json': state(T), 'newer.json': state(T + 5000), 'older.json': state(T - 300e3), 'bad.json': '{"savedAt":', 'noitems.json': JSON.stringify({ savedAt: T }), 'v.json': JSON.stringify({ generatedAt: T }) });
  const v = join(d, 'v.json');
  assert.equal((await pickCached(join(d, 'same.json'), v)).use, true);
  assert.equal((await pickCached(join(d, 'newer.json'), v)).use, true); // the last run saved but its publish failed
  assert.match((await pickCached(join(d, 'older.json'), v)).why, /older than the site/);
  assert.match((await pickCached(join(d, 'bad.json'), v)).why, /not usable \(parse\)/);
  assert.equal((await pickCached(join(d, 'noitems.json'), v)).use, false);
  assert.match((await pickCached(join(d, 'missing.json'), v)).why, /no cached copy/);
  assert.match((await pickCached(join(d, 'same.json'), join(d, 'no-version.json'))).why, /site version unknown/); // can't tell: use the site
});

test('the script copies a good cached copy into place, and writes nothing otherwise', () => {
  const d = dir({ 'c.json': state(T), 'old.json': state(T - 1), 'v.json': JSON.stringify({ generatedAt: T }), 'dest.json': 'previous' });
  const run = (cached) => spawnSync(process.execPath, [join(ROOT, 'scripts', 'pick-state.mjs'), join(d, cached), join(d, 'v.json'), join(d, 'dest.json')], { encoding: 'utf8' });
  const no = run('old.json');
  assert.equal(no.status, 2);
  assert.equal(readFileSync(join(d, 'dest.json'), 'utf8'), 'previous');
  const yes = run('c.json');
  assert.equal(yes.status, 0);
  assert.match(yes.stdout, /State restored from .*c\.json: 1 articles/);
  assert.equal(readFileSync(join(d, 'dest.json'), 'utf8'), state(T));
  assert.equal(existsSync(join(d, 'dest.json.cache')), false);
});

test('--allow-older: the newest valid copy is used even when older than the site (the site no longer has one)', async () => {
  const d = dir({ 'old.json': state(T - 300e3), 'bad.json': '{', 'v.json': JSON.stringify({ generatedAt: T }) });
  const r = await pickCached(join(d, 'old.json'), join(d, 'v.json'), { allowOlder: true });
  assert.equal(r.use, true);
  assert.equal(r.olderMin, 5);
  assert.equal((await pickCached(join(d, 'old.json'), join(d, 'none.json'), { allowOlder: true })).use, true); // version unknown
  assert.equal((await pickCached(join(d, 'bad.json'), join(d, 'v.json'), { allowOlder: true })).use, false); // never an invalid copy
});

test('workflow: newest copy → daily backup → stop; the memory is not published; saving never blocks publishing', () => {
  const yml = readFileSync(join(ROOT, '.github', 'workflows', 'collect.yml'), 'utf8').replace(/\r\n/g, '\n');
  const steps = yml.split(/\n {6}- /).slice(1);
  const i = (re) => steps.findIndex((s) => re.test(s));
  const restoreCache = steps[i(/name: Restore previous state from the Actions cache/)];
  assert.match(restoreCache, /actions\/cache\/restore@v4/);
  assert.match(restoreCache, /restore-keys: radar-state-/);
  assert.match(steps[i(/name: Use the cached state/)], /pick-state\.mjs \.state-cache\/state\.json \.site-version\.json public\/data\/state\.json --allow-older/);
  const backupRestore = steps[i(/name: Restore the daily backup from the Actions cache/)];
  assert.match(backupRestore, /if: steps\.main\.outputs\.ok != 'true'[\s\S]*restore-keys: radar-backup-/);
  const fallback = steps[i(/name: Restore previous state \(backup, else stop\)/)];
  assert.match(fallback, /if: steps\.main\.outputs\.ok != 'true'/);
  assert.match(fallback, /pick-state\.mjs \.state-backup\/state\.json[\s\S]*state:missing[\s\S]*exit 1/);
  const save = steps[i(/name: Save the new state in the Actions cache/)];
  assert.match(save, /actions\/cache\/save@v4/);
  assert.match(save, /continue-on-error: true/);
  assert.match(steps[i(/name: Save the daily backup/)], /continue-on-error: true[\s\S]*key: \$\{\{ steps\.day\.outputs\.key \}\}/);
  const cleanup = steps[i(/name: Delete older state copies/)];
  assert.match(cleanup, /continue-on-error: true[\s\S]*--key radar-state-[\s\S]*'\.\[5:\]\[\]\.id'[\s\S]*--key radar-backup-[\s\S]*'\.\[3:\]\[\]\.id'/);
  assert.match(steps[i(/name: Keep the memory off the public site/)], /rm -f public\/data\/state\.json/);
  // order: restore → collect → save → remove from the site → publish
  assert.ok(i(/name: Restore previous state from the Actions cache/) < i(/name: Collect\n/));
  assert.ok(i(/name: Collect\n/) < i(/name: Save the new state/));
  assert.ok(i(/name: Save the new state/) < i(/name: Keep the memory off the public site/));
  assert.ok(i(/name: Keep the memory off the public site/) < i(/upload-pages-artifact/));
});
