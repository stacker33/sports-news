// scripts/deploy-pages.mjs: a unique build version per run, the same API calls as actions/deploy-pages (mocked)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deploy, buildVersion } from '../scripts/deploy-pages.mjs';

const env = { GITHUB_REPOSITORY: 'o/r', GITHUB_SHA: 'abc123', GITHUB_RUN_ID: '777', GITHUB_RUN_ATTEMPT: '2', GITHUB_TOKEN: 't', ARTIFACT_ID: '42', ACTIONS_ID_TOKEN_REQUEST_URL: 'https://token.test/?x=1', ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'rt' };
const res = (body, status = 200) => ({ ok: status < 300, status, json: async () => body });

function mock(statuses) {
  const calls = [];
  const fetchFn = async (url, opts = {}) => {
    calls.push({ url, method: opts.method || 'GET', body: opts.body && JSON.parse(opts.body) });
    if (url.startsWith('https://token.test')) return res({ value: 'oidc' });
    if (url.endsWith('/pages/deployments') && opts.method === 'POST') return res({ status_url: 'https://api.github.com/repos/o/r/pages/deployments/dep9', page_url: 'https://o.github.io/r/' });
    if (url.endsWith('/cancel')) return res({});
    return res({ status: statuses.shift() });
  };
  return { calls, fetchFn };
}

test('every run gets its own build version (never just the commit SHA)', () => {
  assert.equal(buildVersion(env), 'abc123-777-2');
  assert.notEqual(buildVersion({ ...env, GITHUB_RUN_ID: '778' }), buildVersion(env));
});

test('creates the deployment with the artifact, the unique version and the OIDC token, then waits for success', async () => {
  const { calls, fetchFn } = mock(['deployment_queued', 'syncing_files', 'succeed']);
  const out = await deploy({ env, fetchFn, sleep: async () => {}, log: () => {} });
  const create = calls.find((c) => c.method === 'POST');
  assert.deepEqual(create.body, { artifact_id: 42, pages_build_version: 'abc123-777-2', oidc_token: 'oidc' });
  assert.equal(out.id, 'dep9');
  assert.ok(calls.some((c) => c.url.endsWith('/pages/deployments/dep9')));
});

test('a failed deployment fails the step; a stuck one is cancelled after the timeout', async () => {
  await assert.rejects(deploy({ env, fetchFn: mock(['deployment_failed']).fetchFn, sleep: async () => {}, log: () => {} }), /deployment_failed/);
  const m = mock(Array(50).fill('syncing_files'));
  let t = 0;
  const realNow = Date.now;
  Date.now = () => (t += 61000);
  try {
    await assert.rejects(deploy({ env: { ...env, DEPLOY_TIMEOUT_MS: '120000' }, fetchFn: m.fetchFn, sleep: async () => {}, log: () => {} }), /timed out/);
  } finally {
    Date.now = realNow;
  }
  assert.ok(m.calls.some((c) => c.url.endsWith('/cancel') && c.method === 'POST'));
});
