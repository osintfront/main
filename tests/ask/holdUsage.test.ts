// Run: node --experimental-strip-types --test tests/ask/holdUsage.test.ts
//
// holdUsage(): the usage rows of a call whose payer is known only afterwards (the plan step: a
// clarify turn is free) are kept and written once, for the user decided after the call.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { holdUsage, logUsage, runAsReader, setUsageSink } from '../../supabase/functions/_shared/usage.ts';

const rows: any[] = [];
setUsageSink({ from: () => ({ insert: (row: any) => { rows.push(row); return Promise.resolve({ error: null }); } }) } as never, 'test');
const tick = () => new Promise((r) => setTimeout(r, 0));
const log = () => logUsage('ask_plan', 'claude-haiku-5-5', { input_tokens: 1000 });

test('held rows are written once, with the flushed user and purpose', async () => {
  rows.length = 0;
  const h = await holdUsage(async () => { log(); return 42; });
  await tick();
  assert.equal(rows.length, 0);
  assert.equal(h.value, 42);
  h.flush('U', 'ask_dashboard_plan');
  await tick();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].user_id, 'U');
  assert.equal(rows[0].purpose, 'ask_dashboard_plan');
  h.flush('U');
  await tick();
  assert.equal(rows.length, 1);
});

test('flush(null) writes without a user and keeps the purpose', async () => {
  rows.length = 0;
  const h = await holdUsage(async () => { log(); });
  h.flush(null);
  await tick();
  assert.equal(rows[0].user_id, null);
  assert.equal(rows[0].purpose, 'ask_plan');
});

test('a hold wins over runAsReader', async () => {
  rows.length = 0;
  const h = await runAsReader('R', () => holdUsage(async () => { log(); }));
  await tick();
  assert.equal(rows.length, 0);
  h.flush('U');
  await tick();
  assert.equal(rows[0].user_id, 'U');
});

test('a failing call writes its rows with no user and rethrows', async () => {
  rows.length = 0;
  const boom = new Error('boom');
  await assert.rejects(holdUsage(async () => { log(); throw boom; }), (e) => e === boom);
  await tick();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].user_id, null);
});

test('outside a hold rows are written at once, with the reader', async () => {
  rows.length = 0;
  log();
  await runAsReader('R', async () => log());
  await tick();
  assert.deepEqual(rows.map((r) => r.user_id), [null, 'R']);
});
