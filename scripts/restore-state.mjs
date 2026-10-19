// Put a downloaded state in place only when it is complete and valid.
//   node scripts/restore-state.mjs <temporary download> <destination> [diagnostic file]
// The download goes to a temporary file in the destination directory; this checks it (valid JSON + the structure
// the collector needs, src/statecheck.js) and renames it over the destination (atomic within one directory).
// On any failure: the temporary file is removed, an existing destination is left untouched, a short sanitized
// code (e.g. "state:parse") goes to the diagnostic file (kept outside the published directory), exit code 1.
import { readFile, rename, rm, writeFile } from 'node:fs/promises';
import { parseState, StateError } from '../src/statecheck.js';

export async function restoreState(tmp, dest) {
  let text;
  try {
    text = await readFile(tmp, 'utf8');
  } catch {
    throw new StateError('missing', 'the download produced no file');
  }
  const s = parseState(text);
  await rename(tmp, dest);
  return { articles: s.items.length };
}

if (/restore-state\.mjs$/.test(process.argv[1] || '')) {
  const [tmp, dest, errFile = '.state-error'] = process.argv.slice(2);
  try {
    const { articles } = await restoreState(tmp, dest);
    console.log(`State restored: ${articles} articles`);
  } catch (e) {
    await rm(tmp, { force: true });
    const code = /^[a-z-]+$/.test(e.code || '') ? e.code : 'restore';
    await writeFile(errFile, `state:${code}\n`).catch(() => {});
    console.error(`::error::Previous state not usable (${code}): ${e.message}. Stopping before collection and publishing.`);
    process.exit(1);
  }
}
