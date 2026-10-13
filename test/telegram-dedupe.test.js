import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fingerprint, sameEvent } from '../src/telegram.js';

const st = (he, extra = {}) => ({ title: extra.title || he, lang: 'en', ai: { he: { title: he } }, tags: [], athletes: [], ...extra });

test('Telegram: the same event from another outlet / language is one post', () => {
  const cov = (he) => st(he, { tags: [{ k: 'team', id: 't24' }, { k: 'team', id: 't116' }] });
  // two clubs in common: the same match
  assert.ok(sameEvent(fingerprint(cov('קובנטרי הביסה 1-4 את ניוקאסל יונייטד')), fingerprint(cov('ניצחון ביתי ראשון: קובנטרי ברחה מהקו האדום עם 1:4 על ניוקאסל'))));
  // no tagged player, but the model's subject and the number match: the 981st goal
  const ron = (he) => st(he, { aiDesk: { desk: true, about: 'Cristiano Ronaldo Al Nassr' } });
  assert.ok(sameEvent(fingerprint(ron('רונאלדו כבש את שערו ה-981 בקריירה')), fingerprint(ron('השער ה-981 של כריסטיאנו רונאלדו: פעולה מושלמת'))));
  // a different Ronaldo story the same day is still a post
  assert.ok(!sameEvent(fingerprint(ron('רונאלדו כבש את שערו ה-981 בקריירה')), fingerprint(ron('כריסטיאנו רונאלדו חגג עם דגל ערב הסעודית'))));
  // different clubs, different story
  assert.ok(!sameEvent(fingerprint(st('ארסנל ניצחה את ליל', { tags: [{ k: 'team', id: 't1' }] })), fingerprint(st('ברצלונה הפסידה', { tags: [{ k: 'team', id: 't2' }] }))));
});
