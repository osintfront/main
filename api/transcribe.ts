/// <reference types="node" />
// POST /api/transcribe — writes down a stored video's speech (with timed lines) and the text seen on screen.
// Only our Supabase functions may call it (header x-translate-secret = TRANSLATE_SECRET), and only
// for a video inside our own public event-media bucket.
// Order (owner's decision): 1. Whisper on Groq (GROQ_API_KEY; files up to 25 MB; speech only, no on-screen
// text); 2. Gemini as the fallback (GEMINI_SPEECH_KEY, its own billed project, else GEMINI_API_KEY; also reads
// on-screen text). Claude does every translation afterwards (supabase/functions/_shared/media.ts).
// Request:  { url, budget_ms? } | { ready: true }
// Answer:   200 { state: 'ok'|'none', lang, seconds, speech, segments, on_screen, cut, model, provider, usage }
//           200 { state: 'too_big'|'too_long'|'unavailable'|'unreadable', seconds? }
//           401 unauthorized · 400 bad url · 503 off (no key) · 502 { error: 'busy', detail } (both services failed; detail = why)
// The speech text is never logged.
import {
  SPEECH_LIMITS, SPEECH_PROMPT, allowedMediaUrl, busyDetail, cleanSpeech, geminiOutcome, mp4DurationSec, remainingMs, routeDeadlineMs, whisperToRaw,
  type BusyStep,
} from './_lib/speechInput.js';

const env = (k: string) => (process.env[k] ?? '').trim();
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });

function safeEqual(a: string, b: string) {
  if (!a || !b || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

const GEMINI = 'https://generativelanguage.googleapis.com';
const GEMINI_MS = 90_000;
/** Gemini could not answer now: `detail` = the step and the upstream status (never speech text). */
class Busy extends Error {
  constructor(public detail: string) {
    super(detail);
  }
}
const busy = (step: BusyStep, status: number | null = null, body: unknown = null) => new Busy(busyDetail(step, status, body));

/** The file, read with a hard cap. 'too_big' past 50 MB; 'unavailable' when it cannot be fetched. */
async function download(url: string, deadline: number): Promise<Uint8Array | 'too_big' | 'unavailable'> {
  let res: Response;
  try {
    res = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(remainingMs(deadline, Date.now(), 30_000) || 1) });
  } catch {
    return 'unavailable';
  }
  if (!res.ok || !res.body) return 'unavailable';
  const declared = Number(res.headers.get('content-length') ?? '');
  if (Number.isFinite(declared) && declared > SPEECH_LIMITS.maxBytes) {
    await res.body.cancel().catch(() => {});
    return 'too_big';
  }
  const reader = res.body.getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > SPEECH_LIMITS.maxBytes) {
        await reader.cancel().catch(() => {});
        return 'too_big';
      }
      parts.push(value);
    }
  } catch {
    return 'unavailable';
  }
  if (!total) return 'unavailable';
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

const SAFETY = ['HARM_CATEGORY_HARASSMENT', 'HARM_CATEGORY_HATE_SPEECH', 'HARM_CATEGORY_SEXUALLY_EXPLICIT', 'HARM_CATEGORY_DANGEROUS_CONTENT'].map(
  (category) => ({ category, threshold: 'BLOCK_NONE' }),
);

async function gemini(step: BusyStep, path: string, init: RequestInit, deadline: number): Promise<Response> {
  const ms = remainingMs(deadline, Date.now(), GEMINI_MS);
  if (ms < 1000) throw busy('deadline');
  let res: Response;
  try {
    res = await fetch(`${GEMINI}${path}`, { ...init, signal: AbortSignal.timeout(ms) });
  } catch {
    throw busy(step);
  }
  if (res.status === 429 || res.status >= 500) throw busy(step, res.status, await res.clone().json().catch(() => null));
  return res;
}

const WHISPER = 'https://api.groq.com/openai/v1/audio/transcriptions';
const WHISPER_MODEL = 'whisper-large-v3';

/** Whisper on Groq writes the speech down with timed lines; null = no answer (Gemini is tried next). */
async function whisper(key: string, bytes: Uint8Array, deadline: number): Promise<{ raw: NonNullable<ReturnType<typeof whisperToRaw>>; note: null } | { raw: null; note: string }> {
  const ms = remainingMs(deadline, Date.now(), 60_000);
  if (ms < 5000) return { raw: null, note: 'whisper skipped: no time' };
  const form = new FormData();
  form.append('file', new Blob([bytes], { type: 'video/mp4' }), 'video.mp4');
  form.append('model', WHISPER_MODEL);
  form.append('response_format', 'verbose_json');
  form.append('timestamp_granularities[]', 'segment');
  form.append('temperature', '0');
  try {
    const res = await fetch(WHISPER, { method: 'POST', headers: { authorization: `Bearer ${key}` }, body: form, signal: AbortSignal.timeout(ms) });
    const body = await res.json().catch(() => null);
    const raw = res.ok ? whisperToRaw(body) : null;
    return raw ? { raw, note: null } : { raw: null, note: `whisper ${res.status} ${String((body as { error?: { message?: string } })?.error?.message ?? '').slice(0, 80)}`.trim() };
  } catch (e) {
    return { raw: null, note: `whisper ${(e as Error)?.name === 'TimeoutError' ? 'timeout' : 'network error'}` };
  }
}

/** Upload through the Files API (resumable), wait until ACTIVE. Returns the file's name and uri. */
async function uploadFile(key: string, bytes: Uint8Array, deadline: number): Promise<{ name: string; uri: string } | 'bad'> {
  const start = await gemini('upload_start', '/upload/v1beta/files', {
    method: 'POST',
    headers: {
      'x-goog-api-key': key,
      'X-Goog-Upload-Protocol': 'resumable',
      'X-Goog-Upload-Command': 'start',
      'X-Goog-Upload-Header-Content-Length': String(bytes.length),
      'X-Goog-Upload-Header-Content-Type': 'video/mp4',
      'content-type': 'application/json',
    },
    body: JSON.stringify({ file: { display_name: 'event-video' } }),
  }, deadline);
  const uploadUrl = start.headers.get('x-goog-upload-url');
  if (!start.ok || !uploadUrl) throw busy('upload_start', start.status, await start.json().catch(() => null));
  let up: Response;
  try {
    up = await fetch(uploadUrl, {
      method: 'POST',
      headers: { 'X-Goog-Upload-Offset': '0', 'X-Goog-Upload-Command': 'upload, finalize', 'content-length': String(bytes.length) },
      body: bytes,
      signal: AbortSignal.timeout(remainingMs(deadline, Date.now(), GEMINI_MS) || 1),
    });
  } catch {
    throw busy('upload');
  }
  const upBody = await up.json().catch(() => null);
  const f = upBody?.file;
  if (!up.ok || !f?.name) throw busy('upload', up.status, upBody);
  let file = f;
  const drop = () => fetch(`${GEMINI}/v1beta/${f.name}`, { method: 'DELETE', headers: { 'x-goog-api-key': key }, signal: AbortSignal.timeout(5000) }).catch(() => {});
  try {
    for (let i = 0; i < 20 && file?.state !== 'ACTIVE'; i++) {
      if (file?.state === 'FAILED') return await drop(), 'bad';
      if (Date.now() > deadline - 20_000) throw busy('file_wait');
      await new Promise((r) => setTimeout(r, 2000));
      const g = await gemini('file_wait', `/v1beta/${file.name}`, { headers: { 'x-goog-api-key': key } }, deadline);
      file = (await g.json().catch(() => null)) ?? file;
    }
    if (file?.state === 'FAILED') return await drop(), 'bad';
    if (file?.state !== 'ACTIVE' || !file?.uri) throw busy('file_wait');
  } catch (e) {
    await drop(); // never leave an uploaded file behind
    throw e;
  }
  return { name: file.name, uri: file.uri };
}

export async function POST(req: Request) {
  if (!safeEqual(req.headers.get('x-translate-secret') ?? '', env('TRANSLATE_SECRET'))) return json({ error: 'unauthorized' }, 401);
  const b = await req.json().catch(() => null);
  // Speech has its own key (billing on, its own quota); the site's shared free key is the fallback.
  const key = env('GEMINI_SPEECH_KEY') || env('GEMINI_API_KEY');
  const groq = env('GROQ_API_KEY');
  if (b?.ready) return json({ ready: !!(key || groq) });
  if (!key && !groq) return json({ error: 'off' }, 503);
  const url = allowedMediaUrl(b?.url, env('SUPABASE_URL') || env('VITE_SUPABASE_URL'));
  if (!url) return json({ error: 'bad url' }, 400);

  const t0 = Date.now();
  const deadline = t0 + routeDeadlineMs(b?.budget_ms);
  const file = await download(url, deadline);
  if (file === 'too_big' || file === 'unavailable') return json({ state: file });
  const seconds = mp4DurationSec(file);
  if (seconds != null && seconds > SPEECH_LIMITS.maxSec) return json({ state: 'too_long', seconds });

  // 1. Whisper (Groq) first — speech with timed lines; no on-screen text.
  let whisperNote: string | null = null;
  if (groq && file.length <= SPEECH_LIMITS.whisperBytes) {
    const w = await whisper(groq, file, deadline);
    const clean = w.raw ? cleanSpeech(w.raw, seconds) : null;
    if (clean) {
      console.log('transcribe', clean.state, file.length, seconds, Date.now() - t0, 'whisper');
      return json({ ...clean, seconds, model: WHISPER_MODEL, provider: 'groq', usage: { input: 0, output: 0 } });
    }
    whisperNote = w.note ?? 'whisper unreadable';
    console.warn('transcribe whisper', whisperNote, file.length);
  }
  // 2. Gemini — the fallback (and the only path for files over Whisper's 25 MB).
  if (!key) return json({ error: 'busy', detail: whisperNote ?? 'no speech service' }, 502);
  const model = env('GEMINI_MODEL') || 'gemini-3.5-flash-lite';
  let uploaded: { name: string; uri: string } | null = null;
  try {
    let part: Record<string, unknown>;
    if (file.length <= SPEECH_LIMITS.inlineBytes) {
      part = { inline_data: { mime_type: 'video/mp4', data: Buffer.from(file).toString('base64') } };
    } else {
      const u = await uploadFile(key, file, deadline);
      if (u === 'bad') return json({ state: 'unreadable', seconds });
      uploaded = u;
      part = { file_data: { mime_type: 'video/mp4', file_uri: u.uri } };
    }
    const res = await gemini('generate', `/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: { 'x-goog-api-key': key, 'content-type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SPEECH_PROMPT }] },
        contents: [{ role: 'user', parts: [part, { text: 'Transcribe this video as instructed.' }] }],
        generationConfig: { temperature: 0, responseMimeType: 'application/json', mediaResolution: 'MEDIA_RESOLUTION_LOW' },
        safetySettings: SAFETY,
      }),
    }, deadline);
    const out = await res.json().catch(() => null);
    const outcome = geminiOutcome(res.status, out);
    if (outcome === 'busy') throw busy('generate', res.status, out); // a refused request (bad model / key) is never saved as "unreadable"
    if (outcome === 'unreadable') return json({ state: 'unreadable', seconds });
    const text = (out?.candidates?.[0]?.content?.parts ?? []).map((p: { text?: string }) => p?.text ?? '').join('');
    const clean = text ? cleanSpeech(text, seconds) : null;
    if (!clean) return json({ state: 'unreadable', seconds });
    const usage = { input: Number(out?.usageMetadata?.promptTokenCount ?? 0), output: Number(out?.usageMetadata?.candidatesTokenCount ?? 0) };
    console.log('transcribe', clean.state, file.length, seconds, Date.now() - t0, 'gemini');
    return json({ ...clean, seconds, model, provider: 'gemini', usage });
  } catch (e) {
    const own = e instanceof Busy ? e.detail : 'internal ' + String((e as Error)?.name ?? 'error').slice(0, 40);
    const detail = (whisperNote ? `${whisperNote}; gemini ${own}` : own).slice(0, 160);
    console.warn('transcribe busy', detail, file.length);
    return json({ error: 'busy', detail }, 502);
  } finally {
    if (uploaded) {
      await fetch(`${GEMINI}/v1beta/${uploaded.name}`, { method: 'DELETE', headers: { 'x-goog-api-key': key }, signal: AbortSignal.timeout(3000) }).catch(() => {});
    }
  }
}
