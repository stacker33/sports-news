import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// A state failure must never print state content: the collector still calls console.error(e), so its message,
// properties and stack are checked here with a synthetic private marker planted in broken state files.
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const recorder = pathToFileURL(fileURLToPath(new URL('./fixtures/record-fetch.mjs', import.meta.url))).href;
const MARK = 'ZZPRIVATEMARKERQQ';
const FIXTURES = {
  // cut off in the middle of an article that carries the marker (JSON.parse's own message would quote it)
  truncated: `{"savedAt":1,"items":[{"id":"${MARK}","link":"https://example.test/${MARK}","title":"${MARK} headline`,
  // the marker at the very start of an invalid document
  malformed: `${MARK} {"items": []}`,
  // a short invalid document: Node's own JSON.parse message quotes all of it ("ZZ…QQ" is not valid JSON)
  bare: MARK,
  // valid JSON, invalid structure: the marker sits in the fields around the missing one
  invalid: JSON.stringify({ savedAt: 1, adminGreeted: MARK, items: [{ id: MARK, link: `https://example.test/${MARK}`, title: MARK }] }),
};
// the admin alert's text, built the way the workflow builds it (only [a-z:-] of the diagnostic code, max 40)
const alertText = (diag) => {
  const reason = (diag || '').replace(/[^a-z:-]/g, '').slice(0, 40);
  return `⚠️ רדאר ספורט: ריצת האיסוף נכשלה${reason ? ` (${reason})` : ''} — https://github.com/owner/repo/actions/runs/1`;
};

for (const [name, content] of Object.entries(FIXTURES)) {
  test(`state logging stays sanitized: collector, ${name} state`, () => {
    const data = mkdtempSync(join(tmpdir(), 'log-data-'));
    const err = join(mkdtempSync(join(tmpdir(), 'log-err-')), '.state-error');
    writeFileSync(join(data, 'state.json'), content);
    const r = spawnSync(process.execPath, ['--import', recorder, join(ROOT, 'src', 'collect.js')], {
      cwd: ROOT,
      env: { PATH: process.env.PATH, RADAR_DATA_DIR: data, STATE_ERROR_FILE: err },
      encoding: 'utf8',
      timeout: 60000,
    });
    assert.notEqual(r.status, 0);
    const diag = existsSync(err) ? readFileSync(err, 'utf8') : '';
    assert.match(diag, /^state:(parse|shape)\n$/);
    for (const [where, text] of [['stdout', r.stdout], ['stderr', r.stderr], ['diagnostic file', diag], ['alert text', alertText(diag)]]) {
      assert.ok(!text.includes(MARK), `${name}: marker leaked into ${where}`);
    }
  });

  test(`state logging stays sanitized: restore script, ${name} download`, () => {
    const d = mkdtempSync(join(tmpdir(), 'log-restore-'));
    const tmp = join(d, 'state.json.download'), dest = join(d, 'state.json'), err = join(d, '.state-error');
    writeFileSync(tmp, content);
    const r = spawnSync(process.execPath, [join(ROOT, 'scripts', 'restore-state.mjs'), tmp, dest, err], { encoding: 'utf8' });
    assert.equal(r.status, 1);
    const diag = readFileSync(err, 'utf8');
    for (const [where, text] of [['stdout', r.stdout], ['stderr', r.stderr], ['diagnostic file', diag], ['alert text', alertText(diag)]]) {
      assert.ok(!text.includes(MARK), `${name}: marker leaked into ${where}`);
    }
  });
}
