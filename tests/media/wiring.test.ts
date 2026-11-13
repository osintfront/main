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
