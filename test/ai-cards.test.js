import { test } from 'node:test';
import assert from 'node:assert/strict';

// The card step (src/ai.js): one light-model call gives each new foreign story a Hebrew headline, a short Hebrew
// summary and the subject verdict. The network is mocked; nothing leaves the machine.
test('story cards: Hebrew headline + one-or-two-sentence summary + subject, attached in the same run', async () => {
  process.env.AI_API_KEY = 'test';
  const sent = [];
  globalThis.fetch = async (url, opts) => {
    const body = JSON.parse(opts.body);
    sent.push(body.messages[0].content);
    const cards = body.messages[0].content.includes('You prepare story cards');
    const content = cards
      ? JSON.stringify({ items: [
          { id: '0', title_he: 'ריאל מדריד הגיעה להסכם עם קורטואה על הארכת חוזה', summary_he: 'השוער הבלגי יחתום עד 2028.', about: 'Thibaut Courtois contract', about_he: 'החוזה של טיבו קורטואה', desk: true },
          { id: '1', title_he: 'עוזר מאמן בןן מותח ביקורת', summary_he: '', about: 'x', desk: false }, // broken Hebrew: rejected
          { id: '2', title_he: 'אימון פתוח באייאקס', summary_he: 'אימון פתוח באייאקס', about: 'Ajax training', desk: false }, // summary = headline: dropped
        ] })
      : JSON.stringify({ stories: [], titles: [] });
    return { ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content } }], usage: { total_tokens: 1 } }) };
  };
  const { aiSummaries, attachDesk } = await import('../src/ai.js');
  const now = Date.parse('2026-10-12T12:00:00Z');
  const mk = (i, title) => ({ id: `s${i}`, title, lang: 'nl', langs: ['nl'], sport: 'football', first: now - 60000, score: 1, sourceCount: 1, _members: [{ id: `m${i}`, title, published: now - 60000, summary: '' }] });
  const stories = [mk(0, 'Real Madrid bereikt akkoord met Courtois'), mk(1, 'Assistent-coach kritisch'), mk(2, 'Open training bij Ajax')];
  const { ai } = await aiSummaries(stories, {}, {}, now);
  assert.ok(sent.some((x) => x.includes('You prepare story cards')));
  assert.deepEqual(stories[0].ai.he, { title: 'ריאל מדריד הגיעה להסכם עם קורטואה על הארכת חוזה', sum: 'השוער הבלגי יחתום עד 2028.' });
  assert.equal(stories[1].ai, undefined); // "בןן" never reaches the site
  assert.deepEqual(stories[2].ai.he, { title: 'אימון פתוח באייאקס' });
  // the subject verdict is applied on the next run
  const next = [mk(0, 'Real Madrid bereikt akkoord met Courtois'), mk(2, 'Open training bij Ajax')];
  attachDesk(next, ai);
  assert.equal(next[0].aiDesk.desk, true);
  assert.equal(next[1].aiDesk.desk, false);
  delete process.env.AI_API_KEY;
});
