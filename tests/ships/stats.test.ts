// Run: node --experimental-strip-types --test tests/ships/stats.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchChokepoints, imoValid, loadSanctions, sanctionOf, statusOf } from '../../src/lib/ships.ts';

test('status chips', () => {
  assert.equal(statusOf(70), 'normal');
  assert.equal(statusOf(69.9), 'below');
  assert.equal(statusOf(30), 'below');
  assert.equal(statusOf(29), 'low');
  assert.equal(statusOf(null), 'collecting');
});

test('a strait no receiver hears is "no reception", not "collecting" forever', () => {
  assert.equal(statusOf(null, 0), 'nocoverage');
  assert.equal(statusOf(90, 0), 'nocoverage');
  assert.equal(statusOf(null, 5), 'collecting');
  assert.equal(statusOf(90, 5), 'normal');
  assert.equal(statusOf(90, undefined), 'normal'); // older RPC without seen_24h
});

test('IMO check digit', () => {
  assert.equal(imoValid(9074729), true);
  assert.equal(imoValid('9074729'), true);
  assert.equal(imoValid(9074728), false);
  assert.equal(imoValid(null), false);
  assert.equal(imoValid(0), false);
});

test('only valid IMO numbers match the sanctions list', () => {
  const list = new Map([['9074728', { n: 'BAD CHECK', l: ['OFAC'] }], ['9074729', { n: 'ANYSHIP', l: ['OFAC', 'UK'] }]]);
  assert.equal(sanctionOf({ imo: 9074728 }, list), null);
  assert.equal(sanctionOf({ imo: null }, list), null);
  assert.deepEqual(sanctionOf({ imo: 9074729 }, list), { n: 'ANYSHIP', l: ['OFAC', 'UK'] });
  assert.equal(sanctionOf({ imo: 9074729 }, null), null);
});

test('sanctions file missing → null; present → a map', async () => {
  const missing = (async () => new Response('nope', { status: 404 })) as typeof fetch;
  assert.equal(await loadSanctions(missing), null);
  const ok = (async () => new Response(JSON.stringify({ updated: '2026-11-09', vessels: { '9074729': { n: 'ANYSHIP', l: ['OFAC'] } } }), { status: 200 })) as typeof fetch;
  const m = await loadSanctions(ok);
  assert.equal(m?.size, 1);
});

test('chokepoints come from the RPC, errors are thrown', async () => {
  const six = ['hormuz', 'bab_el_mandeb', 'suez', 'tiran', 'bosphorus', 'dardanelles'].map((id) => ({
    id, crossings_24h: 0, tankers_24h: 0, avg_7d: 0, days: 0, pct_normal: null, waiting: [], last: null,
  }));
  const list = await fetchChokepoints(async () => ({ data: six, error: null }));
  assert.equal(list.length, 6);
  assert.equal(list[0].id, 'hormuz');
  await assert.rejects(fetchChokepoints(async () => ({ data: null, error: { message: 'boom' } })));
});

test('the placeholder sanctions file (never built) counts as unknown, not as zero', async () => {
  const { loadSanctions: fresh } = await import('../../src/lib/ships.ts?placeholder');
  const placeholder = (async () => new Response('{"updated":null,"vessels":{}}', { status: 200 })) as typeof fetch;
  assert.equal(await fresh(placeholder), null);
});
