// Run: node --experimental-strip-types --test tests/media/wiring.test.ts
//
// Media translation wiring, read as text: the Vercel speech route (Gemini, our secret, our bucket
// only), and later the edge job and the event-agent action. No OpenAI anywhere.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const read = (p: string) => readFileSync(p, 'utf8');

test('the speech route', () => {
  const s = read('api/transcribe.ts');
  for (const w of ['x-translate-secret', 'allowedMediaUrl(', 'mp4DurationSec(', 'cleanSpeech(', 'BLOCK_NONE', 'MEDIA_RESOLUTION_LOW', 'GEMINI_API_KEY']) {
    assert.ok(s.includes(w), w);
  }
  assert.ok(!/openai|whisper/i.test(s), 'no OpenAI');
  const v = JSON.parse(read('vercel.json'));
  assert.equal(v.functions['api/transcribe.ts'].maxDuration, 120);
});

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : p.endsWith('.ts') ? [p] : [];
  });
}

test('the event-agent action', () => {
  const s = read('supabase/functions/event-agent/index.ts');
  for (const w of ['"media_translate"', 'mediaNextStep(', 'mediaOverAfterClaim(', 'staleMediaJob(']) assert.ok(s.includes(w), w);
  assert.ok((s.match(/p_key: "media_translate"/g) ?? []).length >= 3, 'one consume, at least two refunds');
  const header = s.slice(0, s.indexOf('import '));
  assert.ok(header.includes('media_translate'), 'header comment names the action');
});

test('the job', () => {
  const s = read('supabase/functions/_shared/media.ts');
  for (const w of ['media_translate_staff', 'cleanReading(', 'cleanRoute(', 'fixTerms(', '/api/transcribe', 'x-translate-secret', 'media_done']) {
    assert.ok(s.includes(w), w);
  }
  assert.ok(!s.includes('runAsReader'), 'not counted as an Ask-the-map credit');
  assert.ok(!s.includes('GEMINI_API_KEY'), 'the edge function never holds a Gemini key');
  assert.ok(!/openai|whisper/i.test(s), 'no OpenAI');
  for (const f of [...walk('supabase/functions'), ...walk('api')]) assert.ok(!read(f).includes('api.openai.com'), f);
});
