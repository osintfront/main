// Run: node --experimental-strip-types --test tests/media/speechInput.test.ts
//
// The Vercel speech route's pure rules: which addresses it accepts, the video length from the mp4
// header, the prompt Gemini gets, and how its answer is cleaned.
import test from 'node:test';
import assert from 'node:assert/strict';
import { SPEECH_LIMITS, SPEECH_PROMPT, allowedMediaUrl, cleanSegments, cleanSpeech, langCode, mp4DurationSec, timeSec } from '../../api/_lib/speechInput.ts';

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
  const want = { state: 'ok', lang: 'ar', speech: 'مرحبا بكم', segments: [], on_screen: ['عاجل', 'LIVE'], cut: false };
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
  for (const w of ['do not translate', 'exactly', 'data', 'on_screen', 'segments', 'seconds']) assert.ok(SPEECH_PROMPT.includes(w), w);
});

test('timeSec', () => {
  assert.equal(timeSec(12.5), 12.5);
  assert.equal(timeSec('01:05'), 65);
  assert.equal(timeSec('1:05.5'), 65.5);
  assert.equal(timeSec('01:01:05'), 3665);
  assert.equal(timeSec('7'), 7);
  for (const v of [-1, 'abc', NaN, null, undefined, '1:2:3:4']) assert.equal(timeSec(v), null, String(v));
});

test('cleanSegments', () => {
  const o = { maxChars: 6000, durationSec: null };
  const sc = (r: ReturnType<typeof cleanSegments>) => ({ segments: r.segments, cut: r.cut });
  assert.deepEqual(
    sc(cleanSegments([{ start: 5, end: 7, text: 'ب ب' }, { start: 0, end: 9, text: 'ا ا' }, { start: '00:07', text: 'ج ج' }], o)),
    { segments: [{ start: 0, end: 5, text: 'ا ا' }, { start: 5, end: 7, text: 'ب ب' }, { start: 7, end: 11, text: 'ج ج' }], cut: false },
  );
  assert.equal(cleanSegments([{ start: 0, end: 40, text: 'ab' }], o).segments[0].end, 12);
  const past = cleanSegments([{ start: 11, end: 12, text: 'ab' }], { maxChars: 6000, durationSec: 10 });
  assert.equal(past.segments.length, 0);
  assert.equal(past.lost, true);
  assert.equal(cleanSegments([{ start: 0, end: 2, text: '...' }], o).segments.length, 0);
  assert.equal(cleanSegments([{ start: 'x', end: 2, text: 'ab' }], o).segments.length, 0);
  const two = cleanSegments([{ start: 3, end: 5, text: 'first' }, { start: 3, end: 6, text: 'second' }], o).segments;
  assert.deepEqual(two.map((x) => x.text), ['first second'], 'same start: merged, no text lost');
  const many = cleanSegments(Array.from({ length: 130 }, (_, i) => ({ start: i, end: i + 1, text: 'ab' })), o);
  assert.equal(many.segments.length, 120);
  assert.equal(many.cut, true);
  const chars = cleanSegments([{ start: 0, end: 1, text: 'aaaaa' }, { start: 1, end: 2, text: 'bbbbb' }, { start: 2, end: 3, text: 'ccccc' }], { maxChars: 12, durationSec: null });
  assert.equal(chars.segments.length, 2);
  assert.equal(chars.cut, true);
  assert.deepEqual(sc(cleanSegments('x', o)), { segments: [], cut: false });
  assert.deepEqual(sc(cleanSegments(null, o)), { segments: [], cut: false });
  assert.equal(cleanSegments([{ start: 0, end: 2, text: 'a'.repeat(500) }], o).segments[0].text.length, 300);
  assert.equal(cleanSegments([{ start: 0.123456, end: 1.98765, text: 'ab' }], o).segments[0].start, 0.12);
});

test('cleanSpeech with timed lines', () => {
  const a = cleanSpeech('{"segments":[{"start":0,"end":2,"text":"مرحبا بكم"},{"start":2,"end":4,"text":"في الأخبار"}],"language":"ar","on_screen":[]}')!;
  assert.equal(a.state, 'ok');
  assert.equal(a.speech, 'مرحبا بكم\nفي الأخبار');
  assert.equal(a.segments.length, 2);
  const both = cleanSpeech({ segments: [{ start: 0, end: 2, text: 'من الخطوط' }], speech: 'something else entirely', language: 'ar' })!;
  assert.equal(both.speech, 'من الخطوط');
  const old = cleanSpeech({ speech: 'مرحبا بكم', language: 'ar' })!;
  assert.deepEqual(old.segments, []);
  assert.equal(old.speech, 'مرحبا بكم');
  const short = cleanSpeech({ segments: [{ start: 0, end: 2, text: 'ab' }], language: 'en' }, 60)!;
  assert.equal(short.state, 'none');
});

test('review fixes: speech text is never lost to timing', () => {
  assert.equal(timeSec('00:00:01,500'), 1.5);
  assert.equal(timeSec('1.5s'), 1.5);
  assert.equal(timeSec('2,25'), 2.25);
  const srt = cleanSpeech({ segments: [{ start: '00:00:01,500', end: '00:00:03,000', text: 'hello there friends' }, { start: '3.5s', end: '5s', text: 'and welcome back' }], language: 'en' })!;
  assert.equal(srt.state, 'ok');
  assert.equal(srt.segments.length, 2);
  const same = cleanSpeech({ segments: ['first one', 'second one', 'third one'].map((text) => ({ start: '00:01', end: '00:02', text })), language: 'en' })!;
  assert.equal(same.speech, 'first one second one third one');
  const untimed = cleanSpeech({ segments: [{ start: 0, end: 2, text: 'timed words here' }, { start: 'soon', text: 'untimed words here' }], language: 'en' })!;
  assert.equal(untimed.state, 'ok');
  assert.equal(untimed.speech, 'timed words here\nuntimed words here');
  assert.deepEqual(untimed.segments, [], 'a line without usable timing: no subtitles, all text kept');
  const past = cleanSpeech({ segments: [{ start: 70, end: 72, text: 'said after the end' }], language: 'en' }, 60)!;
  assert.equal(past.state, 'ok');
  assert.equal(past.speech, 'said after the end');
});

test('Whisper (Groq) answer → the same cleaning as Gemini', async () => {
  const { whisperToRaw, SPEECH_LIMITS: L } = await import('../../api/_lib/speechInput.ts');
  const body = { text: ' مرحبا بكم في الأخبار ', language: 'arabic', duration: 4.2, segments: [{ start: 0, end: 2, text: ' مرحبا بكم ' }, { start: 2, end: 4.2, text: 'في الأخبار' }] };
  const raw = whisperToRaw(body);
  assert.deepEqual(raw, { segments: [{ start: 0, end: 2, text: 'مرحبا بكم' }, { start: 2, end: 4.2, text: 'في الأخبار' }], speech: 'مرحبا بكم في الأخبار', language: 'arabic', on_screen: [] });
  const clean = cleanSpeech(raw, 4.2)!;
  assert.equal(clean.state, 'ok');
  assert.equal(clean.lang, 'ar');
  assert.equal(clean.segments.length, 2);
  assert.equal(whisperToRaw(null), null);
  assert.equal(whisperToRaw({ error: { message: 'x' } }), null);
  assert.equal(L.whisperBytes, 25 * 1024 * 1024);
});
