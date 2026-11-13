import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeSameEvent, eventPrint, sameEventStrict } from '../src/merge.js';

const T = Date.parse('2026-10-12T20:00:00Z');
let n = 0;
const art = (title, extra = {}) => ({ id: `m${++n}`, title, published: T + n * 60000, sport: 'football', ents: [], ...extra });
const cl = (title, card, extra) => { const m = art(title, extra); return { members: [m], card: card && [m.id, card] }; };

test('the same event from different languages becomes one story; different events stay apart', () => {
  const list = [
    cl('Coventry thump Newcastle', { title_he: 'קובנטרי הביסה 1:4 את ניוקאסל יונייטד', about: 'Coventry Newcastle' }, { ents: ['t24', 't116'] }),
    cl('Κόβεντρι – Νιούκαστλ 4-1', { title_he: 'קובנטרי פירקה את ניוקאסל 1-4', about: 'Coventry Newcastle United' }, { ents: ['t24', 't116'] }),
    cl('Ronaldo 981', { title_he: 'השער ה-981 של כריסטיאנו רונאלדו', about: 'Cristiano Ronaldo goal' }),
    cl('Ronaldo rekao 981. gol', { title_he: 'רונאלדו כבש את שערו ה-981 בקריירה', about: 'Cristiano Ronaldo Al Nassr' }),
    cl('Ronaldo flag', { title_he: 'כריסטיאנו רונאלדו חגג עם דגל ערב הסעודית', about: 'Cristiano Ronaldo celebration' }),
    cl('Courtois contract', { title_he: 'קורטואה הגיע להסכם על הארכת חוזה בריאל', about: 'Thibaut Courtois contract' }, { ents: ['t131', 'p1'] }),
    cl('Courtois injury', { title_he: 'קורטואה נפצע באימון של ריאל', about: 'Thibaut Courtois injury' }, { ents: ['t131', 'p1'] }),
    cl('Scotland beer', { title_he: 'לראשונה מאז 1981: בירה באצטדיונים בסקוטלנד', about: 'Scotland beer' }),
    cl('no card yet'),
  ];
  const cards = Object.fromEntries(list.filter((x) => x.card).map((x) => x.card));
  const out = mergeSameEvent(list.map((x) => x.members), cards);
  const together = (a, b) => out.some((g) => g.some((m) => m.title === a) && g.some((m) => m.title === b));
  assert.ok(together('Coventry thump Newcastle', 'Κόβεντρι – Νιούκαστλ 4-1'));
  assert.ok(together('Ronaldo 981', 'Ronaldo rekao 981. gol'));
  assert.ok(!together('Ronaldo 981', 'Ronaldo flag'));
  assert.ok(!together('Courtois contract', 'Courtois injury'));
  assert.ok(!together('Ronaldo 981', 'Scotland beer'));
  assert.equal(out.length, 7); // 9 stories → 7 (two pairs merged)
});

// The editors' rule (2026-11-13): a goal / video clip and a later independent quote are separate events, even about
// the same player and match. They may be linked; they must not merge on their own. (r289 of the evaluation set.)
test('a goal clip and a later quote with a named speaker do not merge, though they share the player and the subject', () => {
  const clip = cl("Goal: A. Griezmann vs. D.C. United, 15'", { title_he: 'אנטואן גריזמן כבש מול יונייטד', about: 'Antoine Griezmann' }, { ents: ['p540', 't1339'] });
  const quote = cl('Ojeda: “Griezmann makes football easier”', { title_he: 'אוחדה: אנטואן גריזמן הופך את הכדורגל לקל יותר', about: 'Antoine Griezmann' }, { ents: ['p540'] });
  const report = cl('Griezmann scores a stunning goal for Orlando against D.C. United', { title_he: 'אנטואן גריזמן כבש שער מרהיב מול יונייטד', about: 'Antoine Griezmann' }, { ents: ['p540', 't1339'] });
  const [pc, pq, pr] = [clip, quote, report].map((x) => eventPrint(x.members, x.card[1]));
  // as in the saved data, where the other words of these cards are common and only the player's name is "rare"
  const rare = new Set(['אנטואן', 'גריזמן', 'כבש', 'מול', 'יונייטד', 'שער', 'מרהיב']);
  assert.equal(sameEventStrict(pc, pq, new Set(['אנטואן', 'גריזמן'])), false); // the clip and the quote: separate
  assert.equal(sameEventStrict(pq, pc, new Set(['אנטואן', 'גריזמן'])), false); // in either order
  // the rule is narrow: the clip and a plain report of the same goal are still one story
  assert.equal(sameEventStrict(pc, pr, rare), true);
  // and through the whole merge step
  const cards = Object.fromEntries([clip, quote, report].map((x) => x.card));
  const out = mergeSameEvent([clip.members, quote.members, report.members], cards);
  const together = (a, b) => out.some((g) => g.some((m) => m.title === a) && g.some((m) => m.title === b));
  assert.ok(!together(clip.members[0].title, quote.members[0].title));
  assert.ok(!together(report.members[0].title, quote.members[0].title));
});
