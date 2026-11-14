// Run: node --experimental-strip-types --test tests/ask/askStatsClient.test.ts
//
// Statistics dashboard — the browser's pure rules: clarify replies, credits left, number and date
// labels (Western digits, Israel time), the conversation line of a dashboard, which events a press
// shows, tap-then-act on touch, file names, PDF source lines, polling state — and the shape shared
// with the server's result.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyStatus, bucketLabel, changeText, clarifyReplyKind, creditsLeft, exportFileName, fmtNum, historyLine, periodDates,
  selectionEvents, showsEvents, shownSummary, sourceLines, tapAction, withDashLines, type DashResult, type DashState,
} from '../../src/lib/askStats.ts';
import { buildResult, computeStats, mergeIncidents, type Classified } from '../../supabase/functions/_shared/askStatsCore.ts';

const R: DashResult = {
  v: 1, lang: 'en', title: 'Israeli incursions into Syria', generated_at: '2026-11-14T10:00:00.000Z',
  metric: { subject: 's', actor: 'Israel', target: 'Syria', target_country: 'Syria' },
  period: { since: '2026-11-07T10:00:00.000Z', until: '2026-11-14T10:00:00.000Z', preset: '7d', unit: 'day' },
  totals: { incidents: 2, reports: 4, classified: 5, unclear: 0, previous: 1, change_pct: 100, night_pct: 0 },
  buckets: [{ start: '2026-11-06T22:00:00.000Z', count: 1, prev: 1, incidents: [1] }, { start: '2026-11-07T22:00:00.000Z', count: 1, prev: 0, incidents: [2] }],
  peak: { index: 0, count: 1 },
  places: [{ name: 'Quneitra', count: 2, share: 100, reports: 4, lat: 33.1, lng: 35.8, incidents: [1, 2], other: false }],
  incidents: [
    { n: 1, at: '2026-11-07T11:00:00.000Z', place: 'Quneitra', lat: 33.1, lng: 35.8, title: 'IDF  force\nentered', ids: ['a', 'b'], reports: 3 },
    { n: 2, at: '2026-11-08T11:00:00.000Z', place: 'Quneitra', lat: 33.1, lng: 35.8, title: 'Second', ids: ['c'], reports: 1 },
  ],
  insights: ['x'],
};
const L = { dashboard: 'Dashboard', incidents: 'incidents' };
const run = (over: Partial<DashState> = {}): DashState =>
  ({ id: 'n1', status: 'running', stage: 'finding', progress: null, result: null, cached: false, rebuild: null, note: null, ...over });

test('clarifyReplyKind', () => {
  assert.equal(clarifyReplyKind('clarify_stats', 'x', 'dashboard'), 'dashboard');
  assert.equal(clarifyReplyKind('clarify_stats', 'yes please'), 'typed');
  assert.equal(clarifyReplyKind('clarify_stats', 'x'.repeat(41)), null);
  assert.equal(clarifyReplyKind('answer', 'yes'), null);
  assert.equal(clarifyReplyKind(undefined, 'x', 'dashboard'), null);
});

test('showsEvents', () => {
  assert.equal(showsEvents('answer'), true);
  assert.equal(showsEvents('summary'), true);
  for (const m of ['stats', 'clarify_stats', 'too_many']) assert.equal(showsEvents(m), false);
});

test('creditsLeft', () => {
  assert.equal(creditsLeft({ enabled: true, staff: false, limit: 10, used: 7.2 }), 2);
  assert.equal(creditsLeft({ enabled: true, staff: true, limit: 10, used: 1 }), null);
  assert.equal(creditsLeft({ enabled: false, staff: false, limit: 10, used: 1 }), null);
  assert.equal(creditsLeft({ enabled: true, staff: false, limit: null, used: 1 }), null);
  assert.equal(creditsLeft(null), null);
  assert.equal(creditsLeft({ enabled: true, staff: false, limit: 10, used: 12 }), 0);
});

test('numbers and dates: Western digits, Israel time', () => {
  assert.equal(fmtNum(1234), '1,234');
  assert.equal(changeText(40, '—'), '+40%');
  assert.equal(changeText(-12, '—'), '-12%');
  assert.equal(changeText(0, '—'), '0%');
  assert.equal(changeText(null, '—'), '—');
  const outs = [bucketLabel('2026-11-12T22:00:00.000Z', 'day'), bucketLabel('2026-11-13T12:00:00.000Z', 'hour'), periodDates('2026-11-07T10:00:00Z', '2026-11-14T10:00:00Z')];
  assert.deepEqual(outs, ['13/11', '14:00', '07/11/2026 – 14/11/2026']);
  for (const o of outs) assert.match(o, /^[0-9/: –]+$/);
});

test('historyLine and withDashLines', () => {
  assert.equal(historyLine(R, L), 'Dashboard: Israeli incursions into Syria — 2 incidents, 07/11/2026 – 14/11/2026');
  const turns = [
    { mode: 'answer', answer: 'a1' },
    { mode: 'stats', answer: '', dashboard: run({ status: 'done', result: R }) },
    { mode: 'stats', answer: '', dashboard: run() },
  ];
  const out = withDashLines(turns, L);
  assert.equal(out[0], turns[0]);
  assert.equal(out[1].answer, historyLine(R, L));
  assert.equal(out[2], turns[2]);
});

test('selectionEvents and shownSummary', () => {
  assert.deepEqual(selectionEvents(R, { kind: 'all' }), { ids: ['a', 'b', 'c'], incidents: 2, reports: 4 });
  assert.deepEqual(selectionEvents(R, { kind: 'bucket', index: 1 }), { ids: ['c'], incidents: 1, reports: 1 });
  assert.deepEqual(selectionEvents(R, { kind: 'incident', n: 1 }), { ids: ['a', 'b'], incidents: 1, reports: 3 });
  assert.deepEqual(selectionEvents(R, { kind: 'place', index: 0 }), selectionEvents(R, { kind: 'all' }));
  assert.deepEqual(selectionEvents(R, { kind: 'incident', n: 99 }), { ids: [], incidents: 0, reports: 0 });
  assert.deepEqual(shownSummary({ ids: ['a', 'b', 'c'], incidents: 2, reports: 4 }, ['a', 'c']), { incidents: 2, reports: 4, missing: 1 });
});

test('tapAction: first tap shows the tip on touch', () => {
  assert.equal(tapAction(null, 'bar:2', 'touch'), 'tip');
  assert.equal(tapAction('bar:2', 'bar:2', 'touch'), 'act');
  assert.equal(tapAction('bar:1', 'bar:2', 'touch'), 'tip');
  assert.equal(tapAction(null, 'bar:2', 'mouse'), 'act');
});

test('exportFileName', () => {
  const d = new Date('2026-11-14T10:00:00Z');
  assert.equal(exportFileName('Israeli incursions into Syria', 'pdf', d), 'osintfront-dashboard-israeli-incursions-into-syria-2026-11-14.pdf');
  assert.equal(exportFileName('חדירות ישראליות לסוריה', 'jpg', d), 'osintfront-dashboard-חדירות-ישראליות-לסוריה-2026-11-14.jpg');
  assert.equal(exportFileName(' ?? / ', 'pdf', d), 'osintfront-dashboard-2026-11-14.pdf');
  const long = exportFileName('word '.repeat(20), 'pdf', d);
  const slug = long.slice('osintfront-dashboard-'.length, -'-2026-11-14.pdf'.length);
  assert.ok(slug.length <= 60 && !slug.endsWith('-'));
  assert.equal(exportFileName('x', 'pdf', new Date('2026-11-14T22:30:00Z')), 'osintfront-dashboard-x-2026-11-15.pdf');
});

test('sourceLines', () => {
  const s = sourceLines(R, 'https://osintfront.com');
  assert.equal(s.length, 2);
  assert.deepEqual(s[0], { n: 1, title: 'IDF force entered', url: 'https://osintfront.com/e/a' });
});

test('applyStatus', () => {
  const a = applyStatus(run(), 'n1', { status: 'running', stage: 'classifying', progress: { done: 120, total: 340 }, result: null, cached: false });
  assert.equal(a.stage, 'classifying');
  assert.deepEqual(a.progress, { done: 120, total: 340 });
  const b = applyStatus(a, 'n1', { status: 'done', stage: 'insights', progress: null, result: R, cached: false });
  assert.equal(b.status, 'done');
  assert.equal(b.result, R);
  assert.equal(applyStatus(a, 'other', { status: 'done', stage: 'insights', progress: null, result: R, cached: false }), a);
  const R2 = { ...R, title: 'new' };
  const withRebuild = run({ status: 'done', result: R, rebuild: { id: 'n2', preset: '24h', stage: 'finding', progress: null } });
  const c = applyStatus(withRebuild, 'n2', { status: 'done', stage: 'insights', progress: null, result: R2, cached: false });
  assert.deepEqual([c.id, c.result, c.rebuild], ['n2', R2, null]);
  const f = applyStatus(withRebuild, 'n2', { status: 'failed', stage: 'classifying', progress: null, result: null, cached: false });
  assert.deepEqual([f.id, f.result, f.rebuild, f.note], ['n1', R, null, 'failed']);
});

test('the server result fits the browser shape', () => {
  const ev = (id: string, min: number, over: Partial<Classified> = {}): Classified => ({
    id, occurred_at: new Date(Date.parse('2026-11-10T08:00:00Z') + min * 60_000).toISOString(), title: `t-${id}`, title_en: null, description: '',
    category_slug: 'infiltration', country: 'Syria', location_name: 'Quneitra', latitude: 33.1, longitude: 35.8, location_precision: 'exact',
    source_count: 1, fits: 'yes', actor: 'Israel', target: 'Syria', place: 'Quneitra', incident: '', ...over,
  });
  const incs = mergeIncidents([ev('a', 0), ev('b', 10), ev('c', 300)], 'en');
  const period = { since: R.period.since, until: R.period.until, preset: '7d' as const };
  const metric = { title: 'T', subject: 's', actor: null, target: null, target_country: null, categories: [], countries: [], places: [], terms: [] };
  const server = buildResult({ lang: 'en', title: 'T', metric, period, figures: computeStats(incs, null, period, { classified: 3, unclear: 0 }), incidents: incs, insights: [], nowIso: R.generated_at });
  const r = server as unknown as DashResult;
  const all = selectionEvents(r, { kind: 'all' });
  assert.deepEqual(all.ids, incs.flatMap((i) => i.ids));
  assert.equal(all.incidents, incs.length);
  assert.deepEqual(sourceLines(r, 'https://osintfront.com').map((s) => s.n), incs.map((i) => i.n));
});
