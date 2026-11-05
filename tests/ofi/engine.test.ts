// Run: node --experimental-strip-types --test tests/ofi/engine.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { computeForecast, freshness, summaries, DEFAULT_PARAMS, type EngineSignal } from '../../supabase/functions/_shared/ofi/engine.ts';

const sig = (key: string, score: number | null, extra: Partial<EngineSignal> = {}): EngineSignal => ({
  key, name_he: key, name_en: key, source_type: 'internal_events', weight: 1, direction: 1,
  is_circuit_breaker: false, score, age_hours: 1, stale_after_hours: 3, ...extra,
});
const near = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`);
const sumPp = (r: ReturnType<typeof computeForecast>) => r.contributions.reduce((a, c) => a + c.pp, 0);

test('all-neutral signals return the base rate', () => {
  const r = computeForecast(0.02, [sig('a', 0.5), sig('b', 0.5)], null);
  near(r.probability, 0.02);
  near(sumPp(r), 0, 1e-3);
});

test('deterministic: same inputs → identical output (order of signals irrelevant)', () => {
  const xs = [sig('a', 0.8), sig('b', 0.3, { weight: 2 }), sig('m', 0.04, { source_type: 'polymarket', stale_after_hours: 48 })];
  const r1 = computeForecast(0.02, xs, 0.03);
  const r2 = computeForecast(0.02, [...xs].reverse(), 0.03);
  assert.deepEqual(r1, r2);
});

test('contributions + base sum exactly to the final probability', () => {
  const r = computeForecast(0.02, [sig('a', 0.9, { weight: 2 }), sig('b', 0.2), sig('m', 0.05, { source_type: 'polymarket', stale_after_hours: 48 })], 0.03);
  near(0.02 * 100 + sumPp(r), r.probability * 100, 1e-3);
});

test('direction −1 lowers the estimate', () => {
  const up = computeForecast(0.02, [sig('a', 0.9)], null);
  const down = computeForecast(0.02, [sig('a', 0.9, { direction: -1 })], null);
  assert.ok(up.probability > 0.02 && down.probability < 0.02);
});

test('stale signals fade out', () => {
  near(freshness(2, 3), 1);
  near(freshness(4.5, 3), 0.5);
  near(freshness(6, 3), 0);
  near(freshness(null, 3), 0);
  const r = computeForecast(0.02, [sig('a', 0.95, { age_hours: 10 })], null);
  near(r.probability, 0.02);
});

test('market anchor pulls toward the market', () => {
  const r = computeForecast(0.02, [sig('m', 0.2, { source_type: 'polymarket', stale_after_hours: 48 })], null);
  assert.ok(r.probability > 0.05 && r.probability < 0.2, String(r.probability));
});

test('clamped to 1%–95% and the clamp is an explicit item', () => {
  const hi = computeForecast(0.5, [sig('a', 1, { weight: 10 })], null);
  near(hi.probability, 0.95);
  assert.ok(hi.contributions.some((c) => c.key === 'clamp'));
  near(50 + sumPp(hi), 95, 1e-3);
  const lo = computeForecast(0.02, [sig('a', 0, { weight: 10 })], null);
  near(lo.probability, 0.01);
});

test('smoothing vs. previous, skipped when the circuit breaker fires', () => {
  const calm = computeForecast(0.02, [sig('a', 0.5)], 0.2);
  assert.ok(calm.probability > 0.05, 'previous estimate pulls');
  const breakers = [sig('air', 0.8, { is_circuit_breaker: true }), sig('hfc', 0.8, { is_circuit_breaker: true })];
  const fired = computeForecast(0.02, breakers, 0.02);
  assert.equal(fired.breaker, true);
  assert.equal(fired.detail.smoothed, false);
  const one = computeForecast(0.02, [sig('air', 0.8, { is_circuit_breaker: true })], 0.02);
  assert.equal(one.breaker, false);
});

test('confidence band contains the estimate and widens with stale data', () => {
  const fresh = computeForecast(0.02, [sig('a', 0.7), sig('b', 0.7)], null);
  const stale = computeForecast(0.02, [sig('a', 0.7), sig('b', 0.7, { age_hours: 5 })], null);
  assert.ok(fresh.confidence_low < fresh.probability && fresh.probability < fresh.confidence_high);
  assert.ok(stale.confidence_high - stale.confidence_low > fresh.confidence_high - fresh.confidence_low);
});

test('summaries name the factor pushing the same way', () => {
  const r = computeForecast(0.02, [sig('up', 0.95, { weight: 3, name_en: 'Airspace' }), sig('down', 0.3, { name_en: 'Calm' })], 0.02);
  const s = summaries(r, 0.02);
  assert.match(s.en, /rose .* mainly due to Airspace/);
  assert.match(summaries(r, null).he, /^הערכה ראשונה/);
  assert.equal(DEFAULT_PARAMS.max, 0.95);
});
