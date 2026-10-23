// Use the radar's memory from the Actions cache instead of downloading it from the live site (~25 MB compressed per
// run, ~220 GB a month against GitHub Pages' ~100 GB soft limit). The cached copy is used only when it is complete,
// valid (src/statecheck.js) and at least as new as the state behind the site's latest publish (data/version.json has
// the same timestamp as the state's savedAt). Otherwise the workflow falls back to the site download, as before.
//   node scripts/pick-state.mjs <cached state> <site version.json> <destination>
// exit 0: copied into place · exit 2: not used (the reason is printed), nothing written
import { readFile, copyFile, rename } from 'node:fs/promises';
import { parseState } from '../src/statecheck.js';

export async function pickCached(cachedPath, versionPath) {
  let text;
  try {
    text = await readFile(cachedPath, 'utf8');
  } catch {
    return { use: false, why: 'no cached copy' };
  }
  let s;
  try {
    s = parseState(text);
  } catch (e) {
    return { use: false, why: `cached copy not usable (${/^[a-z-]+$/.test(e.code || '') ? e.code : 'invalid'})` };
  }
  let live;
  try {
    live = JSON.parse(await readFile(versionPath, 'utf8')).generatedAt;
  } catch {
    live = null;
  }
  // without the site's version we can't tell whether the cache is the latest: the site copy is the safe choice
  if (!Number.isFinite(live)) return { use: false, why: 'site version unknown' };
  if (!(s.savedAt >= live)) return { use: false, why: `cached copy is older than the site's (${s.savedAt} < ${live})` };
  return { use: true, articles: s.items.length, savedAt: s.savedAt };
}

if (/pick-state\.mjs$/.test(process.argv[1] || '')) {
  const [cached, version, dest] = process.argv.slice(2);
  const r = await pickCached(cached, version);
  if (!r.use) {
    console.log(`Actions cache not used: ${r.why}. Downloading from the site.`);
    process.exit(2);
  }
  // copy next to the destination, then rename: atomic within one directory
  await copyFile(cached, `${dest}.cache`);
  await rename(`${dest}.cache`, dest);
  console.log(`State restored from the Actions cache: ${r.articles} articles`);
}
