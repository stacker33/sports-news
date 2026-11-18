// Guards the two fixes in the workflows (see docs/actions-warnings.md):
//   1. every official action runs on Node 24 ("Node.js 20 is deprecated" lists the actions that still target Node 20);
//   2. the daily backup is saved only when today's key does not exist yet ("Cache save failed." came from saving a key that was taken),
//      and the cleanup script is real shell (a literal \n had left the daily-backup cleanup unable to run).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const DIR = join(import.meta.dirname, '..', '.github', 'workflows');
const read = (f) => readFileSync(join(DIR, f), 'utf8').replace(/\r\n/g, '\n');
const files = readdirSync(DIR).filter((f) => /\.ya?ml$/.test(f));

// the first major of each official action that declares `using: node24` (checked against each action.yml on 2026-11-18)
const MIN_NODE24 = { 'actions/checkout': 6, 'actions/setup-node': 6, 'actions/cache': 5, 'actions/cache/restore': 5, 'actions/cache/save': 5, 'actions/configure-pages': 6, 'actions/upload-pages-artifact': 5, 'actions/deploy-pages': 5, 'actions/upload-artifact': 6 };

test('no official action is on a Node 20 major', () => {
  let seen = 0;
  for (const f of files) {
    for (const m of read(f).matchAll(/uses:\s*(actions\/[\w/-]+)@v(\d+)/g)) {
      seen++;
      assert.ok(MIN_NODE24[m[1]], `${f}: ${m[1]} has no known Node 24 major in this test: add it after checking its action.yml`);
      assert.ok(Number(m[2]) >= MIN_NODE24[m[1]], `${f}: ${m[1]}@v${m[2]} still targets Node 20`);
    }
  }
  assert.ok(seen >= 12, 'the workflows were read');
});

test('the daily backup is saved only when today\'s key is not taken', () => {
  const yml = read('collect.yml');
  const steps = yml.split(/\n {6}- /).slice(1);
  const at = (re) => steps.findIndex((s) => re.test(s));
  const lookup = steps[at(/name: Is today's backup already saved\?/)];
  assert.match(lookup, /id: backup-today/);
  assert.match(lookup, /uses: actions\/cache\/restore@v6/);
  assert.match(lookup, /key: \$\{\{ steps\.day\.outputs\.key \}\}/);
  assert.match(lookup, /lookup-only: true/);
  assert.doesNotMatch(lookup, /restore-keys/, 'an exact lookup: a nearby older backup must not count as today\'s');
  assert.match(lookup, /continue-on-error: true/);
  const save = steps[at(/name: Save the daily backup in the Actions cache/)];
  assert.match(save, /if: steps\.backup-today\.outputs\.cache-hit != 'true'/);
  assert.match(save, /continue-on-error: true/);
  assert.match(save, /key: \$\{\{ steps\.day\.outputs\.key \}\}/);
  assert.ok(at(/name: Day key for the backup/) < at(/name: Is today's backup already saved/) && at(/name: Is today's backup already saved/) < at(/name: Save the daily backup/));
  // the per-run state copy has a unique key (run id + attempt) and is still saved every run
  const state = steps[at(/name: Save the new state in the Actions cache/)];
  assert.match(state, /key: radar-state-\$\{\{ github\.run_id \}\}-\$\{\{ github\.run_attempt \}\}/);
  assert.doesNotMatch(state, /if:/);
});

test('the cleanup step is valid shell: each pipeline continues on a real line break, never a literal \\n', () => {
  const steps = read('collect.yml').split(/\n {6}- /).slice(1);
  const cleanup = steps.find((s) => /name: Delete older state copies/.test(s));
  assert.doesNotMatch(cleanup, /\\n/);
  const cmds = cleanup.match(/gh cache list[^\n]*\\\n\s+\| xargs[^\n]*/g) || [];
  assert.equal(cmds.length, 2, 'both the state copies and the daily backups are listed and deleted');
  assert.match(cmds[0], /--key radar-state-[\s\S]*'\.\[5:\]\[\]\.id'/);
  assert.match(cmds[1], /--key radar-backup-[\s\S]*'\.\[3:\]\[\]\.id'/);
});

test('both workflows still parse as the structure the other tests rely on', () => {
  for (const f of files) {
    const y = read(f);
    assert.match(y, /^name: /m);
    assert.doesNotMatch(y, /\t/, 'no tabs in YAML');
  }
  assert.match(read('collect.yml'), /CAP_G1: \$\{\{ vars\.CAP_G1 \}\}/, 'CAP_G1 still comes from the repository variable');
});
