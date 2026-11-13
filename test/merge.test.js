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

// ---------- Step 2: a Hebrew-led group (no AI card) takes part in the merge with its own headline ----------
// The foreign groups are matched with real AI cards; the Hebrew-led one stands in with its Hebrew headline. Pairs that
// involve a stand-in get stricter checks, and the Step 1 decisions between real cards are never touched.
const heLed = (title, ents = [], extra = {}) => ({ members: [art(title, { lang: 'he', weight: 3, ents, ...extra })], card: null });
const merged = (out, a, b) => out.some((g) => g.some((m) => m.title === a) && g.some((m) => m.title === b));
const LAZ = ['t100', 't200'];

test('a Hebrew-led report of a result joins the foreign report of the same result', () => {
  const foreign = cl('Lazio beat Juventus 3-0', { title_he: 'לאציו ניצחה 0:3 את יובנטוס', about: 'Lazio Juventus' }, { lang: 'it', weight: 2, ents: LAZ });
  const hebrew = heLed('נצמדה לפסגה: לאציו שנייה אחרי 0:3 על יובנטוס', LAZ);
  const out = mergeSameEvent([foreign.members, hebrew.members], Object.fromEntries([foreign.card]));
  assert.equal(out.length, 1);
  // without the stand-in the Hebrew-led group never took part (the Step 1 behaviour)
  assert.equal(mergeSameEvent([foreign.members, hebrew.members], {}).length, 2);
});

test('Hebrew-led: the coverage before a match and its result stay two stories, however alike the words', () => {
  const result = cl('Lazio beat Juventus', { title_he: 'לאציו ניצחה את יובנטוס', about: 'Lazio Juventus' }, { lang: 'it', weight: 2, ents: LAZ });
  const pre = heLed('לקראת המשחק: לאציו יובנטוס', LAZ);
  const neutral = heLed('חדשות: לאציו יובנטוס', LAZ);
  const cards = Object.fromEntries([result.card]);
  assert.equal(mergeSameEvent([result.members, neutral.members], cards).length, 1); // the same words, no phase: they join
  assert.equal(mergeSameEvent([result.members, pre.members], cards).length, 2); // a Hebrew headline that says "ahead of the match": they do not
});

test('Hebrew-led: a round-up of several results is not one event and takes in nothing', () => {
  const foreign = cl('Arsenal beat Forest 1-0', { title_he: 'ארסנל ניצחה 0:1 את נוטינגהאם', about: 'Arsenal Forest' }, { lang: 'en', weight: 2, ents: ['t300', 't400'] });
  const digest = heLed('0:1 קטן לארסנל על נוטינגהאם, אייאקס חגגה עם 2:5', ['t300', 't400']);
  assert.equal(mergeSameEvent([foreign.members, digest.members], Object.fromEntries([foreign.card])).length, 2);
});

test('Hebrew-led: two different stories of one Israeli club on one day do not merge on the club name', () => {
  const ents = ['t500'];
  const a = heLed('הרכב הפועל באר שבע מול ירושלים', ents);
  const b = heLed('שחקן הפועל באר שבע קרע רצועה', ents);
  // other Hebrew headlines make "Hapoel Beer Sheva" a common word, as in the live data
  const fillers = Array.from({ length: 6 }, (_, i) => heLed(`הפועל באר שבע חדשות ${i} מהמועדון`, [`t90${i}`], { sport: 'basketball' }));
  const out = mergeSameEvent([a.members, b.members, ...fillers.map((f) => f.members)], {});
  assert.ok(!merged(out, a.members[0].title, b.members[0].title));
});

test('Hebrew stand-ins never change which words are common, so no Step 1 decision between real cards changes', () => {
  // no score in either card: only shared words can join them, so which words count as common matters
  const a = cl('Coventry thump Newcastle', { title_he: 'קובנטרי הביסה את ניוקאסל יונייטד', about: 'Coventry Newcastle' }, { lang: 'en', weight: 2, ents: ['t24', 't116'] });
  const b = cl('Κόβεντρι – Νιούκαστλ', { title_he: 'קובנטרי פירקה את ניוקאסל יונייטד', about: 'Coventry Newcastle United' }, { lang: 'el', weight: 2, ents: ['t24', 't116'] });
  const cards = Object.fromEntries([a.card, b.card]);
  const crowd = Array.from({ length: 10 }, (_, i) => heLed(`קובנטרי ניוקאסל יונייטד הביסה פירקה ידיעה ${i}`, [`t70${i}`], { sport: 'basketball' }));
  const before = mergeSameEvent([a.members, b.members], cards);
  const withCrowd = mergeSameEvent([a.members, b.members, ...crowd.map((c) => c.members)], cards);
  assert.equal(before.length, 1);
  assert.ok(merged(withCrowd, 'Coventry thump Newcastle', 'Κόβεντρι – Νιούκαστλ'));
});

test('Hebrew-led: the subject\'s own name is not evidence of the same event', () => {
  const ents = ['t600'];
  const a = heLed('אלמוג כהן בראיון', ents);
  const b = heLed('אלמוג כהן מדבר', ents);
  // the name is in most headlines of that player, so it says nothing; the words are still rare in the whole day
  const more = [heLed('אלמוג כהן חזר לאימונים', ents), heLed('אלמוג כהן נפצע בברך', ents)];
  const out = mergeSameEvent([a.members, b.members, ...more.map((m) => m.members)], {});
  assert.ok(!merged(out, a.members[0].title, b.members[0].title));
});

test('Hebrew-led: a headline about three clubs is a round-up and joins nothing', () => {
  const foreign = cl('Torino beat Monza 0-3', { title_he: 'טורינו ניצחה 0:3 את מונזה', about: 'Torino Monza' }, { lang: 'it', weight: 2, ents: ['t10', 't20'] });
  const roundup = heLed('טורינו חגגה עם 0:3, מונזה הפתיעה את קליארי', ['t10', 't20', 't30', 't40']);
  assert.equal(mergeSameEvent([foreign.members, roundup.members], Object.fromEntries([foreign.card])).length, 2);
});

test('Hebrew-led: headlines with two different scores are two different results', () => {
  const ents = ['t800', 't900'];
  const foreign = cl('Osasuna beat Santander', { title_he: 'אוסאסונה יצאה מהמשבר ניצחה את סנטאנדר 0:2', about: 'Osasuna Santander' }, { lang: 'es', weight: 2, ents });
  const other = heLed('אוסאסונה יצאה מהמשבר, 1:2 לסלטה על אלאבס', ents);
  const same = heLed('אוסאסונה יצאה מהמשבר ניצחה את סנטאנדר, 0:2 למארחת', ents);
  const cards = Object.fromEntries([foreign.card]);
  assert.equal(mergeSameEvent([foreign.members, other.members], cards).length, 2); // 0:2 against 1:2
  assert.equal(mergeSameEvent([foreign.members, same.members], cards).length, 1); // the same score and result
});

// ---------- Step 3 ----------
// a foreign article still waiting for its AI card: only the cached machine translation of its headline exists
const mt = (title, he, ents = [], extra = {}) => ({ members: [art(title, { lang: 'de', weight: 1, ents, tr: { en: title, he }, ...extra })], card: null });
const injury = (en, he, ents, extra = {}) => ({ members: [art(en, { lang: 'en', weight: 1, ents, tr: { en, he }, ...extra })], card: null });
const joined = (out) => out.length === 1;

test('Step 3: a card-less foreign story joins the same event only on strong evidence (both teams and two rare words)', () => {
  const real = cl('Barcelona beat Betis in Seville thanks to a Yamal goal', { title_he: 'ברצלונה ניצחה את בטיס בסביליה אחרי שער של ימאל', about: 'Barcelona Betis' }, { lang: 'es', weight: 2, ents: ['t10', 't20'] });
  const same = mt('Spectacle in Seville: Barcelona beat Betis', 'מחזה בסביליה: ברצלונה ניצחה את בטיס אחרי שער של ימאל', ['t10', 't20']);
  assert.ok(joined(mergeSameEvent([real.members, same.members], Object.fromEntries([real.card]))));
  // one shared club is not enough, whatever the words
  const oneClub = mt('Barcelona beat Betis', 'ברצלונה ניצחה את בטיס אחרי שער של ימאל', ['t10']);
  assert.equal(mergeSameEvent([real.members, oneClub.members], Object.fromEntries([real.card])).length, 2);
});

test('Step 3: a score alone does not join two card-less stories ("0-3" is in a hundred matches)', () => {
  const a = mt('Juve Stabia - Sudtirol: 3-0', 'יובה סטביה - סודטירול: 3-0 סדרה ב', ['t50']);
  const b = mt('Lazio huge 0:3 over Juventus', 'בלתי מנוצחת: 0:3 ענק ללאציו על יובנטוס', ['t50', 't100']);
  assert.equal(mergeSameEvent([a.members, b.members], {}).length, 2);
});

test('Step 3: the same player\'s injury, reported twice in different words, is one story', () => {
  const a = injury('Nuno Mendes suffers muscle injury as tests confirmed', 'נונו מנדס סובל מפציעה בשריר', ['p77', 't1']);
  const b = injury('Alarm in Paris: Mendes out for weeks', 'אזעקה בפריז: מנדס בחוץ לכמה שבועות עם פציעה', ['p77', 't1'], { published: T + 5 * 3600e3 });
  assert.ok(joined(mergeSameEvent([a.members, b.members], {})));
  const other = injury('Marquinhos injury scare for PSG', 'חשש לפציעה של מרקיניוס', ['p88', 't1'], { published: T + 6 * 3600e3 });
  assert.equal(mergeSameEvent([a.members, other.members], {}).length, 2); // another player: another event
});

test('Step 3: an injury needs the same player AND the same kind of news: a name or a return from injury is not enough', () => {
  const inj = injury('Alisson Santos suffers hamstring injury', 'אליסון סנטוס סובל מקרע בשריר הירך האחורי', ['p5', 't2']);
  const back = injury('Alisson Santos returns to training after recovering', 'אליסון סנטוס חזר לאימונים אחרי הפציעה', ['p5', 't2'], { published: T + 3600e3 });
  assert.equal(mergeSameEvent([inj.members, back.members], {}).length, 2);
  const contract = injury('Alisson Santos signs a new contract at Napoli', 'אליסון סנטוס חתם על חוזה חדש בנאפולי', ['p5', 't2'], { published: T + 3600e3 });
  assert.equal(mergeSameEvent([inj.members, contract.members], {}).length, 2);
});

test('Step 3: injury stories: a quote, a hypothetical, a match report, a coach\'s sacking and 40 hours later stay separate', () => {
  const inj = injury('Haaland suffers knee injury in training', 'האלנד נפצע בברך באימון', ['p9', 't3']);
  const quote = injury('Nikolic on Haaland: "I would never be happy if an opponent is injured"', 'ניקוליץ על האלנד: לעולם לא אשמח אם יריב נפצע', ['p9', 't3'], { published: T + 3600e3 });
  const hypo = injury('Who could replace Haaland if he is injured?', 'מי יכול להחליף את האלנד אם הוא ייפצע', ['p9', 't3'], { published: T + 3600e3 });
  const report = injury('City beat Arsenal 2-1 but Haaland injury worry', 'סיטי ניצחה 2:1 את ארסנל אבל דאגה בגלל הפציעה של האלנד', ['p9', 't3', 't4'], { published: T + 3600e3 });
  const late = injury('Haaland injury: new scan result', 'פציעת האלנד: תוצאות סריקה חדשות', ['p9', 't3'], { published: T + 40 * 3600e3 });
  for (const x of [quote, hypo, report, late]) assert.equal(mergeSameEvent([inj.members, x.members], {}).length, 2, x.members[0].title);
  const sackA = injury('Allegri risks the sack after the loss', 'אלגרי בסיכון לפיטורים אחרי ההפסד', ['p6', 't2']);
  const sackB = injury('How much would it cost Napoli to sack Allegri?', 'כמה יעלה לנאפולי לפטר את אלגרי', ['p6', 't2'], { published: T + 3600e3 });
  assert.equal(mergeSameEvent([sackA.members, sackB.members], {}).length, 2); // the editors: separate but related (r026)
});
