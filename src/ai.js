// Hebrew headlines, summaries and key facts per story, written by a language model.
//
// - Any OpenAI-compatible chat API: Google Gemini (default, free tier), Groq, Anthropic… set by environment:
//   AI_API_KEY (GitHub secret, required — without it nothing is called and stories keep the machine
//   translation / feed blurb), AI_BASE_URL, AI_MODEL (default Gemini Flash), AI_MODEL_FALLBACK (default Flash-Lite,
//   used when the main model's free quota runs out), AI_DAILY_CAP.
// - Each run: one summary request (10 stories: headline + summary + facts) and, when there's room, one headline
//   request (30 foreign headlines that have no summary yet) — so no headline is left to literal machine translation.
//   Daily cap and an hourly pace; most important stories first (world and Israeli alike).
// - The model gets the stories' headlines and descriptions only, plus the correct Hebrew spelling of the teams and
//   players in each story (from the knowledge base), and is told to use nothing else.
// - The strong model (Flash) writes the important stories (headline + summary); the light one (Flash-Lite) the other
//   headlines. Only a DAILY quota error moves the strong model's work to the light one for the day; a per-minute
//   limit falls back for that one call.
// - Style: ~10 of today's real Sport5 headlines go in as examples (style only, never content).
// - Answers are checked: text with Arabic letters, Latin / Greek / Cyrillic letters glued to Hebrew ("המffמן"), no
//   Hebrew, or an empty field is rejected and retried later.

const BASE_URL = (process.env.AI_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta/openai').replace(/\/$/, '');
const ENDPOINT = `${BASE_URL}/chat/completions`;
const MODEL = process.env.AI_MODEL || 'gemini-flash-latest';
const FALLBACK = process.env.AI_MODEL_FALLBACK || 'gemini-flash-lite-latest';
const PER_REQUEST = 10;
const HEADLINES_PER_REQUEST = 30;
const DAILY_CAP = Number(process.env.AI_DAILY_CAP) || 400; // under the free tier's daily request limit (the provider's real limits may be lower)
const PER_HOUR = Math.ceil(DAILY_CAP / 20); // spread the day's budget
export const aiCap = () => DAILY_CAP;
let lastUsage = null; // tokens of the last call (for metering)
const KEEP_DAYS = 3;
const VERSION = 4; // results from older prompts are redone gradually, most important first

const STYLE = `You are a senior editor at an Israeli sports news website (like Sport5 or ONE). You write in natural, fluent, idiomatic Hebrew — the way an Israeli sports journalist writes, never word-for-word translation.
Style rules:
- Hebrew names: when the input gives "Hebrew names", use exactly those spellings. Otherwise use the spelling common in Israeli sports media (e.g. ריאל מדריד, ברצלונה, מנצ'סטר סיטי, ליגת האלופות, NBA, יורוליג, הכוכב האדום בלגרד). Spanish "ll" sounds like "y": Valladolid = ויאדוליד, Villarreal = ויאריאל, Mallorca = מיורקה, Sevilla = סביליה.
- Clubs and national teams take feminine verbs in Hebrew sports writing (״ריאל מדריד ניצחה״, ״הכוכב האדום הפסידה״).
- Write only Hebrew letters (plus digits, Latin abbreviations like NBA, and names with no Hebrew form). Never Arabic or other scripts.
- Keep the sport right: a basketball story says כדורסל, never כדורגל (and vice versa).
- Use ONLY facts in the given texts. Never invent scores, numbers, quotes, dates or reasons. Keep attributions (״לפי הדיווח״, ״על פי…״) when the source only reports a claim.
- Translate MEANING, never word for word: idioms and set phrases become what an Israeli writer would say ("deeply impressed" → מתלהב / התרשם מאוד, "flawless" / "foutloos" → מושלמת / בלי מעידות, "on fire" → בכושר שיא). Not sure what a phrase means? Write its plain meaning; never guess a different one.
- Headlines like an Israeli sports site: short (up to ~12 words), active voice, the news first; names, scores and numbers exactly as in the source.
- No hashtags, emojis or clickbait. Inside text never use the " character — write quotes with ״…״ (or ' in English) so the JSON stays valid.`;

const SYSTEM = `${STYLE}

For each story you get its headlines (from one or more outlets, various languages) and descriptions. Write:
- "title_he": the story's headline in Hebrew. It must say what the main headline says — translate its meaning naturally; do not replace it with a detail from the descriptions. A round-up article ("Notes: A, B, C") gets a round-up headline, not one detail.
- "summary_he": 2–3 short, clear Hebrew sentences: what happened, who is involved, why it matters. The reader should understand the story without opening it.
- "summary_en": the same summary in English.
- "facts_he": 2–4 short Hebrew bullets an editor can write from: key numbers (score, fee, contract, stats, dates), the people/clubs involved. Only what the texts say; fewer if there is little; don't repeat the summary or the quotes.
- "quotes_he": 0–2 of the strongest things someone actually SAID that appear in the texts (in quotation marks, or clearly reported speech of a named person — a coach, player, club, official). Each: {"who":"<who said it, in Hebrew, short: name + role>","he":"<the quote in fluent, natural Hebrew — the way an Israeli sports site would quote it; keep its meaning and tone, not word for word>"}. Never invent or paraphrase a quote that isn't in the texts; an empty list is fine and common.
Examples of headlines:
- "Navaro besan nakon poraza od FMP-a: Nismo bili ovde da igramo prijateljsku utakmicu" → "נבארו זועם אחרי ההפסד ל-FMP: ״לא באנו לשחק משחק ידידות״"
- "Gonçalo Ramos partilha publicação: «O estatuto de ser o melhor!»" → "גונסאלו ראמוס בפוסט: ״המעמד של להיות הטוב ביותר״"
- "Southwest Notes: Harris, Jerome, Rockets, Mavs, Pelicans" → "עדכוני הדרום-מערב: האריס, ג'רום, יוסטון, דאלאס וניו אורלינס"
Return JSON: {"stories":[{"id":"…","title_he":"…","summary_he":"…","summary_en":"…","facts_he":["…"],"quotes_he":[{"who":"…","he":"…"}]}]} with every id you were given.`;

const HEAD_SYSTEM = `${STYLE}

You get numbered sports headlines in various languages. Translate each into a natural Hebrew headline as an Israeli sports site would write it — the same meaning, not word for word.
Examples:
- "Zvezda izgubila i kvalifikacijama za Ligu Evrope!" → "הכוכב האדום הפסידה גם במוקדמות הליגה האירופית"
- "Ajax (v) deelt tik uit aan Feyenoord (v), Sparta (v) viert doelpuntenfestijn" → "נשות אייאקס הכו את פיינורד, חגיגת שערים לספרטה"
Return JSON: {"titles":[{"id":"…","title_he":"…"}]} with every id you were given.`;

const clip = (s, n) => (s && s.length > n ? s.slice(0, n - 1) + '…' : s || '');
// a usable Hebrew text: has Hebrew, no Arabic-script letters (the model sometimes slips one in)
export const goodHe = (t) =>
  typeof t === 'string' && /[א-ת]/.test(t) && t.trim().length > 3 &&
  !/[؀-ۿݐ-ݿͰ-Ͽ\u0400-\u04FF]/.test(t) && // Arabic, Greek or Cyrillic letters
  !/[א-ת][A-Za-z]|[A-Za-z][א-ת]/.test(t); // a Latin letter glued to a Hebrew one inside a word ("המffמן", "סרcסטית")
const clean = (t) => String(t || '').replace(/[\u200B-\u200F\u202A-\u202E\u2060\uFEFF]/g, '').trim();

// "Hebrew names: Real Valladolid = ריאל ויאדוליד; …" from the story's tags (knowledge base) and Israelis abroad
function namesLine(s, heName) {
  const pairs = new Map();
  for (const g of s.tags || []) if (g.en && g.he && g.he !== g.en && /[א-ת]/.test(g.he)) pairs.set(g.en, g.he);
  for (const a of s.athletes || []) if (heName.get(a)) pairs.set(a, heName.get(a));
  for (const [en, he] of s._names || []) if (!pairs.has(en)) pairs.set(en, he);
  return pairs.size ? `\nHebrew names: ${[...pairs].slice(0, 14).map(([en, he]) => `${en} = ${he}`).join('; ')}` : '';
}

// What we send for one story: up to 6 distinct headlines (with outlet + language) and the best descriptions
function storyInput(s, sums, heName) {
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
  return `Main headline: ${clip(s.title, 200)}\nHeadlines:\n${heads.join('\n')}${descs.length ? `\nDescriptions:\n${descs.join('\n')}` : ''}${namesLine(s, heName)}`;
}

// The story's earliest article: stays the same while the lead article changes
const storyKey = (s) => [...s._members].sort((a, b) => a.published - b.published || (a.id < b.id ? -1 : 1))[0].id;

async function callModel(token, model, system, user) {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      model,
      temperature: 0.3,
      max_tokens: 8000,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    }),
    signal: AbortSignal.timeout(90000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${(await res.text()).slice(0, 700)}`); // long enough to tell a per-day quota from a per-minute one
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
    // one broken item (an unescaped quote) shouldn't lose the whole batch: keep every object that parses
    const items = [];
    for (const part of content.split(/(?=\{\s*"id"\s*:)/).slice(1)) {
      const obj = part.replace(/\s*\]\s*\}\s*$/, '').replace(/\s*,\s*$/, '');
      try {
        items.push(JSON.parse(obj));
      } catch {}
    }
    if (!items.length) throw e;
    return { stories: items, titles: items, partial: true };
  }
}

// prev = { day, used, hourly, tokens, error, model, mainOffDay, res: { key: {...} }, heads: { key: { title_he, at } } }
export async function aiSummaries(stories, sums, prev = {}, now = Date.now(), heName = new Map(), { styleHeads = [] } = {}) {
  // today's real Sport5 headlines: a style reference for both prompts
  const style = styleHeads.length
    ? `\n\nToday's real Sport5 headlines — imitate this STYLE (length, tone, word order), never their content:\n${styleHeads.slice(0, 10).map((h) => `- ${h}`).join('\n')}`
    : '';
  const day = new Date(now).toISOString().slice(0, 10);
  const st = { ...prev, res: { ...(prev.res || {}) }, heads: { ...(prev.heads || {}) }, hourly: (prev.hourly || []).filter((t) => now - t < 3600e3) };
  if (st.day !== day) Object.assign(st, { day, used: 0, tokens: 0 });
  for (const k of ['res', 'heads']) for (const [key, r] of Object.entries(st[k])) if (now - r.at > KEEP_DAYS * 864e5) delete st[k][key];

  const keyOf = new Map(stories.map((s) => [s, storyKey(s)]));
  const token = process.env.AI_API_KEY;
  if (!token) st.error = 'no AI_API_KEY secret';
  const room = () => token && st.used < DAILY_CAP && st.hourly.length < PER_HOUR && !(st.cooldownUntil > now);
  // strong jobs (important stories) use the main model unless its DAILY quota is gone; light jobs use the light one
  const model = (strong) => (strong && st.mainOffDay !== day ? MODEL : FALLBACK);
  async function call(system, user, strong = false) {
    st.used++;
    st.hourly.push(now);
    const m = model(strong);
    try {
      const out = await callModel(token, m, system, user);
      st.model = m;
      return out;
    } catch (e) {
      // the main model: daily quota gone / unknown model → the light one for the rest of the day;
      // a per-minute limit or an overload (5xx) → the light one just for this call
      if (m === MODEL && MODEL !== FALLBACK && /HTTP (429|404|400|5\d\d)/.test(e.message)) {
        const daily = /HTTP (404|400)/.test(e.message) || (/HTTP 429/.test(e.message) && /per ?day|PerDay|daily/i.test(e.message));
        if (daily) st.mainOffDay = day;
        st.used++;
        st.hourly.push(now);
        const out = await callModel(token, FALLBACK, system, user);
        st.model = FALLBACK;
        return out;
      }
      throw e;
    } finally {
      st.tokens = (st.tokens || 0) + (lastUsage?.total_tokens || 0);
    }
  }

  let done = 0;
  try {
    // 1) summaries: new / grown stories, and results from older prompts
    if (room()) {
      const need = stories
        .filter((s) => now - s.first < 18 * 3600e3)
        .filter((s) => {
          const r = st.res[keyOf.get(s)];
          return !r || r.v !== VERSION || (s.sourceCount >= r.n * 2 && s.sourceCount >= r.n + 3 && now - r.at > 3600e3);
        })
        .sort((a, b) => b.score - a.score) // most important first — world and Israeli alike
        .slice(0, PER_REQUEST);
      if (need.length) {
        const out = await call(SYSTEM + style, need.map((s, i) => `### id: s${i}\n${storyInput(s, sums, heName)}`).join('\n\n'), true);
        for (const r of out.stories || []) for (const k of ['title_he', 'summary_he', 'summary_en']) if (r[k]) r[k] = clean(r[k]);
        for (const r of out.stories || []) {
          const s = need[Number(String(r.id).replace(/\D/g, ''))];
          if (!s || !goodHe(r.title_he) || !goodHe(r.summary_he)) continue; // rejected → retried on a later run
          const facts = (Array.isArray(r.facts_he) ? r.facts_he : []).filter(goodHe).slice(0, 4).map((f) => clip(f.trim(), 200));
          const quotes = (Array.isArray(r.quotes_he) ? r.quotes_he : [])
            .filter((q) => q && goodHe(q.he) && typeof q.who === 'string' && q.who.trim())
            .slice(0, 2)
            .map((q) => ({ who: clip(q.who.trim(), 60), he: clip(q.he.trim().replace(/^[״"']+|[״"']+$/g, ''), 300) }));
          st.res[keyOf.get(s)] = { v: VERSION, title_he: clip(r.title_he, 220), summary_he: clip(r.summary_he, 600), summary_en: clip(r.summary_en, 600), facts, ...(quotes.length ? { quotes } : {}), n: s.sourceCount, at: now };
          done++;
        }
      }
    }
    // 2) headlines: foreign stories without a (current) summary still get a real Hebrew headline
    if (room()) {
      const heads = stories
        .filter((s) => s.lang !== 'he' && now - s.first < 18 * 3600e3)
        .filter((s) => !st.res[keyOf.get(s)] && !st.heads[keyOf.get(s)]) // no AI text at all yet
        .sort((a, b) => b.score - a.score)
        .slice(0, HEADLINES_PER_REQUEST);
      if (heads.length >= 5) {
        const out = await call(HEAD_SYSTEM + style, heads.map((s, i) => `${i}. ${clip(s.title, 200)}${namesLine(s, heName)}`).join('\n'));
        for (const r of out.titles || []) if (r.title_he) r.title_he = clean(r.title_he);
        for (const r of out.titles || []) {
          const s = heads[Number(String(r.id).replace(/\D/g, ''))];
          if (s && goodHe(r.title_he)) st.heads[keyOf.get(s)] = { title_he: clip(r.title_he, 220), at: now };
        }
      }
    }
    st.error = null;
  } catch (e) {
    st.error = String(e.message).slice(0, 200);
    if (/HTTP 429/.test(st.error)) st.cooldownUntil = now + 30 * 60000; // both models rate-limited: wait a while
  }

  // attach: a current summary, else an older one, else at least an AI headline
  for (const s of stories) {
    const r = st.res[keyOf.get(s)];
    const h = st.heads[keyOf.get(s)];
    if (r) s.ai = { he: { title: r.title_he, sum: r.summary_he, ...(r.facts?.length ? { facts: r.facts } : {}), ...(r.quotes?.length ? { quotes: r.quotes } : {}) }, en: { sum: r.summary_en } };
    else if (h) s.ai = { he: { title: h.title_he } };
  }
  return { ai: st, done };
}
