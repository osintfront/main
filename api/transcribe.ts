/// <reference types="node" />
// POST /api/transcribe — Gemini writes down a stored video's speech and the text seen on screen.
// Only our Supabase functions may call it (header x-translate-secret = TRANSLATE_SECRET), and only
// for a video inside our own public event-media bucket. Gemini runs on the existing GEMINI_API_KEY
// (AI Studio free tier); Claude does every translation afterwards (supabase/functions/_shared/media.ts).
// Request:  { url } | { ready: true }
// Answer:   200 { state: 'ok'|'none', lang, seconds, speech, on_screen, cut, model, usage }
//           200 { state: 'too_big'|'too_long'|'unavailable'|'unreadable', seconds? }
//           401 unauthorized · 400 bad url · 503 off (no key) · 502 busy (Gemini limit / error / time-out)
// The speech text is never logged.
import { SPEECH_LIMITS, SPEECH_PROMPT, allowedMediaUrl, cleanSpeech, geminiOutcome, mp4DurationSec, remainingMs } from './_lib/speechInput.js';

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
/** The whole route answers within 90 s, inside the edge job's 100 s wait (and Vercel's 120 s). */
const ROUTE_MS = 90_000;
class Busy extends Error {}

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

async function gemini(path: string, init: RequestInit, deadline: number): Promise<Response> {
  const ms = remainingMs(deadline, Date.now(), GEMINI_MS);
  if (ms < 1000) throw new Busy();
  let res: Response;
  try {
    res = await fetch(`${GEMINI}${path}`, { ...init, signal: AbortSignal.timeout(ms) });
  } catch {
    throw new Busy();
  }
  if (res.status === 429 || res.status >= 500) throw new Busy();
  return res;
}

/** Upload through the Files API (resumable), wait until ACTIVE. Returns the file's name and uri. */
async function uploadFile(key: string, bytes: Uint8Array, deadline: number): Promise<{ name: string; uri: string } | 'bad'> {
  const start = await gemini('/upload/v1beta/files', {
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
  if (!start.ok || !uploadUrl) throw new Busy();
  let up: Response;
  try {
    up = await fetch(uploadUrl, {
      method: 'POST',
      headers: { 'X-Goog-Upload-Offset': '0', 'X-Goog-Upload-Command': 'upload, finalize', 'content-length': String(bytes.length) },
      body: bytes,
      signal: AbortSignal.timeout(remainingMs(deadline, Date.now(), GEMINI_MS) || 1),
    });
  } catch {
    throw new Busy();
  }
  if (up.status === 429 || up.status >= 500) throw new Busy();
  const f = (await up.json().catch(() => null))?.file;
  if (!up.ok || !f?.name) throw new Busy();
  let file = f;
  const drop = () => fetch(`${GEMINI}/v1beta/${f.name}`, { method: 'DELETE', headers: { 'x-goog-api-key': key }, signal: AbortSignal.timeout(5000) }).catch(() => {});
  try {
    for (let i = 0; i < 20 && file?.state !== 'ACTIVE'; i++) {
      if (file?.state === 'FAILED') return await drop(), 'bad';
      if (Date.now() > deadline - 20_000) throw new Busy();
      await new Promise((r) => setTimeout(r, 2000));
      const g = await gemini(`/v1beta/${file.name}`, { headers: { 'x-goog-api-key': key } }, deadline);
      file = (await g.json().catch(() => null)) ?? file;
    }
    if (file?.state === 'FAILED') return await drop(), 'bad';
    if (file?.state !== 'ACTIVE' || !file?.uri) throw new Busy();
  } catch (e) {
    await drop(); // never leave an uploaded file behind
    throw e;
  }
  return { name: file.name, uri: file.uri };
}

export async function POST(req: Request) {
  if (!safeEqual(req.headers.get('x-translate-secret') ?? '', env('TRANSLATE_SECRET'))) return json({ error: 'unauthorized' }, 401);
  const b = await req.json().catch(() => null);
  const key = env('GEMINI_API_KEY');
  if (b?.ready) return json({ ready: !!key });
  if (!key) return json({ error: 'off' }, 503);
  const url = allowedMediaUrl(b?.url, env('SUPABASE_URL') || env('VITE_SUPABASE_URL'));
  if (!url) return json({ error: 'bad url' }, 400);

  const deadline = Date.now() + ROUTE_MS;
  const file = await download(url, deadline);
  if (file === 'too_big' || file === 'unavailable') return json({ state: file });
  const seconds = mp4DurationSec(file);
  if (seconds != null && seconds > SPEECH_LIMITS.maxSec) return json({ state: 'too_long', seconds });

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
    const res = await gemini(`/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
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
    if (outcome === 'busy') throw new Busy(); // a refused request (bad model / key) is never saved as "unreadable"
    if (outcome === 'unreadable') return json({ state: 'unreadable', seconds });
    const text = (out?.candidates?.[0]?.content?.parts ?? []).map((p: { text?: string }) => p?.text ?? '').join('');
    const clean = text ? cleanSpeech(text) : null;
    if (!clean) return json({ state: 'unreadable', seconds });
    const usage = { input: Number(out?.usageMetadata?.promptTokenCount ?? 0), output: Number(out?.usageMetadata?.candidatesTokenCount ?? 0) };
    return json({ ...clean, seconds, model, usage });
  } catch (e) {
    if (e instanceof Busy) return json({ error: 'busy' }, 502);
    return json({ error: 'busy' }, 502);
  } finally {
    if (uploaded) {
      await fetch(`${GEMINI}/v1beta/${uploaded.name}`, { method: 'DELETE', headers: { 'x-goog-api-key': key } }).catch(() => {});
    }
  }
}
