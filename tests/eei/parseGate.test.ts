// Run: node --experimental-strip-types --test tests/eei/parseGate.test.ts
// Splitting a pasted EEI list: who is counted toward the 5 a day, and a failed split is given back.
import test from 'node:test';
import assert from 'node:assert/strict';
import { runParse, type ParseDeps } from '../../supabase/functions/_shared/eeiInput.ts';

const deps = (o: Partial<ParseDeps> = {}) => {
  const log: string[] = [];
  const d: ParseDeps = {
    cached: async () => false,
    overBudget: async () => false,
    count: async () => { log.push('count'); return true; },
    uncount: async () => { log.push('uncount'); },
    parse: async () => { log.push('parse'); return { theatres: [1], cached: false }; },
    ...o,
  };
  return { d, log };
};

test('a subscriber is counted once', async () => {
  const { d, log } = deps();
  const r = await runParse(d, { uid: 'u', limitless: false });
  assert.deepEqual(r, { theatres: [1], cached: false });
  assert.deepEqual(log, ['count', 'parse']);
});

test('staff (no limit) are not counted', async () => {
  const { d, log } = deps();
  await runParse(d, { uid: 'u', limitless: true });
  assert.deepEqual(log, ['parse']);
});

test('a cached split is not counted', async () => {
  const { d, log } = deps({ cached: async () => true });
  await runParse(d, { uid: 'u', limitless: false });
  assert.deepEqual(log, ['parse']);
});

test('quota and budget', async () => {
  assert.equal(await runParse(deps({ count: async () => false }).d, { uid: 'u', limitless: false }), 'quota');
  assert.equal(await runParse(deps({ overBudget: async () => true }).d, { uid: 'u', limitless: false }), 'budget');
});

test('a failed split is given back and the error goes on', async () => {
  const { d, log } = deps({ parse: async () => { throw new Error('boom'); } });
  await assert.rejects(runParse(d, { uid: 'u', limitless: false }), /boom/);
  assert.deepEqual(log, ['count', 'uncount']);
});

test('an empty split is given back', async () => {
  const { d, log } = deps({ parse: async () => { log.push('parse'); return { theatres: [], cached: false }; } });
  await runParse(d, { uid: 'u', limitless: false });
  assert.deepEqual(log, ['count', 'parse', 'uncount']);
});

test('internal calls (no user) are never counted', async () => {
  const { d, log } = deps();
  await runParse(d, { uid: null, limitless: false });
  assert.deepEqual(log, ['parse']);
});

test('the tagger skips theatres no current list holds', async () => {
  const { inCurrentLists } = await import('../../supabase/functions/_shared/eeiInput.ts');
  const rows = [{ hash: 'a' }, { hash: 'b' }, { hash: 'c' }];
  const lists = [
    { list: { theatres: [{ hash: 'a' }, { hash: 'x' }] } },
    { list: null },
    { list: { theatres: [{ hash: 'c' }, {}] } },
  ];
  assert.deepEqual(inCurrentLists(rows, lists).map((r) => r.hash), ['a', 'c']);
  assert.deepEqual(inCurrentLists(rows, []), []);
});
