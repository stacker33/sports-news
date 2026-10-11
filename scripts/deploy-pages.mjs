// Publish the uploaded Pages artifact - the same API calls as actions/deploy-pages@v4, with one difference:
// a UNIQUE build version per run. The official action uses the commit SHA, so every run of the same code asks
// for the same deployment ID; after one deployment failed (a run cancelled mid-deploy, 2026-10-11 12:45 UTC),
// GitHub kept answering "success" for that ID and published nothing - the site froze while every run was green.
// GitHub documents pages_build_version as "a unique string that represents the version of the build".
//
// Run in a workflow step with: permissions pages: write + id-token: write, the job in the github-pages
// environment, and env GITHUB_TOKEN + ARTIFACT_ID (from actions/upload-pages-artifact's `artifact_id` output).
import { appendFileSync } from 'node:fs';

const API = process.env.GITHUB_API_URL || 'https://api.github.com';
const POLL_MS = Number(process.env.DEPLOY_POLL_MS || 5000);
const TIMEOUT_MS = Number(process.env.DEPLOY_TIMEOUT_MS || 5 * 60 * 1000);
const FINAL_ERRORS = new Set(['deployment_failed', 'deployment_perms_error', 'deployment_content_failed', 'deployment_cancelled', 'deployment_lost']);

export function buildVersion(env = process.env) {
  return `${env.GITHUB_SHA}-${env.GITHUB_RUN_ID}-${env.GITHUB_RUN_ATTEMPT || 1}`;
}

export async function deploy({ env = process.env, fetchFn = fetch, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), log = console.log } = {}) {
  for (const k of ['GITHUB_REPOSITORY', 'GITHUB_SHA', 'GITHUB_RUN_ID', 'GITHUB_TOKEN', 'ARTIFACT_ID', 'ACTIONS_ID_TOKEN_REQUEST_URL', 'ACTIONS_ID_TOKEN_REQUEST_TOKEN']) {
    if (!env[k]) throw new Error(`${k} is not set`);
  }
  const gh = (path, opts = {}) =>
    fetchFn(`${API}/repos/${env.GITHUB_REPOSITORY}${path}`, {
      ...opts,
      headers: { authorization: `Bearer ${env.GITHUB_TOKEN}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', 'content-type': 'application/json' },
    });

  // the OIDC token proves this run may deploy (same as core.getIDToken() without an audience)
  const oidcRes = await fetchFn(env.ACTIONS_ID_TOKEN_REQUEST_URL, { headers: { authorization: `bearer ${env.ACTIONS_ID_TOKEN_REQUEST_TOKEN}` } });
  if (!oidcRes.ok) throw new Error(`OIDC token request failed: HTTP ${oidcRes.status}`);
  const oidc = (await oidcRes.json()).value;

  const version = buildVersion(env);
  const created = await gh('/pages/deployments', { method: 'POST', body: JSON.stringify({ artifact_id: Number(env.ARTIFACT_ID), pages_build_version: version, oidc_token: oidc }) });
  const body = await created.json().catch(() => ({}));
  if (!created.ok) throw new Error(`creating the Pages deployment failed: HTTP ${created.status} ${body.message || ''}`);
  const id = body.status_url?.split('/').pop() || version;
  log(`Created Pages deployment ${id} (build version ${version})`);

  const started = Date.now();
  let errors = 0;
  while (true) {
    await sleep(POLL_MS);
    const res = await gh(`/pages/deployments/${id}`);
    if (!res.ok) {
      if (++errors >= 10) throw new Error(`deployment status: too many errors (last HTTP ${res.status})`);
    } else {
      const { status } = await res.json();
      if (status === 'succeed') {
        log(`Deployed: ${body.page_url || ''}`);
        if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, `page_url=${body.page_url || ''}\nstatus=succeed\n`);
        return { id, version, status };
      }
      if (FINAL_ERRORS.has(status)) throw new Error(`deployment ${id} ended with ${status}`);
      log(`status: ${status}`);
    }
    if (Date.now() - started > TIMEOUT_MS) {
      await gh(`/pages/deployments/${id}/cancel`, { method: 'POST' }).catch(() => {});
      throw new Error(`deployment ${id} timed out after ${Math.round(TIMEOUT_MS / 1000)}s and was cancelled`);
    }
  }
}

if (/deploy-pages\.mjs$/.test(process.argv[1] || '')) {
  deploy().catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}
