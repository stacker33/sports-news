import { test } from 'node:test';
import assert from 'node:assert/strict';
import { goodHe } from '../src/ai.js';

test('Hebrew from the model: glitches are rejected, normal text passes', () => {
  // real glitches seen on the live site
  assert.equal(goodHe('המffמן צפוי לבצע שינויים ורוטציה רחבה בהרכב'), false);
  assert.equal(goodHe('התגובה פורסמה ברשתות החברתיות ולוותה בנימה סרcסטית'), false);
  assert.equal(goodHe('סולבאקken מרגיע: ארלינג האלנד כשיר'), false);
  assert.equal(goodHe('אולימפיאקוס נגד פנאתינייקוס, פאוק נגד קלמאτα'), false);
  assert.equal(goodHe('نادي الأسير'), false);
  // fine: Latin words / abbreviations separated by a space or hyphen
  assert.equal(goodHe('דני אבדיה קלע 30 נקודות בניצחון של פורטלנד ב-NBA'), true);
  assert.equal(goodHe('מכבי Rapyd ת״א ניצחה ביורוליג'), true);
  assert.equal(goodHe('אלקראס בגמר ה-ATP 500 בטוקיו'), true);
});
