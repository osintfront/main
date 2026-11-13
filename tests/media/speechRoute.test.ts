// Run: node --experimental-strip-types --test tests/media/speechRoute.test.ts
//
// Speech route diagnosis: every failure gets a short reason (route side and job side), the job hands
// over the time it can wait, and nothing logged carries the speech text.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { busyDetail, routeDeadlineMs } from '../../api/_lib/speechInput.ts';
import { MEDIA_LIMITS, routeNote, routeOutcome, speechBudgetMs, speechNotes } from '../../supabase/functions/_shared/mediaInput.ts';

const read = (p: string) => readFileSync(p, 'utf8');

test('routeDeadlineMs', () => {
  assert.equal(routeDeadlineMs(undefined), 90000);
  assert.equal(routeDeadlineMs(65000), 65000);
  assert.equal(routeDeadlineMs(5), 10000);
  assert.equal(routeDeadlineMs(500000), 90000);
  assert.equal(routeDeadlineMs('x'), 90000);
  assert.equal(routeDeadlineMs(NaN), 90000);
});

test('busyDetail', () => {
  assert.equal(
    busyDetail('generate', 400, { error: { status: 'INVALID_ARGUMENT', message: 'Request payload size exceeds the limit' } }),
    'generate 400 INVALID_ARGUMENT Request payload size exceeds the limit',
  );
  assert.equal(busyDetail('generate', 429, null), 'generate 429');
  assert.equal(busyDetail('file_wait', null, null), 'file_wait no answer');
  assert.ok(busyDetail('generate', 400, { error: { status: 'X', message: 'm'.repeat(1000) } }).length <= 160);
});

test('routeNote', () => {
  assert.equal(routeNote({ status: 0, body: null, error: 'timeout', waitedMs: 70000 }), 'route timeout after 70000 ms');
  assert.equal(routeNote({ status: 0, body: null, error: 'network', waitedMs: 1 }), 'route network error');
  assert.equal(routeNote({ status: 502, body: { error: 'busy', detail: 'generate 429 RESOURCE_EXHAUSTED' }, error: null, waitedMs: 1 }), 'route 502 busy generate 429 RESOURCE_EXHAUSTED');
  assert.equal(routeNote({ status: 401, body: { error: 'unauthorized' }, error: null, waitedMs: 1 }), 'route 401 unauthorized');
  assert.equal(routeNote({ status: 404, body: null, error: null, waitedMs: 1 }), 'route 404');
  assert.equal(routeNote({ status: 200, body: { state: 'ok', speech: 'x', lang: 'ar' }, error: null, waitedMs: 1 }), null);
  assert.equal(routeNote({ status: 200, body: { state: 'weird' }, error: null, waitedMs: 1 }), 'route 200 unknown answer');
  assert.equal(routeNote({ status: 502, body: { error: 'busy', detail: { x: 1 } }, error: null, waitedMs: 1 }), 'route 502 busy');
});

test('speechNotes', () => {
  assert.equal(speechNotes([null, 'a', 'a', 'b']), 'a | b');
  assert.equal(speechNotes([null]), null);
  assert.ok(speechNotes(Array.from({ length: 40 }, (_, i) => `reason number ${i} `.repeat(3)))!.length <= 300);
});

test('the time mismatch, pinned', () => {
  const now = 1_000_000;
  assert.equal(speechBudgetMs(now + MEDIA_LIMITS.jobMs, now + 30_000), 70_000);
  assert.equal(routeDeadlineMs(70_000 - 5000), 65_000);
  assert.equal(routeOutcome('failed').state, 'off');
});

test('wiring', () => {
  const job = read('supabase/functions/_shared/media.ts');
  for (const w of ['budget_ms', 'routeNote(', 'speechNotes(', '"media speech"', 'speech_note']) assert.ok(job.includes(w), w);
  const route = read('api/transcribe.ts');
  for (const w of ['routeDeadlineMs(', 'busyDetail(', 'detail']) assert.ok(route.includes(w), w);
  assert.ok(!/console\.(log|warn)\([^)]*speech[^_]/.test(route), 'no speech text in route logs');
});
