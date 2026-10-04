// Hebrew headline + short summary per story, written by a language model.
//
// - Any OpenAI-compatible chat API: Google Gemini (default, free tier), Groq, Anthropic… set by environment:
//   AI_API_KEY (GitHub secret, required — without it nothing is called and stories keep the machine
//   translation / feed blurb), AI_BASE_URL, AI_MODEL, AI_DAILY_CAP.
// - One request per run at most, 10 stories per request, a daily cap, most important stories first
//   (by importance, world and Israeli alike). Each story is done once, and again only if it has grown a lot
//   since (more sources = more to summarise).
// - The model gets only the stories' headlines and descriptions and is told to use nothing else.

const BASE_URL = (process.env.AI_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta/openai').replace(/\/$/, '');
const ENDPOINT = `${BASE_URL}/chat/completions`;
const MODEL = process.env.AI_MODEL || 'gemini-flash-lite-latest';
const PER_REQUEST = 10;
const DAILY_CAP = Number(process.env.AI_DAILY_CAP) || 400; // under the free tier's daily request limit (the provider's real limits may be lower)
export const aiCap = () => DAILY_CAP;
let lastUsage = null; // tokens of the last call (for metering)
const KEEP_DAYS = 3;

const SYSTEM = `You are a sports news editor for an Israeli sports app. For each story you get its headlines and descriptions from one or more outlets, in various languages.
Write for each story:
- "title_he": the headline in natural, fluent Hebrew as an Israeli sports site would write it (not a literal translation). Use the common Hebrew spelling of players, clubs and competitions (e.g. "מכבי תל אביב", "ריאל מדריד", "ליגת האלופות", "דני אבדיה").
- "summary_he": 2–3 short, clear Hebrew sentences: what happened, who is involved, and why it matters (result, decision, injury, transfer, quote…). The reader should understand the story without opening it.
- "summary_en": the same summary in English, 2–3 sentences.
- "facts_he": 2–4 short Hebrew bullet points an editor can write from: the key numbers (score, fee, contract length, stats, dates), short quotes with who said them ("X: '…'"), and the people/clubs involved. Only what the texts actually say; fewer bullets if there is little. No repetition of the summary.
Rules: keep the sport right — a basketball story says כדורסל, never כדורגל (and vice versa). Use ONLY facts that appear in the given texts. Never invent scores, numbers, quotes, dates or reasons. Keep attributions ("according to …", "reportedly") when the source only reports a claim. If the texts say very little, write one sentence with what is known. No hashtags, emojis or clickbait. Inside the text never use the " character — write quotes with the Hebrew ״…״ marks (or ' in English) so the JSON stays valid.
Return JSON: {"stories":[{"id":"…","title_he":"…","summary_he":"…","summary_en":"…","facts_he":["…"]}]} with every id you were given.`;

const clip = (s, n) => (s && s.length > n ? s.slice(0, n - 1) + '…' : s || '');

// What we send for one story: up to 6 distinct headlines (with outlet + language) and the best descriptions
function storyInput(s, sums) {
  const seen = new Set();
  const heads = [];
  for (const m of [...s._members].sort((a, b) => b.weight - a.weight)) {
    const key = m.title.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    heads.push(`[${m.lang}] ${m.publisher}: ${clip(m.title, 200)}`);
    if (heads.length >= 6) break;
  }
  const descs = [...new Set([s.sum?.text, ...s._members.map((m) => m.summary), ...s._members.map((m) => sums[m.id]?.text)].filter((t) => t && t.length > 40))]
    .slice(0, 3)
    .map((t) => clip(t, 320));
  return `Headlines:\n${heads.join('\n')}${descs.length ? `\nDescriptions:\n${descs.join('\n')}` : ''}`;
}

// The story's earliest article: stays the same while the lead article changes
const storyKey = (s) => [...s._members].sort((a, b) => a.published - b.published || (a.id < b.id ? -1 : 1))[0].id;

async function callModel(token, user) {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      temperature: 0.2,
      max_tokens: 6000,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: user },
      ],
    }),
    signal: AbortSignal.timeout(60000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${(await res.text()).slice(0, 160)}`);
  const body = await res.text();
  try { lastUsage = JSON.parse(body).usage || null; } catch { lastUsage = null; }
  let j;
  try {
    j = JSON.parse(body);
  } catch {
    throw new Error(`not JSON from ${ENDPOINT}: ${body.slice(0, 80)}`);
  }
  const content = (j.choices?.[0]?.message?.content || '{}').replace(/^\s*```(?:json)?\s*|\s*```\s*$/g, '');
  try {
    return JSON.parse(content);
  } catch (e) {
    // one broken story (an unescaped quote) shouldn't lose the whole batch: keep every story object that parses
    const stories = [];
    for (const part of content.split(/(?=\{\s*"id"\s*:)/).slice(1)) {
      const obj = part.replace(/\s*\]\s*\}\s*$/, '').replace(/\s*,\s*$/, '');
      try {
        stories.push(JSON.parse(obj));
      } catch {}
    }
    if (!stories.length) throw e;
    return { stories, partial: true };
  }
}

// prev = { day, used, cooldownUntil, error, res: { key: { title_he, summary_he, summary_en, n, at } } }
export async function aiSummaries(stories, sums, prev = {}, now = Date.now()) {
  const day = new Date(now).toISOString().slice(0, 10);
  const st = { ...prev, res: { ...(prev.res || {}) } };
  if (st.day !== day) Object.assign(st, { day, used: 0, tokens: 0 });
  for (const [k, r] of Object.entries(st.res)) if (now - r.at > KEEP_DAYS * 864e5) delete st.res[k];

  // attach what we already have
  const keyOf = new Map(stories.map((s) => [s, storyKey(s)]));
  const attach = (s) => {
    const r = st.res[keyOf.get(s)];
    if (r) s.ai = { he: { title: r.title_he, sum: r.summary_he, ...(r.facts?.length ? { facts: r.facts } : {}) }, en: { sum: r.summary_en } };
  };

  const token = process.env.AI_API_KEY;
  if (!token) st.error = 'no AI_API_KEY secret';
  let done = 0;
  if (token && st.used < DAILY_CAP && !(st.cooldownUntil > now)) {
    const need = stories
      .filter((s) => now - s.first < 18 * 3600e3)
      .filter((s) => {
        const r = st.res[keyOf.get(s)];
        return !r || r.v !== 2 || (s.sourceCount >= r.n * 2 && s.sourceCount >= r.n + 3 && now - r.at > 3600e3);
      })
      .sort((a, b) => b.score - a.score) // most important first — world and Israeli alike
      .slice(0, PER_REQUEST);
    if (need.length) {
      const user = need.map((s, i) => `### id: s${i}\n${storyInput(s, sums)}`).join('\n\n');
      try {
        st.used++;
        const out = await callModel(token, user);
        st.tokens = (st.tokens || 0) + (lastUsage?.total_tokens || 0);
        for (const r of out.stories || []) {
          const s = need[Number(String(r.id).replace(/\D/g, ''))];
          if (!s || !r.summary_he) continue;
          const facts = (Array.isArray(r.facts_he) ? r.facts_he : []).filter((f) => typeof f === 'string' && f.trim()).slice(0, 4).map((f) => clip(f.trim(), 200));
          st.res[keyOf.get(s)] = { v: 2, title_he: clip(r.title_he, 220), summary_he: clip(r.summary_he, 600), summary_en: clip(r.summary_en, 600), facts, n: s.sourceCount, at: now };
          done++;
        }
        st.error = null;
      } catch (e) {
        st.error = String(e.message).slice(0, 200);
        if (/HTTP 429/.test(st.error)) st.cooldownUntil = now + 30 * 60000; // rate-limited: wait a while
      }
    }
  }
  stories.forEach(attach);
  return { ai: st, done };
}
