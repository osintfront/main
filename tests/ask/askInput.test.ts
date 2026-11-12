// Run: node --experimental-strip-types --test tests/ask/askInput.test.ts
//
// What the server accepts as conversation context for "ask the map". The fields come from the
// browser, so anything may arrive: the cleaners keep only what is safe and never throw.
import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanHistory, cleanIds, cacheKey, historyMessages } from '../../supabase/functions/_shared/askInput.ts';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const uuid = (i: number) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`;

test('history: anything that is not a list is no history', () => {
  for (const v of [null, undefined, 'x', 7, {}, true]) assert.deepEqual(cleanHistory(v), []);
});

test('history: only the last 5 turns are kept', () => {
  const h = cleanHistory(Array.from({ length: 8 }, (_, i) => ({ q: `q${i}`, a: `a${i}` })));
  assert.equal(h.length, 5);
  assert.deepEqual(h[0], { q: 'q3', a: 'a3' });
  assert.deepEqual(h[4], { q: 'q7', a: 'a7' });
});

test('history: broken items are dropped', () => {
  assert.deepEqual(cleanHistory([{ q: 5, a: null }, null, 'x', { q: 'ok', a: '' }, { q: '  ', a: 'a' }, { q: 'q', a: 'a' }]), [{ q: 'q', a: 'a' }]);
});

test('history: text is trimmed and cut to 500 / 1500', () => {
  const [t] = cleanHistory([{ q: ` ${'x'.repeat(900)} `, a: ` ${'y'.repeat(10_000)} ` }]);
  assert.equal(t.q.length, 500);
  assert.equal(t.a.length, 1500);
  assert.deepEqual(cleanHistory([{ q: ' hi ', a: ' yo ' }]), [{ q: 'hi', a: 'yo' }]);
});

test('history: extra fields on an item are not kept', () => {
  assert.deepEqual(cleanHistory([{ q: 'q', a: 'a', role: 'system', x: 1 }]), [{ q: 'q', a: 'a' }]);
});

test('ids: only UUIDs, once each', () => {
  assert.deepEqual(cleanIds(['not-uuid', 7, A, A, B, null, { id: A }]), [A, B]);
});

test('ids: at most 40', () => {
  assert.equal(cleanIds(Array.from({ length: 60 }, (_, i) => uuid(i))).length, 40);
});

test('ids: anything that is not a list is no ids', () => {
  for (const v of [null, undefined, A, {}, 3]) assert.deepEqual(cleanIds(v), []);
});

test('cache key: a first question is its normalised text', () => {
  assert.equal(cacheKey('  What  Happened ', []), 'what happened');
});

test('cache key: the same words inside a conversation get their own key', () => {
  const h1 = [{ q: 'lebanon today', a: 'x' }];
  const h2 = [{ q: 'gaza today', a: 'x' }];
  const k1 = cacheKey('who was killed there', h1);
  assert.notEqual(k1, cacheKey('who was killed there', []));
  assert.equal(k1, cacheKey('who was killed there', h1));
  assert.notEqual(k1, cacheKey('who was killed there', h2));
  assert.match(k1, /^who was killed there\|[0-9a-f]{8}$/);
});

test('history messages alternate user question / assistant answer', () => {
  assert.deepEqual(historyMessages([{ q: 'a', a: 'b' }, { q: 'c', a: 'd' }]), [
    { role: 'user', content: 'a' },
    { role: 'assistant', content: 'b' },
    { role: 'user', content: 'c' },
    { role: 'assistant', content: 'd' },
  ]);
});
