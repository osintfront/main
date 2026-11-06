// Run: node --experimental-strip-types --test tests/weather/normalize.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalizeMet, roundCoord } from '../../api/_lib/weatherNormalize.ts';

const raw = JSON.parse(readFileSync(new URL('./fixtures/met-compact.json', import.meta.url), 'utf8'));
const NOW = new Date('2026-11-06T09:41:00Z');
const ZONE = 'Asia/Jerusalem';
const round1 = (v: number) => Math.round(v * 10) / 10;

test('48 consecutive hours from the current hour and 7 days', () => {
  const f = normalizeMet(raw, ZONE, NOW);
  assert.equal(f.hours.length, 48);
  assert.equal(f.days.length, 7);
  assert.equal(f.hours[0].t, '2026-11-06T09:00:00Z');
  for (let i = 1; i < f.hours.length; i++) {
    assert.equal(Date.parse(f.hours[i].t) - Date.parse(f.hours[i - 1].t), 3600_000, `gap at ${i}`);
  }
  assert.deepEqual(f.now, f.hours[0]);
  assert.equal(f.updated, '2026-11-06T07:25:52Z');
});

test('wind in km/h from m/s', () => {
  const f = normalizeMet(raw, ZONE, NOW);
  const step = raw.properties.timeseries.find((s: any) => s.time === '2026-11-06T09:00:00Z');
  assert.equal(f.hours[0].windKmh, round1(step.data.instant.details.wind_speed * 3.6));
  assert.equal(f.hours[0].gustKmh, null);
});

test('daily max is never below daily min, days are consecutive local dates', () => {
  const f = normalizeMet(raw, ZONE, NOW);
  assert.equal(f.days[0].date, '2026-11-06');
  assert.equal(f.days[6].date, '2026-11-12');
  for (const d of f.days) assert.ok(d.tMax! >= d.tMin!, d.date);
});

test('hours without next_1_hours fall back to next_6_hours / 6 and nothing is NaN', () => {
  const copy = structuredClone(raw);
  for (const s of copy.properties.timeseries) delete s.data.next_1_hours;
  const f = normalizeMet(copy, ZONE, NOW);
  const step = copy.properties.timeseries.find((s: any) => s.time === '2026-11-06T09:00:00Z');
  assert.equal(f.hours[0].rain, round1(step.data.next_6_hours.details.precipitation_amount / 6));
  for (const h of f.hours) assert.ok(h.rain !== null && !Number.isNaN(h.rain), h.t);
  for (const d of f.days) assert.ok(!Number.isNaN(d.rain), d.date);
});

test('a broken response is an error', () => {
  assert.throws(() => normalizeMet({}, ZONE, NOW), /bad MET response/);
});

test('coordinates round to 0.05°', () => {
  assert.equal(roundCoord(33.2733), 33.25);
  assert.equal(roundCoord(35.2033), 35.2);
  assert.equal(roundCoord(-0.026), -0.05);
});
