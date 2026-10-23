import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const recorder = pathToFileURL(fileURLToPath(new URL('./fixtures/record-fetch.mjs', import.meta.url))).href;

// Runs the real collector (src/collect.js) in a child process with its data directory in a temp folder and the
// network disabled; returns its exit code, the network calls it tried, the files it left and the diagnostic code.
function runCollector(stateContent) {
  const data = mkdtempSync(join(tmpdir(), 'collect-data-'));
  const errFile = join(mkdtempSync(join(tmpdir(), 'collect-err-')), '.state-error');
  if (stateContent !== undefined) writeFileSync(join(data, 'state.json'), stateContent);
  const before = readdirSync(data).sort();
  const r = spawnSync(process.execPath, ['--import', recorder, join(ROOT, 'src', 'collect.js')], {
    cwd: ROOT,
    env: { PATH: process.env.PATH, RADAR_DATA_DIR: data, STATE_ERROR_FILE: errFile },
    encoding: 'utf8',
    timeout: 60000,
  });
  return {
    status: r.status,
    calls: Number((r.stdout.match(/FETCH_CALLS (\d+)/) || [])[1]),
    filesBefore: before,
    filesAfter: readdirSync(data).sort(),
    stateAfter: existsSync(join(data, 'state.json')) ? readFileSync(join(data, 'state.json'), 'utf8') : null,
    code: existsSync(errFile) ? readFileSync(errFile, 'utf8').trim() : null,
  };
}

test('collector: a missing state stops the run with a nonzero exit, before any network call or output file', () => {
  const r = runCollector(undefined);
  assert.notEqual(r.status, 0);
  assert.equal(r.calls, 0); // no sources read, no Telegram / AI / ntfy calls
  assert.deepEqual(r.filesAfter, []); // no news.json, no state.json written: nothing to publish
  assert.equal(r.code, 'state:missing');
});

test('collector: a cut-off or malformed state stops the run and is left untouched', () => {
  for (const [content, code] of [['{"savedAt":1,"items":[{"id":"a1","titl', 'state:parse'], ['not json at all', 'state:parse']]) {
    const r = runCollector(content);
    assert.notEqual(r.status, 0);
    assert.equal(r.calls, 0);
    assert.deepEqual(r.filesAfter, r.filesBefore); // only the original state.json, no outputs
    assert.equal(r.stateAfter, content); // never overwritten
    assert.equal(r.code, code);
  }
});

test('collector: a structurally invalid state stops the run', () => {
  const content = JSON.stringify({ savedAt: 1, items: [{ id: 'a1', link: 'https://example.test/1', title: 'x' }] }); // no published
  const r = runCollector(content);
  assert.notEqual(r.status, 0);
  assert.equal(r.calls, 0);
  assert.deepEqual(r.filesAfter, ['state.json']);
  assert.equal(r.stateAfter, content);
  assert.equal(r.code, 'state:shape');
});

test('restore script (CLI): a cut-off download exits nonzero, removes the temp file, keeps the destination, sanitized code', () => {
  const d = mkdtempSync(join(tmpdir(), 'restore-'));
  const tmp = join(d, 'state.json.download'), dest = join(d, 'state.json'), err = join(d, '.state-error');
  writeFileSync(dest, JSON.stringify({ items: [] }));
  writeFileSync(tmp, '{"items":[{"id":"a1"');
  const r = spawnSync(process.execPath, [join(ROOT, 'scripts', 'restore-state.mjs'), tmp, dest, err], { encoding: 'utf8' });
  assert.equal(r.status, 1);
  assert.ok(!existsSync(tmp));
  assert.equal(readFileSync(dest, 'utf8'), JSON.stringify({ items: [] }));
  assert.equal(readFileSync(err, 'utf8').trim(), 'state:parse');
});

test('workflow: a failed restore cannot be swallowed — no fallbacks, and upload / deploy only run after success', () => {
  const yml = readFileSync(join(ROOT, '.github', 'workflows', 'collect.yml'), 'utf8').replace(/\r\n/g, '\n');
  const steps = yml.split(/\n {6}- /).slice(1);
  const find = (re) => steps.find((s) => re.test(s));
  const restore = find(/name: Restore previous state \(backup, else stop\)/);
  assert.ok(restore, 'restore step');
  assert.match(restore, /state\.json\.download/); // downloads to a temporary file
  assert.match(restore, /exit 1/); // a failed download stops the step
  assert.match(restore, /node scripts\/restore-state\.mjs public\/data\/state\.json\.download public\/data\/state\.json/);
  assert.doesNotMatch(restore, /No previous state/); // the old "continue anyway" fallback is gone
  assert.doesNotMatch(restore, /continue-on-error/);
  assert.doesNotMatch(find(/name: Collect\n/), /continue-on-error/);
  // upload and deploy carry no always() / failure() / !cancelled() condition, so a failed step before them skips them
  for (const s of steps.filter((x) => /upload-pages-artifact|deploy-pages/.test(x))) assert.doesNotMatch(s, /if:.*(always|failure|cancelled)\(/);
  // the admin alert runs only on failure and passes on just the sanitized code
  const alert = find(/name: Tell the admin/);
  assert.match(alert, /if: failure\(\)/);
  assert.match(alert, /tr -cd 'a-z:-'/);
});
