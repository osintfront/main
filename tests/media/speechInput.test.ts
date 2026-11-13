// Run: node --experimental-strip-types --test tests/media/speechInput.test.ts
//
// The Vercel speech route's pure rules: which addresses it accepts, the video length from the mp4
// header, the prompt Gemini gets, and how its answer is cleaned.
import test from 'node:test';
import assert from 'node:assert/strict';
import { SPEECH_LIMITS, SPEECH_PROMPT, allowedMediaUrl, cleanSpeech, langCode, mp4DurationSec } from '../../api/_lib/speechInput.ts';

const SB = 'https://abc.supabase.co';
const P = '/storage/v1/object/public/event-media/';

test('limits', () => {
  assert.equal(SPEECH_LIMITS.maxBytes, 50 * 1024 * 1024);
  assert.equal(SPEECH_LIMITS.maxSec, 600);
  assert.equal(SPEECH_LIMITS.inlineBytes, 12 * 1024 * 1024);
});

test('allowedMediaUrl: only our own event-media bucket over https', () => {
  assert.equal(allowedMediaUrl(`${SB}${P}2026/11/e/x.mp4?t=1#f`, SB), `${SB}${P}2026/11/e/x.mp4`);
  for (const bad of [
    `http://abc.supabase.co${P}x.mp4`,
    `https://evil.example${P}x.mp4`,
    `https://abc.supabase.co.evil.example${P}x.mp4`,
    `${SB}/storage/v1/object/public/geoloc-proofs/x.mp4`,
    `${SB}${P}a/../../secret.mp4`,
    `${SB}/storage/v1/object/public/event-media`,
    null,
    5,
  ]) assert.equal(allowedMediaUrl(bad, SB), null, String(bad));
  assert.equal(allowedMediaUrl(`${SB}${P}x.mp4`, ''), null);
});

const u32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const u64 = (n: number) => [...u32(Math.floor(n / 2 ** 32)), ...u32(n >>> 0)];
const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));
const box = (type: string, payload: number[]) => [...u32(payload.length + 8), ...ascii(type), ...payload];
const box64 = (type: string, payload: number[]) => [...u32(1), ...ascii(type), ...u64(payload.length + 16), ...payload];
// mvhd version 0: version+flags(4), creation(4), modification(4), timescale(4), duration(4) …
const mvhd0 = (ts: number, dur: number) => box('mvhd', [0, 0, 0, 0, ...u32(0), ...u32(0), ...u32(ts), ...u32(dur), ...new Array(80).fill(0)]);
// mvhd version 1: version+flags(4), creation(8), modification(8), timescale(4), duration(8) …
const mvhd1 = (ts: number, dur: number) => box('mvhd', [1, 0, 0, 0, ...u64(0), ...u64(0), ...u32(ts), ...u64(dur), ...new Array(80).fill(0)]);
const ftyp = box('ftyp', ascii('isom0000'));
const file = (...parts: number[][]) => new Uint8Array(parts.flat());

test('mp4DurationSec reads mvhd', () => {
  assert.equal(mp4DurationSec(file(ftyp, box('moov', mvhd0(1000, 61500)))), 61.5);
  assert.equal(mp4DurationSec(file(ftyp, box('mdat', new Array(1000).fill(7)), box('moov', mvhd0(1000, 2000)))), 2);
  assert.equal(mp4DurationSec(file(ftyp, box('moov', mvhd1(90000, 54_000_000)))), 600);
  assert.equal(mp4DurationSec(file(ftyp, box64('moov', mvhd0(10, 50)))), 5);
  assert.equal(mp4DurationSec(file(ftyp, box('moov', mvhd0(0, 50)))), null);
  assert.equal(mp4DurationSec(file(ftyp, box('free', [1, 2, 3]))), null);
  assert.equal(mp4DurationSec(new Uint8Array([...u32(5000), ...ascii('moov'), 1, 2])), null);
  assert.equal(mp4DurationSec(new Uint8Array(0)), null);
  assert.equal(mp4DurationSec(new Uint8Array([9, 9, 9])), null);
});

test('langCode', () => {
  assert.equal(langCode('Arabic'), 'ar');
  assert.equal(langCode('FA'), 'fa');
  assert.equal(langCode('farsi'), 'fa');
  assert.equal(langCode('xx-YY'), 'und');
  assert.equal(langCode(null), 'und');
});

test('cleanSpeech', () => {
  const raw = '{"speech":" مرحبا بكم ","language":"Arabic","on_screen":["عاجل","عاجل",""," LIVE "]}';
  const want = { state: 'ok', lang: 'ar', speech: 'مرحبا بكم', on_screen: ['عاجل', 'LIVE'], cut: false };
  assert.deepEqual(cleanSpeech(raw), want);
  assert.deepEqual(cleanSpeech('```json\n' + raw + '\n```'), want);
  const none = cleanSpeech({ speech: '', language: 'und', on_screen: ['X'] })!;
  assert.equal(none.state, 'none');
  assert.deepEqual(none.on_screen, ['X']);
  assert.equal(cleanSpeech({ speech: '...' })!.state, 'none');
  const long = cleanSpeech({ speech: 'א'.repeat(9000), language: 'he' })!;
  assert.equal(long.speech.length, 6000);
  assert.equal(long.cut, true);
  assert.equal(cleanSpeech({ speech: 'abcd', on_screen: Array.from({ length: 30 }, (_, i) => `t${i}`) })!.on_screen.length, 20);
  assert.equal(cleanSpeech({ speech: 'abcd', on_screen: ['x'.repeat(500)] })!.on_screen[0].length, 300);
  assert.equal(cleanSpeech('not json'), null);
  assert.equal(cleanSpeech(null), null);
  assert.equal(cleanSpeech([1]), null);
});

test('the prompt', () => {
  for (const w of ['do not translate', 'exactly', 'data', 'on_screen']) assert.ok(SPEECH_PROMPT.includes(w), w);
});
