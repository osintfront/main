// Run: node --experimental-strip-types --test tests/media/reviewFixes.test.ts
//
// Fixes from the whole-branch review: no paid run without a click (joining is a poll), one refund per
// failed run (only while the lease is still ours), every step inside the job's time, saved readings
// found by media id (merged events), a Gemini setup error is "busy" not a saved "unreadable", and a
// failing speech route leaves that video retryable while the pictures are still read.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { MEDIA_LIMITS, refundAfterJob, routeOutcome, speechBudgetMs } from '../../supabase/functions/_shared/mediaInput.ts';
import { geminiOutcome, remainingMs } from '../../api/_lib/speechInput.ts';

const read = (p: string) => readFileSync(p, 'utf8');

test('refundAfterJob: only a failed run, with a reader, whose lease is still ours', () => {
  assert.equal(refundAfterJob({ ok: false, uid: 'u', owned: true }), true);
  assert.equal(refundAfterJob({ ok: false, uid: 'u', owned: false }), false, 'the stale-lease takeover already refunded');
  assert.equal(refundAfterJob({ ok: true, uid: 'u', owned: true }), false);
  assert.equal(refundAfterJob({ ok: false, uid: null, owned: true }), false);
});

test('speechBudgetMs: the route gets what is left after Claude’s share', () => {
  const now = 1_000_000;
  assert.equal(speechBudgetMs(now + MEDIA_LIMITS.jobMs, now), MEDIA_LIMITS.routeMs);
  assert.equal(speechBudgetMs(now + MEDIA_LIMITS.claudeMs + 5000 + 30_000, now), 30_000);
  assert.equal(speechBudgetMs(now + MEDIA_LIMITS.claudeMs + 5000 + 10_000, now), 0, 'under 15 s → no route call');
  assert.ok(MEDIA_LIMITS.jobMs + 20_000 < MEDIA_LIMITS.leaseMin * 60_000, 'the job ends well inside its lease');
});

test('routeOutcome: a failed route leaves the speech "off" (retried later), never a failed run', () => {
  const f = routeOutcome('failed');
  assert.equal(f.state, 'off');
  assert.equal(f.speech, '');
  const ok = { state: 'ok' as const, lang: 'ar', seconds: 3, speech: 'x', onScreen: [], cut: false };
  assert.deepEqual(routeOutcome(ok), ok);
});

test('geminiOutcome: a refusal of the request is busy; a safety block or empty answer is unreadable', () => {
  for (const s of [400, 401, 403, 404]) assert.equal(geminiOutcome(s, {}), 'busy', String(s));
  assert.equal(geminiOutcome(200, { promptFeedback: { blockReason: 'SAFETY' } }), 'unreadable');
  assert.equal(geminiOutcome(200, { candidates: [{ finishReason: 'SAFETY' }] }), 'unreadable');
  assert.equal(geminiOutcome(200, { candidates: [{ content: { parts: [{ text: '{}' }] } }] }), 'ok');
});

test('remainingMs', () => {
  assert.equal(remainingMs(1000, 0, 500), 500);
  assert.equal(remainingMs(1000, 800, 500), 200);
  assert.equal(remainingMs(1000, 1200, 500), 0);
});

test('wiring of the fixes', () => {
  const job = read('supabase/functions/_shared/media.ts');
  assert.ok(/from\("media_readings"\)\.select\("media_id,speech"\)\.in\("media_id"/.test(job), 'readings by media id');
  for (const w of ['refundAfterJob(', 'speechBudgetMs(', 'routeOutcome(']) assert.ok(job.includes(w), w);
  assert.ok(!job.includes('speech route failed'), 'a route failure does not fail the run');
  const route = read('api/transcribe.ts');
  for (const w of ['geminiOutcome(', 'remainingMs(', "redirect: 'error'"]) assert.ok(route.includes(w), w);
  assert.ok(!/u === 'failed'\) return json\(\{ state: 'unreadable'/.test(route), 'an upload failure is busy, not saved');
  const svc = read('src/services/mediaTranslateService.ts');
  assert.ok(svc.includes('join'), 'joining someone else’s run polls from the first request');
  const ui = read('src/components/feed/MediaTranslate.tsx');
  assert.ok(/runMediaTranslation\(id, \{ join: true \}\)/.test(ui), 'the window joins, never starts');
});
