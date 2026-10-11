import { test } from 'node:test';
import assert from 'node:assert/strict';
import { alertDue } from '../src/watchdog.js';

test('watchdog alerts at once, then after 2h and 6h, then every 24h', () => {
  const t0 = Date.parse('2026-10-07T09:00:00Z');
  const h = (n) => t0 + n * 3600e3;
  assert.equal(alertDue({}, t0), true); // first: at once
  const after1 = { firstAlert: t0, lastAlert: t0, alerts: 1 };
  assert.equal(alertDue(after1, h(1)), false);
  assert.equal(alertDue(after1, h(2)), true); // 2h
  const after2 = { firstAlert: t0, lastAlert: h(2), alerts: 2 };
  assert.equal(alertDue(after2, h(5)), false);
  assert.equal(alertDue(after2, h(6)), true); // 6h
  const after3 = { firstAlert: t0, lastAlert: h(6), alerts: 3 };
  assert.equal(alertDue(after3, h(20)), false);
  assert.equal(alertDue(after3, h(24)), true); // 24h
  const after4 = { firstAlert: t0, lastAlert: h(24), alerts: 4 };
  assert.equal(alertDue(after4, h(40)), false);
  assert.equal(alertDue(after4, h(48)), true); // then every 24h
});

test('repair-only watchdog (discovery trial): repairs a stale site but sends no message, even with Telegram set', async () => {
  const { execFileSync } = await import('node:child_process');
  const { mkdtempSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { fileURLToPath, pathToFileURL } = await import('node:url');
  const script = fileURLToPath(new URL('../src/watchdog.js', import.meta.url));
  const mock = pathToFileURL(fileURLToPath(new URL('./fixtures/mock-fetch.mjs', import.meta.url))).href;
  const run = (extra) => {
    const out = execFileSync(process.execPath, ['--import', mock, script], {
      cwd: mkdtempSync(join(tmpdir(), 'wd-')),
      env: { PATH: process.env.PATH, GH_TOKEN: 'test', REPO: 'stacker33/sports-news-discovery', SITE_URL: 'https://example.test/site', TELEGRAM_BOT_TOKEN: 'test', TELEGRAM_ADMIN_CHAT: '1', ...extra },
      encoding: 'utf8',
    });
    return JSON.parse(out.match(/CALLS (.*)/)[1]);
  };
  const quiet = run({ REPAIR_ONLY: '1' });
  assert.ok(quiet.some((c) => c === 'POST https://api.github.com/repos/stacker33/sports-news-discovery/actions/workflows/collect.yml/dispatches'));
  assert.ok(!quiet.some((c) => c.includes('telegram')), quiet.join('\n'));
  // without REPAIR_ONLY the same situation does message (proves the switch is what silences it)
  assert.ok(run({}).some((c) => c.includes('api.telegram.org')));
});

test('watchdog does not start a collect run next to one that just started', async () => {
  const { execFileSync } = await import('node:child_process');
  const { mkdtempSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { fileURLToPath, pathToFileURL } = await import('node:url');
  const script = fileURLToPath(new URL('../src/watchdog.js', import.meta.url));
  const mock = pathToFileURL(fileURLToPath(new URL('./fixtures/mock-fetch.mjs', import.meta.url))).href;
  const out = execFileSync(process.execPath, ['--import', mock, script], {
    cwd: mkdtempSync(join(tmpdir(), 'wd-')),
    env: { PATH: process.env.PATH, GH_TOKEN: 'test', REPO: 'stacker33/sports-news', SITE_URL: 'https://example.test/site', REPAIR_ONLY: '1', MOCK_RECENT_RUN: '1' },
    encoding: 'utf8',
  });
  const calls = JSON.parse(out.match(/CALLS (.*)/)[1]);
  assert.ok(!calls.some((c) => c.includes('/dispatches')), calls.join('\n'));
});
