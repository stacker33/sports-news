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
  assert.match(yes.stdout, /from the Actions cache: 1 articles/);
  assert.equal(readFileSync(join(d, 'dest.json'), 'utf8'), state(T));
  assert.equal(existsSync(join(d, 'dest.json.cache')), false);
});

test('workflow: cache first, the site download as fallback, saving never blocks publishing, old copies cleaned up', () => {
  const yml = readFileSync(join(ROOT, '.github', 'workflows', 'collect.yml'), 'utf8').replace(/\r\n/g, '\n');
  const steps = yml.split(/\n {6}- /).slice(1);
  const i = (re) => steps.findIndex((s) => re.test(s));
  const restoreCache = steps[i(/name: Restore previous state from the Actions cache/)];
  assert.match(restoreCache, /actions\/cache\/restore@v4/);
  assert.match(restoreCache, /restore-keys: radar-state-/);
  const restore = steps[i(/name: Restore previous state \(cache, else the live site\)/)];
  assert.match(restore, /if node scripts\/pick-state\.mjs \.state-cache\/state\.json \.site-version\.json public\/data\/state\.json; then[\s\S]*else[\s\S]*curl[\s\S]*state\.json\.download/);
  const save = steps[i(/name: Save the new state in the Actions cache/)];
  assert.match(save, /actions\/cache\/save@v4/);
  assert.match(save, /continue-on-error: true/);
  assert.match(steps[i(/name: Delete older state copies/)], /continue-on-error: true[\s\S]*--key radar-state-[\s\S]*'\.\[5:\]\[\]\.id'/);
  // order: restore → collect → save → publish
  assert.ok(i(/name: Restore previous state from the Actions cache/) < i(/name: Collect\n/));
  assert.ok(i(/name: Collect\n/) < i(/name: Save the new state/));
  assert.ok(i(/name: Save the new state/) < i(/upload-pages-artifact/));
});
