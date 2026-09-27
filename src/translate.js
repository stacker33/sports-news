// Free headline translation via Google Translate's public web endpoints, batched per language and cached.
// Primary: clients5 (many headlines per request). Backup: translate_a/single (gtx).
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36';
const GT_LANG = { he: 'iw' }; // Google still uses the old code for Hebrew
const code = (l) => GT_LANG[l] || l;
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

async function viaClients5(texts, from, to) {
  const body = new URLSearchParams();
  for (const t of texts) body.append('q', t);
  const res = await fetch(`https://clients5.google.com/translate_a/t?client=dict-chrome-ex&sl=${code(from)}&tl=${code(to)}`, {
    method: 'POST',
    headers: { 'user-agent': UA, 'content-type': 'application/x-www-form-urlencoded' },
    body,
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`translate HTTP ${res.status}`);
  const j = await res.json();
  // one text → ["..."] or [["...", "lang"]]; many → [["...", "lang"], ...]
  const out = j.map((x) => (Array.isArray(x) ? x[0] : x));
  if (out.length !== texts.length) throw new Error('translate: count mismatch');
  return out.map((s) => String(s).trim());
}

async function viaGtx(texts, from, to) {
  const q = texts.map((t) => t.replace(/\s*\n\s*/g, ' ')).join('\n');
  const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${code(from)}&tl=${code(to)}&dt=t&q=${encodeURIComponent(q)}`;
  const res = await fetch(url, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`translate HTTP ${res.status}`);
  const j = await res.json();
  const out = (j[0] || []).map((seg) => seg[0] || '').join('').split('\n').map((s) => s.trim());
  if (out.length !== texts.length) throw new Error('translate: count mismatch');
  return out;
}

async function translateBatch(texts, from, to) {
  try {
    return await viaClients5(texts, from, to);
  } catch (e) {
    return await viaGtx(texts, from, to);
  }
}

// items: [{ id, title, lang }]; cache: { [id]: { en?, he? } } (mutated). Returns number of titles translated.
// Foreign languages → English + Hebrew (for reading); Hebrew → English (to match stories across languages).
export async function translateItems(items, cache, { maxTitles = 300 } = {}) {
  const jobs = new Map(); // "from>to" -> [item]
  for (const it of items) {
    if (it.lang === 'en') continue;
    for (const to of it.lang === 'he' ? ['en'] : ['en', 'he']) {
      if (cache[it.id]?.[to]) continue;
      const key = `${it.lang}>${to}`;
      if (!jobs.has(key)) jobs.set(key, []);
      jobs.get(key).push(it);
    }
  }
  // What you read first (foreign → Hebrew/English), then Hebrew → English (used to match stories across languages)
  const order = [...jobs.keys()].sort((a, b) => (a.startsWith('he>') ? 1 : 0) - (b.startsWith('he>') ? 1 : 0));
  let done = 0;
  for (const key of order) {
    const list = jobs.get(key);
    const [from, to] = key.split('>');
    for (let i = 0; i < list.length && done < maxTitles; ) {
      const batch = [];
      let chars = 0;
      while (i < list.length && batch.length < 50 && chars + list[i].title.length < 4000) {
        chars += list[i].title.length + 1;
        batch.push(list[i++]);
      }
      if (!batch.length) break;
      try {
        const out = await translateBatch(batch.map((b) => b.title), from, to);
        batch.forEach((b, k) => out[k] && ((cache[b.id] ||= {})[to] = out[k]));
        done += batch.length;
      } catch (e) {
        if (/HTTP (429|403)/.test(e.message)) return done; // rate-limited: continue on a later run
      }
      await pause(250); // be gentle
    }
  }
  return done;
}

// Translate a list of texts (batched). Throws if the service refuses.
export async function translateTexts(texts, from, to) {
  const out = [];
  for (let i = 0; i < texts.length; i += 25) out.push(...(await translateBatch(texts.slice(i, i + 25), from, to)));
  return out;
}
