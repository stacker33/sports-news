// Discovery version, stage 2: source roles, evidence, truthful coverage, views and the editorial rank.
// No network: pure functions on synthetic stories.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { itemOrigin, itemRole, citedBy, storyEvidence, storyCoverage, coverageLabel, sport5Check, storyViews } from '../src/roles.js';
import { editorialRank, feedbackAdjust } from '../src/rank.js';
import { SOURCES } from '../config/sources.js';

const now = Date.parse('2026-10-08T12:00:00Z');
const item = (publisher, title, extra = {}) => ({ publisher, title, link: `https://news.google.com/rss/articles/${encodeURIComponent(publisher + title)}`, google: true, published: now - 3600e3, summary: '', sourceId: 'x', ...extra });

test('origin comes from the outlet, not the language', () => {
  assert.equal(itemOrigin(item('The Jerusalem Post', 'Maccabi sign striker')).origin, 'il'); // Israeli, in English
  assert.equal(itemOrigin(item('Times of Israel', 'Israel squad named')).origin, 'il');
  assert.equal(itemOrigin(item('ONE', 'x')).origin, 'il');
  assert.equal(itemOrigin(item('ספורט 1', 'x')).origin, 'il');
  assert.equal(itemOrigin(item('Marca', 'El Maccabi ficha a un delantero')).origin, 'foreign'); // foreign, Israeli subject
  assert.equal(itemOrigin(item('ESPN', 'Deni Avdija scores 30')).origin, 'foreign');
  assert.equal(itemOrigin({ publisher: 'Haaretz', link: 'https://www.haaretz.co.il/sport/1', title: 'x' }).origin, 'il');
  assert.equal(itemOrigin({ publisher: 'Some Site', link: 'https://example.co.il/a', title: 'x' }).origin, 'il'); // .il domain
  assert.equal(itemOrigin(item('', 'no publisher')).origin, 'unknown');
});

test('roles: Sport5, competitor, foreign press, official, reporter, aggregator', () => {
  assert.equal(itemRole({ ...item('ספורט 5', 'x'), sourceId: 'gn-he-sports' }), 'sport5'); // a Sport5 article found by any search
  assert.equal(itemRole({ publisher: 'Sport5', link: 'https://www.sport5.co.il/articles.aspx?id=1', title: 'x', sourceId: 'sport5-home' }), 'sport5');
  assert.equal(itemRole(item('ONE', 'x')), 'competitor');
  assert.equal(itemRole(item('Marca', 'x')), 'foreign-press');
  assert.equal(itemRole({ ...item('EuroLeague', 'x'), official: true }), 'official');
  assert.equal(itemRole({ ...item('Fabrizio Romano', 'x'), social: true }), 'reporter');
  assert.equal(itemRole(item('MSN', 'x')), 'aggregator');
});

test('every Israeli source is still collected (views only filter what is shown)', () => {
  const ids = new Set(SOURCES.map((s) => s.id));
  for (const id of ['one', 'walla-sport', 'ynet-sport', 'sport5-home', 'sport5', 'maariv-sport', 'haaretz-sport', 'israelhayom-gn', 'kan-sport', 'jpost-sport']) assert.ok(ids.has(id), id);
  // an Israeli-only story stays in the data and lands in the Israeli monitoring view, not dropped
  const s = { israel: true, _members: [item('ONE', 'מכבי חיפה ניצחה'), item('וואלה ספורט', 'מכבי חיפה ניצחה')] };
  const ev = storyEvidence(s);
  assert.deepEqual(storyViews(s, ev), ['i']);
  // a foreign story an Israeli outlet also covered stays in foreign discovery
  const both = { _members: [item('Marca', 'Real Madrid ficha'), item('ONE', 'ריאל מדריד החתימה')] };
  assert.deepEqual(storyViews(both, storyEvidence(both)), ['f', 'i']);
});

test('repeated reports are not independent confirmation', () => {
  const marca = item('Marca', 'El Barça quiere a Gloukh', { published: now - 5 * 3600e3 });
  const echoes = ['ONE', 'וואלה ספורט', 'ynet ספורט', 'ספורט 1', 'היום'].map((p, i) => item(p, `לפי מרקה: ברצלונה רוצה את גלוך (${i})`, { published: now - (4 - i * 0.2) * 3600e3 }));
  const ev = storyEvidence({ _members: [...echoes, marca] });
  assert.equal(ev.outlets, 6);
  assert.equal(ev.attrib, 'Marca');
  assert.equal(ev.attribBy, 5);
  assert.equal(ev.independent, 'unknown');
  assert.equal(ev.lead.name, 'Marca'); // the cited original is the lead
  assert.equal(ev.lead.status, 'attributed');
  const ed = editorialRank({ title: 'x', first: now - 3600e3, pop: 20, langs: ['he', 'es'], ev, cov: { s5: 'none', checkedAt: now, comp: [] }, _members: [] }, { now });
  const spread = ed.reasons.find((r) => r.k === 'shared');
  assert.ok(spread && /shared original attribution \(Marca\)/.test(spread.en));
  assert.ok(!ed.reasons.some((r) => /confirm|corroborat/i.test(r.en)));
});

test('similar titles alone are not attribution; the earliest report is not called the original', () => {
  const a = item('Sky Sports', 'Arsenal agree deal for winger', { published: now - 3 * 3600e3 });
  const b = item('Mirror', 'Arsenal agree deal for winger', { published: now - 2 * 3600e3 });
  const ev = storyEvidence({ _members: [b, a] });
  assert.equal(ev.attrib, undefined);
  assert.equal(ev.lead.name, 'Sky Sports');
  assert.equal(ev.lead.status, 'earliest'); // shown as "earliest foreign report seen - originality unknown"
  const ed = editorialRank({ title: a.title, first: a.published, pop: 5, ev, cov: { s5: 'none', checkedAt: now, comp: [] }, _members: [] }, { now });
  assert.ok(ed.limits.some((l) => l.k === 'origin-unknown'));
  // a mention without a reporting cue is not attribution
  assert.deepEqual(citedBy(item('ONE', 'מרקה חגגה 100 שנה')), []);
  assert.deepEqual(citedBy(item('ONE', 'לפי מרקה, ברצלונה מתעניינת')), ['Marca']);
});

test('uncertain or unavailable Sport5 coverage is never definitive absence', () => {
  const fresh = sport5Check({ 'sport5-home': { lastOk: now - 10 * 60000 } }, now);
  const stale = sport5Check({ 'sport5-home': { lastOk: now - 5 * 3600e3 } }, now);
  const never = sport5Check({}, now);
  const s = { _members: [item('Marca', 'x')] };
  assert.equal(storyCoverage(s, fresh).s5, 'none');
  assert.equal(storyCoverage(s, stale).s5, 'unavailable');
  assert.equal(storyCoverage(s, never).s5, 'unavailable');
  assert.equal(storyCoverage({ ...s, s5: { at: now, link: 'l', probable: true, where: 'site' } }, fresh).s5, 'possible');
  for (const lang of ['en', 'he']) {
    for (const c of [storyCoverage(s, fresh), storyCoverage(s, stale), storyCoverage({ ...s, s5: { probable: true } }, fresh)]) {
      const label = coverageLabel(c, lang);
      assert.ok(!/not published|לא פורסם|not on sport5|לא בספורט 5/i.test(label), label);
    }
  }
  assert.match(coverageLabel(storyCoverage(s, fresh), 'en'), /^No match found - last checked \d\d:\d\d$/);
  assert.equal(coverageLabel(storyCoverage(s, stale), 'en'), 'Coverage check unavailable');
  // the rank does not treat an unavailable check as "not covered"
  const ed = (cov) => editorialRank({ title: 'x', first: now, pop: 1, ev: { outlets: 1 }, cov, _members: [] }, { now });
  assert.ok(ed({ s5: 'unavailable', comp: [] }).dims.coverage < ed({ s5: 'none', checkedAt: now, comp: [] }).dims.coverage);
  assert.ok(ed({ s5: 'unavailable', comp: [] }).limits.some((l) => l.k === 's5-unavailable'));
  // competitors are reported separately from Sport5
  const comp = storyCoverage({ _members: [item('Marca', 'x'), item('ONE', 'y')] }, fresh, storyEvidence({ _members: [item('Marca', 'x'), item('ONE', 'y')] }));
  assert.deepEqual(comp.comp, ['ONE']);
  assert.equal(comp.s5, 'none');
});

test('editorial rank: a one-source local interview with a tracked Israeli ranks high and says why', () => {
  const interview = {
    title: 'Ταμίρ Μπλατ: «Θέλουμε τον τίτλο» - συνέντευξη',
    t: { en: { title: 'Tamir Blatt: "We want the title" - interview' } },
    first: now - 3600e3, pop: 1, langs: ['el'], local: false,
    watch: [{ name: 'Tamir Blatt', he: 'תמיר בלאט', type: 'player', status: 'verified', israelLink: true }],
    ev: { outlets: 1, il: 0, foreign: 1, lead: { status: 'only' } }, cov: { s5: 'none', checkedAt: now, comp: [] },
    _members: [{ title: 'Ταμίρ Μπλατ συνέντευξη' }],
  };
  const generic = { title: 'Coach praises squad depth', first: now - 3600e3, pop: 1, langs: ['el'], local: true, ev: { outlets: 1, il: 0, foreign: 1, lead: { status: 'only' } }, cov: { s5: 'none', checkedAt: now, comp: [] }, _members: [{ title: 'x' }] };
  const a = editorialRank(interview, { now });
  const b = editorialRank(generic, { now });
  assert.ok(a.score > b.score + 20, `${a.score} vs ${b.score}`);
  assert.equal(a.reasons[0].k, 'il-local-interview');
  assert.match(a.reasons[0].en, /Tracked Israeli mentioned in a local interview: Tamir Blatt/);
  assert.ok(a.limits.some((l) => l.k === 'single')); // interest is high, evidence is still one source
  assert.ok(a.limits.some((l) => l.k === 'headline'));
});

test('editorial rank: "exclusive" and publisher weight are not evidence; pending people claim no link', () => {
  const base = { first: now, pop: 1, ev: { outlets: 1 }, cov: { s5: 'none', checkedAt: now, comp: [] }, _members: [] };
  const ex = editorialRank({ ...base, title: 'EXCLUSIVE: Club close to signing striker' }, { now });
  assert.ok(ex.limits.some((l) => l.k === 'exclusive'));
  assert.ok(ex.dims.evidence < 0.5);
  const pend = editorialRank({ ...base, title: 'Will Rayman scores 20', watch: [{ name: 'Will Rayman', type: 'player', status: 'pending', israelLink: false }] }, { now });
  assert.equal(pend.reasons.find((r) => r.k === 'pending')?.en, 'Possibly Israel-linked (not verified): Will Rayman');
  assert.ok(pend.dims.israel < 0.5);
  // clubs are worded as clubs
  const club = editorialRank({ ...base, title: 'Maccabi Tel Aviv news', watch: [{ name: 'Maccabi Tel Aviv', he: 'מכבי תל אביב', type: 'club', status: 'verified', israelLink: true }] }, { now });
  assert.equal(club.reasons.find((r) => r.dim === undefined && r.k === 'il-club')?.he, 'קבוצה ישראלית: מכבי תל אביב');
});

test('editorial rank: reference pages are not news; Hebrew reasons use Hebrew names', () => {
  const base = { first: now, pop: 5, ev: { outlets: 1 }, cov: { s5: 'none', checkedAt: now, comp: [] }, _members: [] };
  for (const title of ['EuroLeague Injury Report (updated daily)', 'Emanuel Sharp | Guard | Sacramento Kings']) assert.equal(editorialRank({ ...base, title }, { now }).dims.news, 0.05, title);
  assert.equal(editorialRank({ ...base, title: 'Israeli Premier League', tags: [{ k: 'comp', id: 'c-ligat', en: 'Israeli Premier League', he: 'ליגת העל' }] }, { now }).dims.news, 0.05);
  assert.notEqual(editorialRank({ ...base, title: 'Sharp scores 20 as Kings beat Lakers' }, { now }).dims.news, 0.05);
  const ab = editorialRank({ ...base, title: 'x', athletes: ['Stav Lemkin'] }, { now, heName: (n) => ({ 'Stav Lemkin': 'סתיו למקין' })[n] || n });
  assert.equal(ab.reasons[0].he, 'ליגיונר: סתיו למקין');
});

test('feedback: sparse votes do nothing, many votes move the rank by a bounded amount', () => {
  assert.equal(feedbackAdjust({ up: ['a'] }).points, 0); // one device
  assert.equal(feedbackAdjust({ up: ['a', 'a', 'a', 'a'] }).points, 0); // the same device many times
  assert.equal(feedbackAdjust({ up: ['a', 'b'] }).used, false);
  const three = feedbackAdjust({ up: ['a', 'b', 'c'] });
  assert.ok(three.used && three.points > 0 && three.points < 6);
  const many = feedbackAdjust({ up: Array.from({ length: 50 }, (_, i) => `d${i}`) });
  assert.equal(many.points, 6); // capped
  const mixed = feedbackAdjust({ up: ['a', 'b', 'c', 'd'], down: ['e', 'f', 'g', 'h'] });
  assert.equal(mixed.points, 0);
  const base = { title: 'x', first: now, pop: 1, ev: { outlets: 1 }, cov: { s5: 'none', checkedAt: now, comp: [] }, _members: [] };
  const plain = editorialRank(base, { now }).score;
  const voted = editorialRank(base, { now, votes: { up: Array.from({ length: 50 }, (_, i) => `d${i}`) } }).score;
  assert.ok(voted - plain <= 6 + 1e-9 && voted > plain);
});
