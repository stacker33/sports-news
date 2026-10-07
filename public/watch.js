// Watchlist page: inspect the registry and the searches it generates, and prepare changes.
// The published site is static: changes stay in this browser as a draft until exported to a file that the admin
// commits (config/watchlist-overrides.json). In local mode (npm start) the same changes can be saved directly.
import { validateOverrides, PRIORITIES, LOCALES, activeNow } from './watchlist-rules.js';

const FEEDBACK_TOPIC = 'https://ntfy.sh/sports-radar-disc-feedback-c8a04d373ec8351d';
const store = {
  get(k, d) { try { return JSON.parse(localStorage.getItem('sr.' + k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem('sr.' + k, JSON.stringify(v)); } catch {} },
  del(k) { try { localStorage.removeItem('sr.' + k); } catch {} },
};
const th = store.get('theme', 'auto');
if (th !== 'auto') document.documentElement.dataset.theme = th;

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const clone = (o) => JSON.parse(JSON.stringify(o));

let ui = store.get('ui', 'he');
const T = {
  he: {
    title: 'ניהול מעקב', back: '← רדאר ספורט',
    tabs: { entries: 'רשומות', queries: 'חיפושים', tracking: 'משפחות ומעקב זמני', quality: 'איכות' },
    modeLocal: 'מצב מקומי: אפשר לשמור שינויים ישירות. הרשימה תיבנה מחדש והרדאר ירוץ.',
    modeStatic: 'השינויים נשמרים רק בדפדפן הזה (טיוטה). כדי להפעיל אותם בפועל: ייצוא קובץ ושליחה למנהל המערכת.',
    updated: (t) => `נתונים מ-${t}`,
    draft: (n) => `${n} שינויים בטיוטה`, noDraft: 'אין שינויים', save: 'שמירה', exportF: 'ייצוא קובץ', copy: 'העתקה', importF: 'ייבוא קובץ', discard: 'ביטול שינויים',
    saved: 'נשמר. הרדאר רץ עם השינויים.', copied: 'הועתק', badImport: 'הקובץ לא תקין:', imported: 'הקובץ נטען לטיוטה',
    search: 'חיפוש שם…', all: 'הכל', onlyChanged: 'רק עם שינויים', more: (n) => `עוד ${n}`,
    status: { verified: 'מאומת', pending: 'ממתין לאימות', 'source-only': 'זיהוי בלבד', excluded: 'הוצא' },
    type: { player: 'שחקן', coach: 'מאמן', club: 'קבוצה', agent: 'סוכן', 'former-player': 'שחקן לשעבר', media: 'פרשן' },
    sport: { football: 'כדורגל', basketball: 'כדורסל', other: 'אחר' },
    prio: { high: 'גבוהה', normal: 'רגילה', low: 'נמוכה' },
    ambiguous: 'שם דו-משמעי: נדרש הקשר', searched: 'בחיפוש', notSearched: 'לא בחיפוש',
    enabled: 'פעיל', priority: 'עדיפות', langs: 'שפות', until: 'מעקב זמני עד', clear: 'ניקוי', details: 'פרטים',
    hits: (n) => `${n} ידיעות עכשיו`, queriesN: (n) => `${n} חיפושים`, reset: 'איפוס הרשומה',
    verifyH: 'אימות (דורש בסיס והערה)', basis: 'בסיס', note: 'הערה', setStatus: 'סטטוס',
    basisOpts: { editor: 'אומת על ידי הדסק', 'official-source': 'מקור רשמי', 'kb-nationality': 'מאגר 365' },
    q: { text: 'החיפוש', why: 'למה קיים', state: 'מצב', last: 'נבדק', count: 'תוצאות', value: 'ערך', never: 'עוד לא', next: 'הבא', fails: (n) => `${n} כשלונות`, valueTxt: (v) => `${v.stories} ידיעות · ${v.uniqueRelevant} ייחודיות ורלוונטיות · ${v.redundant}/${v.items} נמצאו גם במקור אחר` },
    families: 'משפחות חיפוש', famNames: { israeliAngle: 'זווית ישראלית (10 שפות)', exceptional: 'סיפורים חריגים' },
    temp: 'מעקב זמני (רשומות עם תאריך תפוגה)', noTemp: 'אין. אפשר להגדיר "מעקב זמני עד" בכל רשומה.', expires: (t) => `פג ב-${t}`, expired: 'פג', renew7: 'חידוש ל-7 ימים',
    follows: 'מנויי איסוף פעילים ("עקוב ברדאר", 6 שעות)', followsNote: 'הרדאר מחפש את אלה בפועל. חידוש שולח בקשה לרדאר וייכנס בריצה הבאה.', noFollows: 'אין כרגע', renew: 'חידוש ל-6 שעות', renewed: 'נשלח',
    topics: (n) => `נושאים שמורים באפליקציה בדפדפן הזה: ${n}. אלה סינון תצוגה בלבד: הם לא מוסיפים איסוף.`,
    worker: 'חיפוש מיידי ברשת', workerOff: 'לא מוגדר. הרדאר עובד בלעדיו. להפעלה: worker/README.md (חשבון Cloudflare, ואז כתובת ב-SEARCH_URL).', workerOn: (u) => `מוגדר: ${u}`,
    qual: {
      useful: 'שימושיות לפי הצבעות עורכים', all: 'הכל', foreign: 'גילוי מחו"ל', israeli: 'מעקב ישראלי', rate: (r, n) => `${r}% שימושי (מתוך ${n} ידיעות)`, few: 'מעט מדי הצבעות כדי לשפוט', none: 'אין הצבעות',
      why: { useful: 'שימושי', irrelevant: 'לא רלוונטי', covered: 'כבר סוקר', duplicate: 'כפילות', identity: 'זיהוי שגוי' },
      delay: 'זמן עד גילוי (חציון, לפי זמן פרסום אמין)', delayRow: (k, d) => `${k}: ${d.medianMin == null ? '-' : d.medianMin + ' דק׳'} (n=${d.n})`, delayK: { watch: 'חיפושי מעקב', google: 'גוגל', direct: 'פידים ישירים' },
      rejected: 'סיבות סינון (24 שעות)', low: (n) => `סיבות לדירוג נמוך בגילוי מחו"ל (${n} ידיעות)`, top: 'חיפושים עם הכי הרבה ממצאים ייחודיים',
      note: 'מדידה בלבד: המספרים לא משנים את האיסוף. אין כאן טענה על שיפור בכיסוי בלי השוואה (ראו scripts/evaluate.mjs).',
      registry: (r) => `${r.verified} מאומתים · ${r.pending} ממתינים · ${r.sourceOnly} לזיהוי בלבד`,
    },
    why: { junk: 'זבל / הימורים / לייב', 'site-title': 'שם אתר', 'general-feed': 'לא ספורט', section: 'מדור לא ספורט', 'no-sport': 'אין ראיה לספורט', rival: 'עיתונות יריבה', user: 'עורך', video: 'וידאו', hidden: 'מוסתר' },
    limits: { single: 'מקור יחיד', 'origin-unknown': 'מקור לא ידוע', cites: 'מצטט מקור שלא נאסף', exclusive: '"בלעדי" לא מאומת', time: 'זמן לא ידוע', local: 'ליגה מקומית', 's5-unavailable': 'בדיקת ספורט 5 לא זמינה', page: 'דף מידע', headline: 'רק כותרת' },
  },
  en: {
    title: 'Watchlist', back: '← Sports Radar',
    tabs: { entries: 'Entries', queries: 'Searches', tracking: 'Families & temporary', quality: 'Quality' },
    modeLocal: 'Local mode: changes can be saved directly. The registry is rebuilt and the radar runs.',
    modeStatic: 'Changes stay in this browser only (a draft). To apply them: export the file and send it to the admin.',
    updated: (t) => `Data from ${t}`,
    draft: (n) => `${n} changes in the draft`, noDraft: 'No changes', save: 'Save', exportF: 'Export file', copy: 'Copy', importF: 'Import file', discard: 'Discard changes',
    saved: 'Saved. The radar is running with the changes.', copied: 'Copied', badImport: 'The file is not valid:', imported: 'File loaded into the draft',
    search: 'Search a name…', all: 'All', onlyChanged: 'Changed only', more: (n) => `${n} more`,
    status: { verified: 'Verified', pending: 'Pending verification', 'source-only': 'Recognition only', excluded: 'Excluded' },
    type: { player: 'Player', coach: 'Coach', club: 'Club', agent: 'Agent', 'former-player': 'Former player', media: 'Pundit' },
    sport: { football: 'Football', basketball: 'Basketball', other: 'Other' },
    prio: { high: 'High', normal: 'Normal', low: 'Low' },
    ambiguous: 'Ambiguous name: needs context', searched: 'Searched', notSearched: 'Not searched',
    enabled: 'On', priority: 'Priority', langs: 'Languages', until: 'Temporary until', clear: 'Clear', details: 'Details',
    hits: (n) => `${n} stories now`, queriesN: (n) => `${n} searches`, reset: 'Reset entry',
    verifyH: 'Verification (needs a basis and a note)', basis: 'Basis', note: 'Note', setStatus: 'Status',
    basisOpts: { editor: 'Confirmed by the desk', 'official-source': 'Official source', 'kb-nationality': '365 knowledge base' },
    q: { text: 'Search', why: 'Why it exists', state: 'State', last: 'Checked', count: 'Results', value: 'Value', never: 'not yet', next: 'next', fails: (n) => `${n} failures`, valueTxt: (v) => `${v.stories} stories · ${v.uniqueRelevant} unique and relevant · ${v.redundant}/${v.items} also found elsewhere` },
    families: 'Search families', famNames: { israeliAngle: 'Israeli angle (10 languages)', exceptional: 'Exceptional stories' },
    temp: 'Temporary tracking (entries with an expiry)', noTemp: 'None. Any entry can get a "temporary until" date.', expires: (t) => `expires ${t}`, expired: 'expired', renew7: 'Renew for 7 days',
    follows: 'Active collection subscriptions ("follow in the radar", 6 hours)', followsNote: 'The radar is really searching for these. Renewing sends a request to the radar; it applies on the next run.', noFollows: 'None right now', renew: 'Renew for 6 hours', renewed: 'Sent',
    topics: (n) => `Topics saved in the app in this browser: ${n}. Those are display filters only: they add no collection.`,
    worker: 'Instant web search', workerOff: 'Not configured. The radar works without it. To enable: worker/README.md (a Cloudflare account, then its address in SEARCH_URL).', workerOn: (u) => `Configured: ${u}`,
    qual: {
      useful: 'Usefulness by editor votes', all: 'All', foreign: 'Foreign discovery', israeli: 'Israeli monitoring', rate: (r, n) => `${r}% useful (of ${n} stories)`, few: 'Too few votes to judge', none: 'No votes',
      why: { useful: 'Useful', irrelevant: 'Not relevant', covered: 'Already covered', duplicate: 'Duplicate', identity: 'Wrong identity' },
      delay: 'Time to discovery (median, trustworthy publication times only)', delayRow: (k, d) => `${k}: ${d.medianMin == null ? '-' : d.medianMin + ' min'} (n=${d.n})`, delayK: { watch: 'Watch searches', google: 'Google', direct: 'Direct feeds' },
      rejected: 'Rejection reasons (24 hours)', low: (n) => `Why stories ranked low in foreign discovery (${n} stories)`, top: 'Searches with the most unique finds',
      note: 'Measurement only: these numbers do not change collection. No coverage-improvement claim without a comparison (see scripts/evaluate.mjs).',
      registry: (r) => `${r.verified} verified · ${r.pending} pending · ${r.sourceOnly} recognition only`,
    },
    why: { junk: 'junk / betting / live', 'site-title': 'site name', 'general-feed': 'not sport', section: 'non-sport section', 'no-sport': 'no sport evidence', rival: 'opponent press', user: 'editor', video: 'video', hidden: 'hidden' },
    limits: { single: 'single source', 'origin-unknown': 'origin unknown', cites: 'cites uncollected source', exclusive: 'unverified "exclusive"', time: 'time unknown', local: 'local league', 's5-unavailable': 'Sport5 check unavailable', page: 'reference page', headline: 'headline only' },
  },
};
const t = () => T[ui];

let data = null; // public/data/watch.json
let base = { entries: {}, families: {} }; // overrides currently in effect
let draft = null; // this browser's changes
let local = false; // npm start: the server can save
let tab = store.get('watchTab', 'entries');
let filt = { q: '', status: 'all', type: 'all', changed: false, limit: 120 };
const open = new Set();

const fmt = (ts) => (ts ? new Date(ts).toLocaleString(ui === 'he' ? 'he-IL' : 'en-GB', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');
function ago(ts) {
  if (!ts) return t().q.never;
  const m = Math.round((Date.now() - ts) / 60000);
  if (m < 60) return ui === 'he' ? `לפני ${m} דק׳` : `${m} min ago`;
  const h = Math.round(m / 60);
  return h < 48 ? (ui === 'he' ? `לפני ${h} שע׳` : `${h} h ago`) : fmt(ts);
}

function changes() {
  const n = (o) => JSON.stringify(o || {});
  const ids = new Set([...Object.keys(base.entries || {}), ...Object.keys(draft.entries || {})]);
  let c = 0;
  for (const id of ids) if (n(base.entries?.[id]) !== n(draft.entries?.[id])) c++;
  for (const f of new Set([...Object.keys(base.families || {}), ...Object.keys(draft.families || {})])) if (n(base.families?.[f]) !== n(draft.families?.[f])) c++;
  return c;
}
const changedId = (id) => JSON.stringify(base.entries?.[id] || {}) !== JSON.stringify(draft.entries?.[id] || {});
function saveDraft() {
  if (changes()) store.set('watchDraft', draft);
  else store.del('watchDraft');
  renderBar();
}
function setField(id, k, v) {
  const o = { ...(draft.entries[id] || {}) };
  if (v === undefined || v === '' || v === null) delete o[k];
  else o[k] = v;
  if (Object.keys(o).length) draft.entries[id] = o;
  else delete draft.entries[id];
  saveDraft();
}
// the value an entry shows: the draft's, else what is in effect
const val = (e, k) => (draft.entries[e.id] && k in draft.entries[e.id] ? draft.entries[e.id][k] : k === 'enabled' ? e.enabled : k === 'priority' ? e.priority : k === 'langs' ? e.langs : k === 'until' ? e.until || '' : e[k]);

async function load() {
  const res = await fetch(`data/watch.json?t=${Date.now()}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`watch.json HTTP ${res.status}`);
  data = await res.json();
  base = clone(data.overrides || { entries: {}, families: {} });
  try {
    const r = await fetch('api/watchlist-overrides', { cache: 'no-store' });
    if (r.ok) {
      const j = await r.json();
      local = !!j.editable;
      base = validateOverrides(j.overrides).clean;
    }
  } catch {}
  draft = store.get('watchDraft', null) || clone(base);
  draft.entries ??= {};
  draft.families ??= {};
}

// ---------- rendering ----------
function render() {
  document.documentElement.lang = ui;
  document.documentElement.dir = ui === 'he' ? 'rtl' : 'ltr';
  $('title').textContent = t().title;
  $('backLink').textContent = t().back;
  $('langBtn').textContent = ui === 'he' ? 'EN' : 'עב';
  $('mode').innerHTML = `${esc(local ? t().modeLocal : t().modeStatic)} <span class="wl-muted">${esc(t().updated(fmt(data.generatedAt)))} · ${esc(t().qual.registry(data.registry))}</span>`;
  $('mode').className = 'wl-mode' + (local ? ' local' : '');
  $('tabs').innerHTML = Object.entries(t().tabs).map(([k, v]) => `<button type="button" role="tab" data-tab="${k}" aria-selected="${k === tab}">${esc(v)}</button>`).join('');
  renderBar();
  const m = { entries: entriesHtml, queries: queriesHtml, tracking: trackingHtml, quality: qualityHtml }[tab] || entriesHtml;
  $('main').innerHTML = m();
}
function renderBar() {
  const n = changes();
  $('draftBar').hidden = false;
  $('draftBar').innerHTML = `<b>${esc(n ? t().draft(n) : t().noDraft)}</b><span class="wl-sp"></span>
    ${local ? `<button type="button" data-act="save" class="primary"${n ? '' : ' disabled'}>${esc(t().save)}</button>` : ''}
    <button type="button" data-act="export">${esc(t().exportF)}</button>
    <button type="button" data-act="copy">${esc(t().copy)}</button>
    <button type="button" data-act="import">${esc(t().importF)}</button>
    ${n ? `<button type="button" data-act="discard">${esc(t().discard)}</button>` : ''}
    <span class="wl-msg" id="barMsg" role="status"></span>`;
}

function entriesHtml() {
  const L = t();
  const q = filt.q.trim().toLowerCase();
  const list = data.entries.filter((e) =>
    (filt.status === 'all' || e.status === filt.status) &&
    (filt.type === 'all' || e.type === filt.type) &&
    (!filt.changed || changedId(e.id)) &&
    (!q || [e.name, e.he, ...(e.aliases || [])].some((n) => String(n).toLowerCase().includes(q))));
  const opts = (o, cur) => Object.entries(o).map(([k, v]) => `<option value="${k}"${k === cur ? ' selected' : ''}>${esc(v)}</option>`).join('');
  const types = [...new Set(data.entries.map((e) => e.type))];
  const head = `<div class="wl-filters">
    <input type="search" id="fq" placeholder="${esc(L.search)}" value="${esc(filt.q)}" dir="auto">
    <select id="fstatus"><option value="all">${esc(L.all)}</option>${opts(L.status, filt.status)}</select>
    <select id="ftype"><option value="all">${esc(L.all)}</option>${types.map((k) => `<option value="${k}"${k === filt.type ? ' selected' : ''}>${esc(L.type[k] || k)}</option>`).join('')}</select>
    <label class="wl-chk"><input type="checkbox" id="fchanged"${filt.changed ? ' checked' : ''}> ${esc(L.onlyChanged)}</label>
    <span class="wl-muted">${list.length}</span>
  </div>`;
  const rows = list.slice(0, filt.limit).map(entryHtml).join('');
  const more = list.length > filt.limit ? `<button type="button" class="wl-more" data-act="more">${esc(L.more(list.length - filt.limit))}</button>` : '';
  return head + `<div class="wl-list">${rows}</div>` + more;
}

function entryHtml(e) {
  const L = t();
  const d = draft.entries[e.id] || {};
  const status = d.status || e.status;
  const until = val(e, 'until');
  const expired = until && !activeNow({ until });
  const searchable = e.searched?.yes;
  const queries = data.queries.filter((x) => x.entryIds.includes(e.id));
  const canSearch = e.status === 'verified' && e.type !== 'club';
  return `<article class="wl-entry${changedId(e.id) ? ' changed' : ''}" data-id="${esc(e.id)}">
    <div class="wl-e-top">
      <div class="wl-e-name"><b dir="auto">${esc(e.he || e.name)}</b>${e.he ? ` <span dir="ltr">${esc(e.name)}</span>` : ''}
        ${e.aliases?.length ? `<span class="wl-muted" dir="ltr"> (${esc(e.aliases.join(', '))})</span>` : ''}
        <div class="wl-tags">
          <span class="wl-badge st-${esc(status)}" title="${esc(e.note)}">${esc(L.status[status] || status)}</span>
          <span class="wl-badge">${esc(L.type[e.type] || e.type)} · ${esc(L.sport[e.sport] || e.sport)}${e.team ? ` · ${esc(e.team)}` : ''}</span>
          ${e.ambiguous ? `<span class="wl-badge warn">${esc(L.ambiguous)}</span>` : ''}
          <span class="wl-badge ${searchable ? 'ok' : ''}" title="${esc(trWhy(e.searched?.why))}">${esc(searchable ? L.searched : L.notSearched)}</span>
          ${e.hits ? `<span class="wl-badge">${esc(L.hits(e.hits))}</span>` : ''}
          ${until ? `<span class="wl-badge ${expired ? 'warn' : ''}">${esc(expired ? L.expired : L.expires(fmt(new Date(until).getTime())))}</span>` : ''}
        </div>
        <p class="wl-note wl-muted" dir="auto">${esc(e.note)}${e.searched && !searchable ? ` · ${esc(trWhy(e.searched.why))}` : ''}</p>
      </div>
      <button type="button" class="wl-det" data-act="toggle" aria-expanded="${open.has(e.id)}">${esc(L.details)}${queries.length ? ` · ${esc(L.queriesN(queries.length))}` : ''}</button>
    </div>
    ${open.has(e.id) ? `<div class="wl-e-body">
      ${canSearch ? `<div class="wl-ctrls">
        <label class="wl-chk"><input type="checkbox" data-f="enabled"${val(e, 'enabled') !== false ? ' checked' : ''}> ${esc(L.enabled)}</label>
        <label>${esc(L.priority)} <select data-f="priority">${PRIORITIES.map((p) => `<option value="${p}"${p === val(e, 'priority') ? ' selected' : ''}>${esc(L.prio[p])}</option>`).join('')}</select></label>
        <label>${esc(L.langs)} <input data-f="langs" dir="ltr" size="14" value="${esc((val(e, 'langs') || []).join(', '))}" title="${esc(LOCALES.join(', '))}"></label>
        <label>${esc(L.until)} <input type="date" data-f="until" value="${esc(until ? String(until).slice(0, 10) : '')}"></label>
        ${until ? `<button type="button" data-act="clearUntil">${esc(L.clear)}</button>` : ''}
      </div>` : ''}
      ${e.status !== 'source-only' ? `<fieldset class="wl-verify"><legend>${esc(L.verifyH)}</legend>
        <label>${esc(L.setStatus)} <select data-v="status"><option value="">-</option>${['verified', 'pending', 'excluded'].map((s) => `<option value="${s}"${d.status === s ? ' selected' : ''}>${esc(L.status[s])}</option>`).join('')}</select></label>
        <label>${esc(L.basis)} <select data-v="basis"><option value="">-</option>${Object.entries(L.basisOpts).map(([k, v]) => `<option value="${k}"${d.israelLink?.basis === k ? ' selected' : ''}>${esc(v)}</option>`).join('')}</select></label>
        <label class="wl-grow">${esc(L.note)} <input data-v="note" dir="auto" value="${esc(d.israelLink?.note || d.note || '')}"></label>
      </fieldset>` : ''}
      ${queries.length ? `<div class="wl-qs">${queries.map(queryRow).join('')}</div>` : ''}
      ${draft.entries[e.id] ? `<button type="button" data-act="reset">${esc(L.reset)}</button>` : ''}
      <p class="wl-err" hidden></p>
    </div>` : ''}
  </article>`;
}

// the collector's reasons are in English; Hebrew renderings for the page
const HE_SPORT = { football: 'כדורגל', basketball: 'כדורסל', other: 'ענפים אחרים' };
function trWhy(w) {
  if (ui !== 'he' || !w) return w || '';
  let m;
  if ((m = w.match(/^name search: verified (\w+) people \((\d+)\), (.+)$/))) return `חיפוש שם: ${m[2]} מאומתים (${HE_SPORT[m[1]] || m[1]}), ${m[3]}`;
  if ((m = w.match(/^name \+ club: "(.+)" is an ambiguous name$/))) return `שם + קבוצה: "${m[1]}" הוא שם דו-משמעי`;
  if ((m = w.match(/^discovery: Israeli angle \((.+)\)$/))) return `גילוי: זווית ישראלית (${m[1]})`;
  if ((m = w.match(/^discovery: exceptional stories \((.+)\)$/))) return `גילוי: סיפורים חריגים (${m[1]})`;
  if ((m = w.match(/^backoff after (\d+) failure/))) return `המתנה אחרי ${m[1]} כשלונות`;
  return {
    ran: 'רץ בריצה האחרונה', 'not due yet': 'עוד לא הגיע תורו', "over this run's budget": 'נדחה: מעבר לתקציב הריצה',
    'pending verification - not searched': 'ממתין לאימות - לא בחיפוש', 'recognition only - not searched': 'לזיהוי בלבד - לא בחיפוש',
    'club - covered by club and league feeds': 'קבוצה - מכוסה בפידים של קבוצות וליגות', 'temporary tracking expired': 'המעקב הזמני פג',
    'disabled by an editor': 'כובה על ידי עורך', "on the editors' ליגיונרים list - has its own feeds": 'ברשימת הליגיונרים - יש לו פידים משלו',
    'verified - name search': 'מאומת - בחיפוש שם',
  }[w] || w;
}

function queryRow(x) {
  const L = t().q;
  const v = x.value;
  return `<div class="wl-q">
    <code dir="ltr">${esc(x.q)}</code>
    <div class="wl-muted">${esc(trWhy(x.why))} · ${esc(x.locale)} · ${esc(t().prio[x.priority])}</div>
    <div class="wl-q-meta">
      <span>${esc(L.state)}: ${esc(trWhy(x.state))}</span>
      <span>${esc(L.last)}: ${esc(ago(x.last))}</span>
      ${x.count != null ? `<span>${esc(L.count)}: ${x.count}</span>` : ''}
      ${x.fails ? `<span class="warn">${esc(L.fails(x.fails))}</span>` : ''}
      ${x.error ? `<span class="warn" dir="ltr">${esc(x.error)}</span>` : ''}
      ${x.nextAt ? `<span>${esc(L.next)}: ${esc(fmt(x.nextAt))}</span>` : ''}
      ${v ? `<span>${esc(L.value)}: ${esc(L.valueTxt(v))}</span>` : ''}
      ${v && Object.keys(v.rejected).length ? `<span>${esc(Object.entries(v.rejected).map(([k, n]) => `${t().why[k] || k} ${n}`).join(', '))}</span>` : ''}
    </div>
  </div>`;
}

function queriesHtml() {
  const order = (x) => (x.state === 'ran' ? 0 : x.fails ? 1 : 2);
  const list = [...data.queries].sort((a, b) => order(a) - order(b) || (b.last || 0) - (a.last || 0));
  return `<p class="wl-muted">${esc(ui === 'he' ? `עד ${data.budget} חיפושים בכל ריצה; השאר נדחים עם סיבה. ${data.queries.length} חיפושים בסך הכל.` : `Up to ${data.budget} searches per run; the rest are deferred with a reason. ${data.queries.length} searches in all.`)}</p>
    <div class="wl-qs">${list.map(queryRow).join('')}</div>`;
}

function trackingHtml() {
  const L = t();
  const fams = data.families.map((f) => {
    const d = draft.families[f.key] || {};
    const on = 'enabled' in d ? d.enabled : f.enabled;
    return `<div class="wl-fam" data-fam="${f.key}"><label class="wl-chk"><input type="checkbox" data-ff="enabled"${on ? ' checked' : ''}> <b>${esc(L.famNames[f.key] || f.key)}</b></label>
      <select data-ff="priority"><option value="">${esc(L.priority)}: -</option>${PRIORITIES.map((p) => `<option value="${p}"${(d.priority || f.priority) === p ? ' selected' : ''}>${esc(L.prio[p])}</option>`).join('')}</select>
      <span class="wl-muted">${esc(L.queriesN(f.queries))}</span></div>`;
  }).join('');
  const temp = data.entries.filter((e) => val(e, 'until'));
  const follows = (data.follows || []).filter((f) => f.expires > Date.now());
  const topicsN = store.get('topics', []).length;
  return `<h2>${esc(L.families)}</h2>${fams}
    <h2>${esc(L.temp)}</h2>
    ${temp.length ? temp.map((e) => {
      const u = val(e, 'until');
      const ok = activeNow({ until: u });
      return `<div class="wl-fam" data-id="${esc(e.id)}"><b dir="auto">${esc(e.he || e.name)}</b> <span class="wl-badge ${ok ? '' : 'warn'}">${esc(ok ? L.expires(fmt(new Date(u).getTime())) : L.expired)}</span> <button type="button" data-act="renew7">${esc(L.renew7)}</button></div>`;
    }).join('') : `<p class="wl-muted">${esc(L.noTemp)}</p>`}
    <h2>${esc(L.follows)}</h2><p class="wl-muted">${esc(L.followsNote)}</p>
    ${follows.length ? follows.map((f) => `<div class="wl-fam"><b dir="auto">${esc(f.q)}</b> <span class="wl-badge">${esc(L.expires(fmt(f.expires)))}</span> <button type="button" data-act="renewFollow" data-q="${esc(f.q)}">${esc(L.renew)}</button></div>`).join('') : `<p class="wl-muted">${esc(L.noFollows)}</p>`}
    <p class="wl-muted">${esc(L.topics(topicsN))}</p>
    <h2>${esc(L.worker)}</h2><p class="wl-muted" id="workerState">…</p>`;
}

function qualityHtml() {
  const Q = t().qual;
  const qd = data.quality || {};
  const u = qd.usefulness || {};
  const useRow = (k) => {
    const x = u[k];
    if (!x || !x.n) return `<li>${esc(Q[k])}: ${esc(Q.none)}</li>`;
    const why = Object.entries(x.why || {}).map(([w, n]) => `${Q.why[w] || w} ${n}`).join(', ');
    return `<li>${esc(Q[k])}: ${esc(Q.rate(x.rate, x.n))}${x.enough ? '' : ` <span class="wl-badge warn">${esc(Q.few)}</span>`}${why ? ` <span class="wl-muted">(${esc(why)})</span>` : ''}</li>`;
  };
  const delay = Object.entries(qd.delay || {}).map(([k, d]) => `<li>${esc(Q.delayRow(Q.delayK[k] || k, d))}</li>`).join('');
  const rej = Object.entries(qd.low?.rejected || {}).sort((a, b) => b[1] - a[1]).map(([k, n]) => `<li>${esc(t().why[k] || k)}: ${n}</li>`).join('');
  const low = Object.entries(qd.low?.lowRankLimits || {}).sort((a, b) => b[1] - a[1]).map(([k, n]) => `<li>${esc(t().limits[k] || k)}: ${n}</li>`).join('');
  const top = data.queries.filter((x) => x.value?.unique).sort((a, b) => b.value.uniqueRelevant - a.value.uniqueRelevant || b.value.unique - a.value.unique).slice(0, 8);
  return `<p class="wl-muted">${esc(Q.note)}</p>
    <div class="wl-grid">
      <section><h2>${esc(Q.useful)}</h2><ul>${['all', 'foreign', 'israeli'].map(useRow).join('')}</ul></section>
      <section><h2>${esc(Q.delay)}</h2><ul>${delay}</ul></section>
      <section><h2>${esc(Q.rejected)}</h2><ul>${rej || '<li>-</li>'}</ul></section>
      <section><h2>${esc(Q.low(qd.low?.lowRanked || 0))}</h2><ul>${low || '<li>-</li>'}</ul></section>
    </div>
    <h2>${esc(Q.top)}</h2><div class="wl-qs">${top.length ? top.map(queryRow).join('') : '<p class="wl-muted">-</p>'}</div>`;
}

async function workerState() {
  const el = $('workerState');
  if (!el) return;
  try {
    const src = await (await fetch('app.js', { cache: 'no-store' })).text();
    const url = (src.match(/const SEARCH_URL = '([^']*)'/) || [])[1] || '';
    el.textContent = url ? t().workerOn(url) : t().workerOff;
  } catch {
    el.textContent = t().workerOff;
  }
}

// ---------- events ----------
function msg(text, bad = false) {
  const el = $('barMsg');
  if (!el) return;
  el.textContent = text;
  el.classList.toggle('warn', bad);
}
function exportBody() {
  const { clean } = validateOverrides(draft);
  return JSON.stringify({ about: 'Editor decisions for the watchlist (from watch.html). Commit as config/watchlist-overrides.json, then run node scripts/build-watchlist.mjs.', ...clean }, null, 2) + '\n';
}

$('tabs').addEventListener('click', (e) => {
  const b = e.target.closest('[data-tab]');
  if (!b) return;
  tab = b.dataset.tab;
  store.set('watchTab', tab);
  render();
  if (tab === 'tracking') workerState();
});
$('langBtn').addEventListener('click', () => {
  ui = ui === 'he' ? 'en' : 'he';
  render();
  if (tab === 'tracking') workerState();
});

$('draftBar').addEventListener('click', async (e) => {
  const act = e.target.closest('[data-act]')?.dataset.act;
  if (act === 'discard') {
    draft = clone(base);
    store.del('watchDraft');
    render();
  } else if (act === 'export') {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([exportBody()], { type: 'application/json' }));
    a.download = 'watchlist-overrides.json';
    a.click();
    URL.revokeObjectURL(a.href);
  } else if (act === 'copy') {
    try {
      await navigator.clipboard.writeText(exportBody());
      msg(t().copied);
    } catch {}
  } else if (act === 'import') {
    $('importFile').click();
  } else if (act === 'save' && local) {
    const known = new Set(data.entries.map((x) => x.id));
    const v = validateOverrides(draft, known);
    if (!v.ok) return msg(`${t().badImport} ${v.errors.slice(0, 3).join('; ')}`, true);
    const r = await fetch('api/watchlist-overrides', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(v.clean) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return msg(`${t().badImport} ${(j.errors || [j.error]).slice(0, 3).join('; ')}`, true);
    store.del('watchDraft');
    base = clone(v.clean);
    msg(t().saved);
    setTimeout(async () => {
      await load();
      render();
    }, 8000);
  }
});

$('importFile').addEventListener('change', async (e) => {
  const f = e.target.files?.[0];
  e.target.value = '';
  if (!f) return;
  let raw;
  try {
    raw = JSON.parse(await f.text());
  } catch {
    return msg(`${t().badImport} JSON`, true);
  }
  const v = validateOverrides(raw, new Set(data.entries.map((x) => x.id)));
  if (!v.ok) return msg(`${t().badImport} ${v.errors.slice(0, 4).join('; ')}`, true);
  draft = clone(v.clean);
  saveDraft();
  render();
  msg(t().imported);
});

$('main').addEventListener('input', (e) => {
  if (e.target.id === 'fq') {
    filt.q = e.target.value;
    filt.limit = 120;
    const pos = e.target.selectionStart;
    render();
    $('fq').focus();
    $('fq').setSelectionRange(pos, pos);
  }
});
$('main').addEventListener('change', (e) => {
  const el = e.target;
  if (el.id === 'fstatus' || el.id === 'ftype' || el.id === 'fchanged') {
    filt = { ...filt, status: $('fstatus').value, type: $('ftype').value, changed: $('fchanged').checked, limit: 120 };
    return render();
  }
  const card = el.closest('[data-id]');
  const fam = el.closest('[data-fam]');
  if (fam && el.dataset.ff) {
    const d = { ...(draft.families[fam.dataset.fam] || {}) };
    if (el.dataset.ff === 'enabled') d.enabled = el.checked;
    else if (el.value) d.priority = el.value;
    else delete d.priority;
    draft.families[fam.dataset.fam] = d;
    saveDraft();
    return;
  }
  if (!card) return;
  const id = card.dataset.id;
  const err = card.querySelector('.wl-err');
  const f = el.dataset.f;
  if (f === 'enabled') setField(id, 'enabled', el.checked);
  else if (f === 'priority') setField(id, 'priority', el.value);
  else if (f === 'until') setField(id, 'until', el.value || undefined);
  else if (f === 'langs') {
    const langs = el.value.split(/[\s,]+/).filter(Boolean);
    const bad = langs.filter((l) => !LOCALES.includes(l));
    if (bad.length || !langs.length) {
      if (err) [err.hidden, err.textContent] = [false, `${bad.join(', ') || '-'}: ${LOCALES.join(', ')}`];
      return;
    }
    setField(id, 'langs', langs);
  } else if (el.dataset.v) {
    // verification: status + basis + note, checked by the shared rules before it enters the draft
    const st = card.querySelector('[data-v="status"]').value;
    const basis = card.querySelector('[data-v="basis"]').value;
    const note = card.querySelector('[data-v="note"]').value.trim();
    const o = { ...(draft.entries[id] || {}) };
    delete o.status;
    delete o.israelLink;
    delete o.note;
    if (st) o.status = st;
    if (st === 'verified') o.israelLink = { basis, note };
    else if (note) o.note = note;
    const v = validateOverrides({ entries: { [id]: o } });
    if (err) [err.hidden, err.textContent] = [v.ok, v.errors.join('; ')];
    if (!v.ok) return;
    if (Object.keys(o).length) draft.entries[id] = o;
    else delete draft.entries[id];
    saveDraft();
    return;
  }
  if (err) err.hidden = true;
  const box = card.closest('.wl-list') ? card : null;
  if (box) box.outerHTML = entryHtml(data.entries.find((x) => x.id === id));
});
$('main').addEventListener('click', async (e) => {
  const act = e.target.closest('[data-act]')?.dataset.act;
  if (!act) return;
  const card = e.target.closest('[data-id]');
  const id = card?.dataset.id;
  if (act === 'more') {
    filt.limit += 200;
    return render();
  }
  if (act === 'toggle' && id) {
    open.has(id) ? open.delete(id) : open.add(id);
    card.outerHTML = entryHtml(data.entries.find((x) => x.id === id));
    return;
  }
  if (act === 'reset' && id) {
    delete draft.entries[id];
    saveDraft();
  } else if (act === 'clearUntil' && id) setField(id, 'until', undefined);
  else if (act === 'renew7' && id) setField(id, 'until', new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10));
  else if (act === 'renewFollow') {
    const b = e.target.closest('[data-act]');
    await fetch(FEEDBACK_TOPIC, { method: 'POST', body: JSON.stringify({ v: 1, device: store.get('deviceId', '') || 'watch', type: 'search', q: b.dataset.q }) }).catch(() => {});
    b.textContent = t().renewed;
    b.disabled = true;
    return;
  }
  render();
  if (tab === 'tracking') workerState();
});

load()
  .then(() => {
    render();
    if (tab === 'tracking') workerState();
  })
  .catch((err) => {
    $('main').innerHTML = `<p class="wl-empty">${esc(err.message)}</p>`;
  });
