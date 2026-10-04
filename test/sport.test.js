// Sport triage regression tests: real headlines that once landed in the wrong tab.
// Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify } from '../src/classify.js';
import { features, decideSport } from '../src/triage.js';

const ctx = { matchers: { players: () => [], teams: () => [] }, athleteSport: {} };

// [headline, expected sport, { link, source }]
const CASES = [
  // other sports that used to land in football / basketball
  ['Drew Rasmussen no-hits Yankees into 8th inning, Rays win ALDS opener', 'other'],
  ["Alcaraz advances to the Tokyo semifinals after Shapovalov's injury", 'other'],
  ['Alexander Zverev vs. Novak Djokovic now live on TV, stream and ticker', 'other'],
  ['Brad Keselowski addresses RFK Racing departure after Las Vegas Cup qualifying', 'other'],
  ['Demi Vollering wins European Championships road race to complete near-perfect 2026 season', 'other'],
  ['Mondo Duplantis, pole vault world-record holder, to skip entire 2027 indoor season', 'other'],
  ["אחרי האכזבה של השנה שעברה, נבחרת הג'ודו מוכנה לאליפות העולם", 'other'],
  ['Kim leads Asian Games swimmers seeking military exemption', 'other'],
  ['In addition to the return of Patrick Mahomes from injury, the Chiefs have found a new weapon', 'other', { link: 'https://www.lequipe.fr/football-americain/article/x' }],
  ['(rUgBy!)~ Newcastle Knights v Sydney Roosters LIVE Free Streams', 'other', { source: { sport: 'football' } }],
  ['השיגה ניצחון 27:32 על הפועל ראשל"צ בנחלת יהודה', 'other', { link: 'https://www.sport5.co.il/articles.aspx?FolderID=616&docID=1' }],
  ['העיר נצבעה צהוב: מכבי ראשון לציון ניצחה בדרבי הכדוריד', 'other'],
  // and football / basketball must stay where they are
  ['צפו: 20 נק` ו-8 ריב` לאקס ליגת העל', 'basketball'],
  ['Hapoel Tel Aviv defeated Real Madrid in Sofia with 102:98', 'basketball'],
  ['LeBron James returns as Lakers beat Celtics in overtime', 'basketball'],
  ['Arsenal beat Chelsea 2-1 to go top of the Premier League', 'football'],
  ['מכבי חיפה החתימה חלוץ חדש לקראת המשחק בליגת העל', 'football'],
  ['Mbappé scores twice as Real Madrid win in La Liga', 'football'],
  ['West Ham striker ruled out for six weeks', 'football', { source: { sport: 'football' } }],
];

for (const [title, want, opt = {}] of CASES) {
  test(`${want}: ${title.slice(0, 70)}`, () => {
    const item = { title, summary: '', link: opt.link || 'https://example.com/news/1' };
    const tags = classify(item, opt.source || {}, ctx);
    const d = decideSport(tags.ev, null, null, features(item));
    assert.equal(d.sport, want, `decided by "${d.why}"`);
  });
}
