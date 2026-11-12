// Run: node --experimental-strip-types --test tests/ask/askChat.test.ts
//
// "Ask the map" is a short conversation. These are its pure rules: what earlier turns are sent
// to the server with a follow-up, the text that Copy / Share produce, and the question the
// "Summary" button composes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_TURNS, HISTORY_TURNS, buildContext, answerShareText, summaryQuestion, whatsappUrl } from '../../src/lib/askChat.ts';

const turn = (n: number, over: Record<string, unknown> = {}) => ({ question: `q${n}`, answer: `a${n}`, ids: [`id${n}`], events: [{ id: `id${n}`, title: `T${n}` }], ...over });
const LABELS = { sources: 'Sources:', site: 'osintfront.com' };
const SITE = 'https://osintfront.com';

test('limits are the agreed ones', () => {
  assert.equal(MAX_TURNS, 6);
  assert.equal(HISTORY_TURNS, 5);
});

test('context: no turns → empty', () => {
  assert.deepEqual(buildContext([]), { history: [], prev_ids: [] });
});

test('context: only the last 5 turns are sent, newest last', () => {
  const c = buildContext([1, 2, 3, 4, 5, 6, 7].map((n) => turn(n)));
  assert.equal(c.history.length, 5);
  assert.deepEqual(c.history[0], { q: 'q3', a: 'a3' });
  assert.deepEqual(c.history[4], { q: 'q7', a: 'a7' });
});

test('context: long question and answer are cut to 500 / 1500', () => {
  const c = buildContext([turn(1, { question: 'x'.repeat(600), answer: 'y'.repeat(2000) })]);
  assert.equal(c.history[0].q.length, 500);
  assert.equal(c.history[0].a.length, 1500);
});

test('context: previous events come from the newest turn that has any, at most 40', () => {
  const many = Array.from({ length: 50 }, (_, i) => `e${i}`);
  const c = buildContext([turn(1, { ids: many }), turn(2, { ids: [] })]);
  assert.equal(c.prev_ids.length, 40);
  assert.equal(c.prev_ids[0], 'e0');
});

test('share text: question, answer, a source line per cited event, site line', () => {
  const t = { question: 'Q', answer: 'A [1] and [2] and [9]', ids: ['a', 'b'], events: [{ id: 'a', title: 'T1' }, { id: 'b', title: 'T2' }] };
  assert.equal(
    answerShareText(t, SITE, LABELS),
    'Q\n\nA [1] and [2] and [9]\n\nSources:\n[1] T1 — https://osintfront.com/e/a\n[2] T2 — https://osintfront.com/e/b\n\nosintfront.com',
  );
});

test('share text: only cited events are listed', () => {
  const t = { question: 'Q', answer: 'A [2]', ids: ['a', 'b'], events: [{ id: 'a', title: 'T1' }, { id: 'b', title: 'T2' }] };
  assert.equal(answerShareText(t, SITE, LABELS), 'Q\n\nA [2]\n\nSources:\n[2] T2 — https://osintfront.com/e/b\n\nosintfront.com');
});

test('share text: a cited event that was not loaded gets no source line', () => {
  const t = { question: 'Q', answer: 'A [1] [2]', ids: ['a', 'b'], events: [{ id: 'b', title: 'T2' }] };
  assert.equal(answerShareText(t, SITE, LABELS), 'Q\n\nA [1] [2]\n\nSources:\n[2] T2 — https://osintfront.com/e/b\n\nosintfront.com');
});

test('share text: no citations → no sources block', () => {
  assert.equal(answerShareText({ question: 'Q', answer: 'A', ids: [], events: [] }, SITE, LABELS), 'Q\n\nA\n\nosintfront.com');
});

test('share text: each citation is listed once even when repeated', () => {
  const t = { question: 'Q', answer: 'A [1] B [1]', ids: ['a'], events: [{ id: 'a', title: 'T1' }] };
  assert.equal(answerShareText(t, SITE, LABELS).match(/\[1\] T1/g)?.length, 1);
});

test('share text: long text is cut at a line break and ends with an ellipsis before the site line', () => {
  const line = 'w'.repeat(79);
  const answer = Array.from({ length: 63 }, () => line).join('\n'); // ~5,000 chars
  const out = answerShareText({ question: 'Q', answer, ids: [], events: [] }, SITE, LABELS, 3500);
  const tail = '\n\nosintfront.com';
  assert.ok(out.endsWith(tail));
  const body = out.slice(0, -tail.length);
  assert.ok(body.length <= 3500, `body is ${body.length}`);
  assert.ok(body.endsWith('\n…'), 'cut at a line break');
  assert.ok(body.length > 3300, 'keeps as much as fits');
});

test('summary question: Hebrew with area and extra', () => {
  assert.equal(summaryQuestion('לבנון', 'בלי הצהרות', 'he'), 'סכם את האירועים בלבנון ב-24 השעות האחרונות. בלי הצהרות');
});

test('summary question: English with area only', () => {
  assert.equal(summaryQuestion('Lebanon', '', 'en'), 'Summarise the events in Lebanon in the last 24 hours.');
});

test('summary question: no area, extra only', () => {
  assert.equal(summaryQuestion('', 'only strikes', 'en'), 'Summarise the events of the last 24 hours. only strikes');
  assert.equal(summaryQuestion('', 'רק תקיפות', 'he'), 'סכם את האירועים ב-24 השעות האחרונות. רק תקיפות');
});

test('summary question: never longer than a question may be', () => {
  assert.ok(summaryQuestion('Lebanon', 'z'.repeat(600), 'en').length <= 500);
});

test('whatsapp link carries the encoded text', () => {
  assert.equal(whatsappUrl('a b&c'), 'https://wa.me/?text=a%20b%26c');
});
