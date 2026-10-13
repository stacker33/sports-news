import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeSameEvent } from '../src/merge.js';

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
