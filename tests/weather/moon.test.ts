// Run: node --experimental-strip-types --test tests/weather/moon.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { effectiveLight, fmtTime, moonPhase, moonTimes, sunTimes, zoneForCountry } from '../../src/lib/moon.ts';

const near = (a: number | null, b: number, eps: number) => assert.ok(a !== null && Math.abs(a - b) < eps, `${a} ≉ ${b}`);

test('full moon 2026-01-03 10:03 UTC', () => {
  const m = moonPhase(new Date('2026-01-03T10:03:00Z'));
  assert.ok(m.fraction > 0.98, String(m.fraction));
  assert.equal(m.state, 'full');
});

test('new moon 2026-01-18 19:52 UTC', () => {
  const m = moonPhase(new Date('2026-01-18T19:52:00Z'));
  assert.ok(m.fraction < 0.02, String(m.fraction));
  assert.equal(m.state, 'new');
});

test('first quarter 2026-01-26 04:47 UTC is a waxing half moon', () => {
  const m = moonPhase(new Date('2026-01-26T04:47:00Z'));
  near(m.fraction, 0.5, 0.03);
  assert.equal(m.state, 'half');
  assert.equal(m.waxing, true);
});

test('moonlight after clouds', () => {
  assert.equal(effectiveLight(1, 0, true), 1);
  near(effectiveLight(1, 100, true), 0.1, 1e-9);
  near(effectiveLight(0.5, 50, true), 0.275, 1e-9);
  assert.equal(effectiveLight(1, 0, false), 0);
  assert.equal(effectiveLight(1, null, true), null);
});

test('sun times in Tel Aviv on the June solstice are in order', () => {
  const s = sunTimes(new Date('2026-06-21T09:00:00Z'), 32.08, 34.78);
  const order = [s.astroDawn, s.nauticalDawn, s.civilDawn, s.sunrise, s.sunset, s.civilDusk, s.nauticalDusk, s.astroDusk];
  for (let i = 1; i < order.length; i++) assert.ok(order[i - 1]! < order[i]!, `step ${i}`);
  assert.ok(s.dayLengthMin! >= 840 && s.dayLengthMin! <= 860, String(s.dayLengthMin));
});

test('a day without moonrise or moonset shows a dash, never an invalid date', () => {
  let found = false;
  for (let d = 1; d <= 31; d++) {
    const t = moonTimes(new Date(Date.UTC(2026, 0, d, 10)), 32.08, 34.78);
    for (const v of [t.rise, t.set]) if (v) assert.ok(!Number.isNaN(v.getTime()));
    if (!t.rise || !t.set) found = true;
  }
  assert.ok(found, 'expected at least one day in January 2026 without a moonrise or moonset');
  assert.equal(fmtTime(null), '—');
});

test('time zones only for countries we know', () => {
  assert.equal(zoneForCountry('IR'), 'Asia/Tehran');
  assert.equal(zoneForCountry('LB'), 'Asia/Beirut');
  assert.equal(zoneForCountry(null), null);
  assert.equal(zoneForCountry('FR'), null);
});

test('fmtTime shows the time in the given zone', () => {
  assert.equal(fmtTime(new Date('2026-11-06T10:00:00Z'), 'Asia/Tehran'), '13:30');
});

test('night window: after midnight it is the current night, until this morning\'s sunrise', async () => {
  const { nightWindow } = await import('../../src/lib/moon.ts');
  const now = new Date('2026-11-07T00:00:00Z'); // 02:00 in Tel Aviv
  const w = nightWindow(now, 32.08, 34.78)!;
  assert.equal(w.from.getTime(), now.getTime());
  const sunrise = sunTimes(now, 32.08, 34.78).sunrise!;
  assert.equal(w.to.getTime(), sunrise.getTime());
  assert.ok(w.to.getTime() - now.getTime() < 6 * 3600_000, 'ends this morning, not tomorrow');
});

test('night window: in the afternoon it is the coming night, sunset to tomorrow\'s sunrise', async () => {
  const { nightWindow } = await import('../../src/lib/moon.ts');
  const now = new Date('2026-11-06T12:00:00Z'); // 14:00 in Tel Aviv
  const w = nightWindow(now, 32.08, 34.78)!;
  assert.equal(w.from.getTime(), sunTimes(now, 32.08, 34.78).sunset!.getTime());
  assert.ok(w.to > w.from && w.to.getTime() - w.from.getTime() < 16 * 3600_000);
});

test('night window: in the evening it starts now', async () => {
  const { nightWindow } = await import('../../src/lib/moon.ts');
  const now = new Date('2026-11-06T18:00:00Z'); // 20:00 in Tel Aviv
  const w = nightWindow(now, 32.08, 34.78)!;
  assert.equal(w.from.getTime(), now.getTime());
  assert.ok(w.to.getTime() - now.getTime() < 12 * 3600_000);
});
