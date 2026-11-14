// Run: node --experimental-strip-types --test tests/ask/statsCompute.test.ts
//
// Statistics dashboard — the counting engine's second half: Israel-time buckets (summer-time change
// included), change against the previous period, hotspots, night share, the insight number check and
// the stored result.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  allowedNumbers, bucketStarts, bucketUnit, buildResult, cleanInsights, computeStats, insightOk, pctChange, type Incident,
} from '../../supabase/functions/_shared/askStatsCore.ts';

const inc = (n: number, iso: string, place: string, reports = 1): Incident =>
  ({ n, at: iso, place, lat: 33 + n / 100, lng: 35.8, title: `t${n}`, ids: [`e${n}`], reports });

const period = { since: '2026-11-07T10:00:00.000Z', until: '2026-11-14T10:00:00.000Z', preset: '7d' as const };
// 14 incidents: Quneitra 5, Daraa 3, Hermon 2, four singles. Night (Israel = UTC+2 in November):
// #2 22:30, #3 23:10, #4 04:59 — #5 at 05:00 is not night.
const cur: Incident[] = [
  inc(1, '2026-11-08T08:00:00Z', 'Quneitra'), inc(2, '2026-11-08T20:30:00Z', 'Quneitra'),
  inc(3, '2026-11-09T21:10:00Z', 'Quneitra'), inc(4, '2026-11-10T02:59:00Z', 'Quneitra'),
  inc(5, '2026-11-10T03:00:00Z', 'Quneitra'), inc(6, '2026-11-11T08:00:00Z', 'Daraa'),
  inc(7, '2026-11-11T09:00:00Z', 'Daraa'), inc(8, '2026-11-11T10:00:00Z', 'Daraa'),
  inc(9, '2026-11-11T11:00:00Z', 'Beit Jinn'), inc(10, '2026-11-12T08:00:00Z', 'Hermon'),
  inc(11, '2026-11-12T09:00:00Z', 'Hermon'), inc(12, '2026-11-13T08:00:00Z', 'Rafid'),
  inc(13, '2026-11-13T09:00:00Z', 'Jubata'), inc(14, '2026-11-13T10:00:00Z', 'Khan Arnabah'),
];
const prev: Incident[] = ['01', '01', '02', '02', '03', '04', '04', '05', '06', '06'].map((d, i) => inc(i + 1, `2026-11-${d}T08:00:00Z`, 'Quneitra'));
const counts = { classified: 30, unclear: 2 };

test('bucketUnit by span', () => {
  assert.equal(bucketUnit(48 * 3600e3), 'hour');
  assert.equal(bucketUnit(48 * 3600e3 + 1), 'day');
  assert.equal(bucketUnit(31 * 86400e3), 'day');
  assert.equal(bucketUnit(31 * 86400e3 + 1), 'week');
});

test('bucketStarts: clock hours', () => {
  const b = bucketStarts('2026-11-13T10:30:00Z', '2026-11-14T10:30:00Z', 'hour');
  assert.equal(b.length, 25);
  assert.equal(b[0], '2026-11-13T10:00:00.000Z');
});

test('bucketStarts: Israel days', () => {
  const b = bucketStarts('2026-11-07T12:00:00Z', '2026-11-14T12:00:00Z', 'day');
  assert.equal(b.length, 8);
  assert.equal(b[0], '2026-11-06T22:00:00.000Z');
});

test('bucketStarts: the end of summer time gives one 25-hour day, nothing missing or doubled', () => {
  const p = { since: '2026-10-15T10:00:00.000Z', until: '2026-11-14T10:00:00.000Z', preset: '30d' as const };
  const b = bucketStarts(p.since, p.until, 'day');
  assert.equal(b.length, 31);
  assert.equal(b[0], '2026-10-14T21:00:00.000Z');
  for (let i = 1; i < b.length; i++) assert.ok(b[i] > b[i - 1]);
  const at = b.indexOf('2026-10-24T21:00:00.000Z');
  assert.ok(at >= 0);
  assert.equal(b[at + 1], '2026-10-25T22:00:00.000Z');
  const f = computeStats([inc(1, '2026-10-25T21:30:00Z', 'Khiam')], null, p, counts);
  const holding = f.buckets.filter((x) => x.incidents.includes(1));
  assert.equal(holding.length, 1);
  assert.equal(holding[0].start, '2026-10-24T21:00:00.000Z');
});

test('bucketStarts: Israel weeks start on Sunday', () => {
  const b = bucketStarts('2026-09-01T00:00:00Z', '2026-11-14T00:00:00Z', 'week');
  assert.equal(b.length, 11);
  assert.equal(b[0], '2026-08-29T21:00:00.000Z');
});

test('pctChange', () => {
  assert.equal(pctChange(14, 10), 40);
  assert.equal(pctChange(5, 10), -50);
  assert.equal(pctChange(0, 0), 0);
  assert.equal(pctChange(3, 0), null);
  assert.equal(pctChange(3, null), null);
});

test('computeStats: totals, buckets, peak, hotspots, night share', () => {
  const f = computeStats(cur, prev, period, counts);
  assert.equal(f.unit, 'day');
  assert.equal(f.totals.incidents, 14);
  assert.equal(f.totals.previous, 10);
  assert.equal(f.totals.change_pct, 40);
  assert.equal(f.totals.reports, 14);
  assert.equal(f.totals.classified, 30);
  assert.equal(f.totals.unclear, 2);
  assert.equal(f.totals.night_pct, 21);
  assert.equal(f.buckets.reduce((s, b) => s + b.count, 0), 14);
  assert.equal(f.buckets.reduce((s, b) => s + (b.prev ?? 0), 0), 10);
  const seen = f.buckets.flatMap((b) => b.incidents).sort((a, b) => a - b);
  assert.deepEqual(seen, cur.map((i) => i.n));
  const max = Math.max(...f.buckets.map((b) => b.count));
  assert.deepEqual(f.peak, { index: f.buckets.findIndex((b) => b.count === max), count: max });
  assert.equal(f.places.length, 6);
  assert.deepEqual(f.places.map((p) => p.share), [36, 21, 14, 7, 7, 14]);
  assert.deepEqual(f.places.slice(0, 5).map((p) => p.name), ['Quneitra', 'Daraa', 'Hermon', 'Beit Jinn', 'Jubata']);
  assert.deepEqual({ other: f.places[5].other, count: f.places[5].count }, { other: true, count: 2 });
});

test('computeStats: the earliest bucket wins a tie for the peak', () => {
  const f = computeStats([inc(1, '2026-11-08T08:00:00Z', 'A'), inc(2, '2026-11-10T08:00:00Z', 'B')], null, period, counts);
  assert.equal(f.peak!.index, f.buckets.findIndex((b) => b.count === 1));
});

test('computeStats: no previous period, no incidents', () => {
  const f = computeStats(cur, null, period, counts);
  assert.equal(f.totals.previous, null);
  assert.equal(f.totals.change_pct, null);
  assert.ok(f.buckets.every((b) => b.prev === null));
  const z = computeStats([], prev, period, counts);
  assert.equal(z.totals.incidents, 0);
  assert.equal(z.peak, null);
  assert.deepEqual(z.places, []);
  assert.equal(z.totals.night_pct, null);
  assert.equal(z.buckets.length, 8);
  assert.ok(z.buckets.every((b) => b.count === 0));
});

test('insightOk: every number must come from the figures', () => {
  const f = computeStats(cur, prev, period, counts);
  const allowed = allowedNumbers(f, period);
  assert.equal(insightOk('Incursions rose 40% to 14 incidents [1][3]', allowed), true);
  assert.equal(insightOk('About 20 incidents were recorded', allowed), false);
  assert.equal(insightOk(`Peak on 12/11 at 03:00 with ${f.peak!.count} incidents [7]`, allowed), true);
  assert.equal(insightOk('Quneitra accounts for 36% of incidents [2]', allowed), true);
  assert.equal(insightOk('Quneitra accounts for 37% of incidents [2]', allowed), false);
  assert.equal(insightOk('4 more than the previous 10', allowed), true);
  assert.equal(insightOk('Activity concentrated in the south', allowed), true);
});

test('cleanInsights', () => {
  const f = computeStats(cur, prev, period, counts);
  const out = cleanInsights(['ok 14 [2] [99]', 'bad 999', '', 5, 'x'.repeat(400)], f, period);
  assert.equal(out[0], 'ok 14 [2]');
  assert.ok(!out.includes('bad 999'));
  assert.ok(!out.includes(''));
  assert.equal(out[1].length, 300);
  assert.equal(out.length, 2);
  assert.equal(cleanInsights(Array.from({ length: 7 }, (_, i) => `point ${i}`), f, period).length, 5);
  assert.deepEqual(cleanInsights('x', f, period), []);
  assert.deepEqual(cleanInsights(['fine'], computeStats([], prev, period, counts), period), []);
});

test('buildResult', () => {
  const f = computeStats(cur, prev, period, counts);
  const metric = { title: 'T', subject: 's', actor: 'Israel', target: 'Syria', target_country: 'Syria', categories: ['infiltration'], countries: ['Syria'], places: [], terms: ['x'] };
  const r = buildResult({ lang: 'en', title: 'T', metric, period, figures: f, incidents: cur, insights: ['a'], nowIso: '2026-11-14T10:00:00.000Z' });
  assert.equal(r.v, 1);
  assert.equal(r.period.unit, 'day');
  assert.equal(r.period.preset, '7d');
  assert.equal(r.incidents, cur);
  assert.deepEqual(r.insights, ['a']);
  assert.deepEqual(r.metric, { subject: 's', actor: 'Israel', target: 'Syria', target_country: 'Syria' });
  assert.equal(r.generated_at, '2026-11-14T10:00:00.000Z');
});
