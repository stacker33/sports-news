import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { validateState, parseState, loadStateStrict, survivorDiagnostic, stateAgeNote, StateError } from '../src/statecheck.js';
import { restoreState } from '../scripts/restore-state.mjs';

// a sanitized, made-up state in the shape the collector saves
const NOW = Date.parse('2026-10-20T12:00:00Z');
const H = 3600e3;
const item = (n, ageH) => ({ id: `a${n}`, title: `Headline ${n}`, link: `https://example.test/a/${n}`, published: NOW - ageH * H, sourceId: 'src', lang: 'en' });
const state = (extra = {}) => ({ savedAt: NOW - 5 * 60000, meta: {}, tr: {}, ai: {}, storyIds: {}, items: [item(1, 1), item(2, 30), item(3, 47)], ...extra });
const dir = () => mkdtempSync(join(tmpdir(), 'state-'));
const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');
const codeOf = async (fn) => { try { await fn(); } catch (e) { assert.ok(e instanceof StateError, e.message); return e.code; } return 'no error'; };

test('a valid state loads unchanged (same object as plain JSON.parse): collection sees the same data as before', async () => {
  const d = dir();
  const text = JSON.stringify(state());
  writeFileSync(join(d, 'state.json'), text);
  assert.deepEqual(await loadStateStrict(join(d, 'state.json')), JSON.parse(text));
});

test('only the fields the collector needs without a fallback are required', () => {
  validateState({ items: [] }); // every other field is optional (the collector has defaults)
  validateState(state({ meta: undefined, tr: undefined, ai: undefined, storyIds: undefined, savedAt: undefined }));
  for (const [bad, why] of [
    [null, 'not an object'], [[], 'not an object'], [{}, 'items'], [{ items: {} }, 'items'],
    [{ items: [null] }, 'items[0]'], [{ items: [{ ...item(1, 1), id: '' }] }, 'id'], [{ items: [{ ...item(1, 1), link: undefined }] }, 'link'],
    [{ items: [{ ...item(1, 1), title: 5 }] }, 'title'], [{ items: [{ ...item(1, 1), published: '2026-10-20' }] }, 'published'],
  ]) {
    assert.throws(() => validateState(bad), (e) => e instanceof StateError && e.code === 'shape' && e.message.includes(why));
  }
});

test('missing, empty, truncated and malformed state files are rejected with a code', async () => {
  const d = dir();
  assert.equal(await codeOf(() => loadStateStrict(join(d, 'none.json'))), 'missing');
  writeFileSync(join(d, 'empty.json'), '');
  assert.equal(await codeOf(() => loadStateStrict(join(d, 'empty.json'))), 'parse');
  const full = JSON.stringify(state());
  writeFileSync(join(d, 'cut.json'), full.slice(0, Math.floor(full.length * 0.6))); // a cut-off download
  assert.equal(await codeOf(() => loadStateStrict(join(d, 'cut.json'))), 'parse');
  writeFileSync(join(d, 'bad.json'), '<!DOCTYPE html><title>404</title>'); // an error page instead of JSON
  assert.equal(await codeOf(() => loadStateStrict(join(d, 'bad.json'))), 'parse');
  writeFileSync(join(d, 'shape.json'), JSON.stringify({ items: 'nope' }));
  assert.equal(await codeOf(() => loadStateStrict(join(d, 'shape.json'))), 'shape');
});

test('an older state is still valid (warning only, no rejection by age)', async () => {
  const d = dir();
  const old = state({ savedAt: NOW - 5 * 24 * H, items: [item(1, 130)] }); // 5 days old, everything expired
  writeFileSync(join(d, 'state.json'), JSON.stringify(old));
  assert.equal((await loadStateStrict(join(d, 'state.json'))).items.length, 1);
  assert.match(stateAgeNote(old, NOW), /120 h old \(warning only\)/);
  assert.equal(parseState(JSON.stringify(old)).savedAt, old.savedAt);
});

test('restore: a valid download replaces the destination byte for byte', async () => {
  const d = dir();
  const tmp = join(d, 'state.json.download'), dest = join(d, 'state.json');
  writeFileSync(dest, JSON.stringify(state({ savedAt: 1 })));
  writeFileSync(tmp, JSON.stringify(state()));
  const want = sha(tmp);
  await restoreState(tmp, dest);
  assert.equal(sha(dest), want);
  assert.ok(!existsSync(tmp));
});

test('restore: a failed, cut-off or invalid download never overwrites an existing valid state', async () => {
  for (const [name, content] of [['failed', null], ['cut', JSON.stringify(state()).slice(0, 40)], ['invalid', JSON.stringify({ items: [{ id: 'x' }] })]]) {
    const d = dir();
    const tmp = join(d, 'state.json.download'), dest = join(d, 'state.json');
    writeFileSync(dest, JSON.stringify(state()));
    const before = sha(dest);
    if (content !== null) writeFileSync(tmp, content);
    const code = await codeOf(() => restoreState(tmp, dest));
    assert.equal(code, { failed: 'missing', cut: 'parse', invalid: 'shape' }[name], name);
    assert.equal(sha(dest), before, `${name}: destination unchanged`);
  }
});

test('restore: an older valid state is accepted', async () => {
  const d = dir();
  const tmp = join(d, 'state.json.download'), dest = join(d, 'state.json');
  writeFileSync(tmp, JSON.stringify(state({ savedAt: NOW - 3 * 24 * H, items: [item(1, 80)] })));
  assert.deepEqual(await restoreState(tmp, dest), { articles: 1 });
});

test('survivor diagnostic follows the collector expiry rule (counts only, never blocks)', () => {
  const baseline = [item(1, 1), item(2, 30), item(3, 47.9), item(4, 49)].map(({ id, published }) => ({ id, published }));
  // a4 expired (49 h), a3 still in the window; the next state lost a2
  const r = survivorDiagnostic(baseline, [item(1, 1), item(3, 47.9), item(9, 0)], NOW, 48 * H);
  assert.deepEqual([r.inWindow, r.kept, r.pct], [3, 2, 66.7]);
  assert.ok(!/a\d/.test(r.text)); // no identifiers in the log line
});
