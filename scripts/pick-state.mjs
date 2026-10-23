// Use the radar's memory from the Actions cache (the site no longer publishes it). A copy is used only when it is
// complete and valid (src/statecheck.js). Without --allow-older it must also be at least as new as the state behind the
// site's latest publish (data/version.json has the same timestamp as the state's savedAt).
//   node scripts/pick-state.mjs <cached state> <site version.json> <destination> [--allow-older]
// --allow-older: the site no longer publishes the state, so the newest valid cached copy is used even when it is
// older than the site's latest publish (e.g. its save failed after a publish); the gap is logged.
// exit 0: copied into place · exit 2: not used (the reason is printed), nothing written
import { readFile, copyFile, rename } from 'node:fs/promises';
import { parseState } from '../src/statecheck.js';

export async function pickCached(cachedPath, versionPath, { allowOlder = false } = {}) {
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
  const ok = { use: true, articles: s.items.length, savedAt: s.savedAt };
  if (allowOlder) return Number.isFinite(live) && s.savedAt < live ? { ...ok, olderMin: Math.round((live - s.savedAt) / 60000) } : ok;
  if (!Number.isFinite(live)) return { use: false, why: 'site version unknown' };
  if (!(s.savedAt >= live)) return { use: false, why: `cached copy is older than the site's (${s.savedAt} < ${live})` };
  return ok;
}

if (/pick-state\.mjs$/.test(process.argv[1] || '')) {
  const [cached, version, dest, flag] = process.argv.slice(2);
  const r = await pickCached(cached, version, { allowOlder: flag === '--allow-older' });
  if (!r.use) {
    console.log(`Not used (${cached}): ${r.why}.`);
    process.exit(2);
  }
  // copy next to the destination, then rename: atomic within one directory
  await copyFile(cached, `${dest}.cache`);
  await rename(`${dest}.cache`, dest);
  console.log(`State restored from ${cached}: ${r.articles} articles${r.olderMin ? ` (${r.olderMin} min older than the site's latest publish)` : ''}`);
}
