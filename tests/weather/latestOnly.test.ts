// Run: node --experimental-strip-types --test tests/weather/latestOnly.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { STALE, latestOnly } from '../../src/lib/latestOnly.ts';

const later = <T,>(v: T, ms: number) => new Promise<T>((r) => setTimeout(() => r(v), ms));

test('only the newest request wins, even when an older one answers last', async () => {
  const guard = latestOnly<string>();
  const first = guard(later('A', 30));
  const second = guard(later('B', 5));
  assert.equal(await second, 'B');
  assert.equal(await first, STALE);
});

test('a single request resolves to its value', async () => {
  const guard = latestOnly<number>();
  assert.equal(await guard(later(7, 1)), 7);
});

test('a failure of the newest request still rejects', async () => {
  const guard = latestOnly<number>();
  await assert.rejects(guard(Promise.reject(new Error('boom'))), /boom/);
});
