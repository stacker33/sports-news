// Preloaded into a child process by test/watchdog.test.js: replaces fetch, so nothing leaves the machine, and prints
// every requested URL on exit. The site reports data two hours old (stale), GitHub has no runs in progress.
const calls = [];
globalThis.fetch = async (url, opts = {}) => {
  calls.push(`${opts.method || 'GET'} ${String(url).replace(/\?.*$/, '')}`);
  const json = (body, status = 200) => ({ ok: status < 300, status, json: async () => body, text: async () => JSON.stringify(body) });
  if (String(url).includes('/data/news.json')) return json({ generatedAt: Date.now() - 2 * 3600e3 });
  if (String(url).includes('/runs?status=')) return json({ workflow_runs: [] });
  // MOCK_RECENT_RUN=1: a collect run started a minute ago (the watchdog must not start another next to it)
  if (String(url).includes('/runs?per_page=')) return json({ workflow_runs: process.env.MOCK_RECENT_RUN ? [{ id: 1, created_at: new Date(Date.now() - 60000).toISOString(), conclusion: null }] : [] });
  if (String(url).includes('/dispatches')) return { ok: true, status: 204, json: async () => ({}), text: async () => '' };
  return json({ ok: true });
};
process.on('exit', () => process.stdout.write(`\nCALLS ${JSON.stringify(calls)}\n`));
