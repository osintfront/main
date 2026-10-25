/// <reference types="node" />
// POST /api/translate — server-side translation with automatic fallback and a Supabase cache.
//
// Request:  { "text": "…" } or { "texts": ["…", "…"] }, "target": "he" | "en", optional "source"
// Response: { "translations": [{ "text", "provider", "cached", "translated" }], "provider" }
// Who may call it: a signed-in member of the site (Authorization: Bearer <Supabase session token>)
// or our own Supabase functions (header x-translate-secret = TRANSLATE_SECRET).
// Never fails because of the providers: if every one of them fails, the original text comes back.
import { createHash } from 'node:crypto';
import { activeProviders, testProviders, translateWithFallback, type ChainResult, type Lang } from './_lib/translateChain.js';

const env = (k: string) => (process.env[k] ?? '').trim();
const SUPABASE_URL = () => env('SUPABASE_URL') || env('VITE_SUPABASE_URL');
const SERVICE_KEY = () => env('SUPABASE_SERVICE_ROLE_KEY');
const ANON_KEY = () => env('SUPABASE_ANON_KEY') || env('VITE_SUPABASE_ANON_KEY');

const MAX_TEXTS = 20;
const MAX_CHARS = 5000;
const TARGETS = new Set(['he', 'en']);
const SOURCES = new Set(['auto', 'he', 'en', 'ar', 'fa']);

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });

function safeEqual(a: string, b: string) {
  if (!a || !b || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

/** Our own server functions, or a signed-in, active member. */
async function authorized(req: Request): Promise<boolean> {
  const secret = env('TRANSLATE_SECRET');
  if (secret && safeEqual(req.headers.get('x-translate-secret') ?? '', secret)) return true;
  const token = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!token || !SUPABASE_URL() || !ANON_KEY()) return false;
  try {
    const res = await fetch(`${SUPABASE_URL()}/rest/v1/rpc/is_member`, {
      method: 'POST',
      headers: { apikey: ANON_KEY(), authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: '{}',
    });
    return res.ok && (await res.json()) === true;
  } catch {
    return false;
  }
}

/** Arabic script → Arabic, Hebrew letters → Hebrew, otherwise English (no translation when it is already the target). */
function detect(text: string): Lang {
  const ar = (text.match(/[؀-ۿ]/g) ?? []).length;
  const he = (text.match(/[֐-׿]/g) ?? []).length;
  const la = (text.match(/[A-Za-z]/g) ?? []).length;
  if (ar >= he && ar >= la && ar > 0) return /[پچژگک]/.test(text) ? 'fa' : 'ar';
  if (he >= la && he > 0) return 'he';
  return 'en';
}

const hashOf = (text: string, target: string) => createHash('sha256').update(`${target}\u0000${text}`).digest('hex');

// ── Supabase cache (service role, server only) ────────────────────────────
/** Which role the key carries: a legacy JWT says it inside; new keys say it in their prefix. */
function keyRole(key: string): string {
  if (key.startsWith('sb_secret_')) return 'service_role';
  if (key.startsWith('sb_publishable_')) return 'anon';
  try {
    return String(JSON.parse(Buffer.from(key.split('.')[1] ?? '', 'base64url').toString('utf8'))?.role ?? '?');
  } catch {
    return '?';
  }
}

async function db(path: string, init: RequestInit = {}) {
  if (!SUPABASE_URL() || !SERVICE_KEY()) return null;
  const key = SERVICE_KEY();
  const role = keyRole(key);
  if (role !== 'service_role') {
    console.warn(`[translate] SUPABASE_SERVICE_ROLE_KEY is not the service-role (secret) key (it is "${role}") — the cache cannot be used`);
    return null;
  }
  try {
    const res = await fetch(`${SUPABASE_URL()}/rest/v1/${path}`, {
      ...init,
      // New secret keys (sb_secret_…) go in apikey only; legacy JWT keys also as the bearer.
      headers: { apikey: key, ...(key.startsWith('eyJ') ? { authorization: `Bearer ${key}` } : {}), 'content-type': 'application/json', ...(init.headers ?? {}) },
    });
    if (!res.ok) {
      console.warn(`[translate] cache ${init.method ?? 'GET'} failed: HTTP ${res.status} ${(await res.text()).slice(0, 160)}`);
      return null;
    }
    return res.status === 204 ? true : await res.json().catch(() => true);
  } catch (e) {
    console.warn('[translate] cache unreachable', String(e).slice(0, 160));
    return null;
  }
}

async function cacheGet(hashes: string[]): Promise<Map<string, { translated_text: string; provider: string }>> {
  if (!hashes.length) return new Map();
  const rows = await db(`translation_cache?select=hash,translated_text,provider&hash=in.(${hashes.join(',')})`);
  return new Map((Array.isArray(rows) ? rows : []).map((r: any) => [r.hash, r]));
}

async function cacheSave(hash: string, text: string, source: Lang, target: string, r: ChainResult) {
  await db('translation_cache?on_conflict=hash', {
    method: 'POST',
    headers: { prefer: 'resolution=ignore-duplicates,return=minimal' },
    body: JSON.stringify({ hash, source_text: text, source_lang: source, target_lang: target, translated_text: r.text, provider: r.provider, model: r.model, paid: r.paid }),
  });
}

async function logRow(row: Record<string, unknown>) {
  await db('translation_log', { method: 'POST', headers: { prefer: 'return=minimal' }, body: JSON.stringify(row) });
}

/** Claude is paid: its cost also goes to the AI usage page (ai_usage). */
async function logClaudeCost(r: ChainResult) {
  if (!r.paid || !r.usage) return;
  const cost = (r.usage.input * 0.1 + r.usage.output * 0.5) / 1_000_000; // Haiku 5.5, prompts ≤ 100K tokens
  await db('ai_usage', {
    method: 'POST',
    headers: { prefer: 'return=minimal' },
    body: JSON.stringify({ fn: 'vercel-translate', purpose: 'translate', model: r.model, input_tokens: r.usage.input, output_tokens: r.usage.output, cost_usd: cost }),
  });
}

export async function POST(req: Request): Promise<Response> {
  if (!(await authorized(req))) return json({ error: 'unauthorized' }, 401);
  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'invalid JSON' }, 400);
  }
  const texts: string[] = (Array.isArray(body?.texts) ? body.texts : [body?.text]).map((t: unknown) => String(t ?? '').slice(0, MAX_CHARS));
  const target = String(body?.target ?? 'he');
  const sourceIn = String(body?.source ?? 'auto');
  if (!texts.length || texts.length > MAX_TEXTS) return json({ error: `1–${MAX_TEXTS} texts` }, 400);
  if (!TARGETS.has(target)) return json({ error: 'target must be he or en' }, 400);
  if (!SOURCES.has(sourceIn)) return json({ error: 'unknown source language' }, 400);

  const deadline = Date.now() + 55_000;
  const lines: string[] = [];
  const log = (l: string) => {
    lines.push(l);
    (l.includes('PAID') ? console.warn : console.log)(l);
  };

  const hashes = texts.map((t) => hashOf(t.trim(), target));
  const cached = await cacheGet([...new Set(hashes.filter((_, i) => texts[i].trim()))]);
  const out: { text: string; provider: string; cached: boolean; translated: boolean }[] = [];

  for (const [i, raw] of texts.entries()) {
    const text = raw.trim();
    if (!text) {
      out.push({ text: raw, provider: 'none', cached: false, translated: false });
      continue;
    }
    const hit = cached.get(hashes[i]);
    if (hit) {
      log(`[translate] cache hit (${hit.provider})`);
      out.push({ text: hit.translated_text, provider: hit.provider, cached: true, translated: true });
      continue;
    }
    const source = sourceIn === 'auto' ? detect(text) : (sourceIn as Lang);
    // Already in the target language: nothing to translate.
    if (source === target) {
      out.push({ text: raw, provider: 'none', cached: false, translated: false });
      continue;
    }
    const started = Date.now();
    const r = await translateWithFallback(text, target as Lang, source, log, deadline);
    if (!r) {
      log('[translate] all providers failed — returning the original text');
      out.push({ text: raw, provider: 'none', cached: false, translated: false });
      await logRow({ provider: 'none', target_lang: target, chars: text.length, paid: false, ok: false, duration_ms: Date.now() - started, detail: lines.slice(-7).join(' | ').slice(0, 1000) });
      continue;
    }
    cached.set(hashes[i], { translated_text: r.text, provider: r.provider });
    out.push({ text: r.text, provider: r.provider, cached: false, translated: true });
    await Promise.all([
      cacheSave(hashes[i], text, source, target, r),
      logRow({ provider: r.provider, model: r.model, target_lang: target, chars: text.length, paid: r.paid, ok: true, duration_ms: Date.now() - started }),
      logClaudeCost(r),
    ]);
  }
  return json({ translations: out, provider: out.find((x) => !x.cached && x.translated)?.provider ?? (out.some((x) => x.cached) ? 'cache' : 'none') });
}

/** GET /api/translate — which providers are configured (names only, never keys). Members only. */
export async function GET(req: Request): Promise<Response> {
  if (!(await authorized(req))) return json({ error: 'unauthorized' }, 401);
  // ?test=1 — run every free provider separately on a sample (Arabic → Hebrew).
  if (new URL(req.url).searchParams.get('test') === '1') {
    const sample = 'قصف مدفعي إسرائيلي استهدف أطراف بلدة الخيام جنوب لبنان صباح اليوم';
    return json({ sample, results: await testProviders(sample, 'he', 'ar'), cache: !!(SUPABASE_URL() && SERVICE_KEY()), cacheKeyRole: keyRole(SERVICE_KEY()) });
  }
  return json({ providers: activeProviders(), cache: !!(SUPABASE_URL() && SERVICE_KEY()), cacheKeyRole: keyRole(SERVICE_KEY()) });
}
