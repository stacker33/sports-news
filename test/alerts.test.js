import { test } from 'node:test';
import assert from 'node:assert/strict';
import { adminHealthAlerts } from '../src/telegram.js';

const now = Date.parse('2026-10-05T08:00:00Z');
const down = (id) => ({ id, name: id, ok: false, failStreak: 20, lastOk: now - 3 * 3600e3, error: 'HTTP 404' });

function withTelegram(fn) {
  return async () => {
    const sent = [];
    const realFetch = globalThis.fetch;
    process.env.TELEGRAM_BOT_TOKEN = 'test';
    process.env.TELEGRAM_ADMIN_CHAT = '1';
    globalThis.fetch = async (url, opts) => {
      sent.push(JSON.parse(opts.body).text);
      return new Response('{"ok":true}');
    };
    try { await fn(sent); } finally {
      globalThis.fetch = realFetch;
      delete process.env.TELEGRAM_BOT_TOKEN;
      delete process.env.TELEGRAM_ADMIN_CHAT;
    }
  };
}

test('a YouTube-wide outage is one message, then silence', withTelegram(async (sent) => {
  const health = ['yt-a', 'yt-b', 'yt-c', 'yt-d', 'yt-e'].map(down).concat({ id: 'yt-f', name: 'f', ok: true, failStreak: 0 });
  const memo = await adminHealthAlerts(health, {}, now);
  assert.equal(sent.length, 1);
  assert.match(sent[0], /יוטיוב לא זמין/);
  await adminHealthAlerts(health, memo, now + 5 * 60e3);
  assert.equal(sent.length, 1);
}));

test('other sources still alert during a YouTube outage', withTelegram(async (sent) => {
  const health = ['yt-a', 'yt-b', 'yt-c', 'yt-d', 'espn'].map(down);
  await adminHealthAlerts(health, {}, now);
  assert.equal(sent.length, 2);
  assert.match(sent[1], /espn/);
  assert.doesNotMatch(sent[1], /yt-a/);
}));

test('one broken YouTube channel is reported on its own', withTelegram(async (sent) => {
  const ok = (id) => ({ id, name: id, ok: true, failStreak: 0, lastOk: now });
  await adminHealthAlerts([down('yt-a'), ok('yt-b'), ok('yt-c'), ok('yt-d')], {}, now);
  assert.equal(sent.length, 1);
  assert.match(sent[0], /yt-a/);
}));
