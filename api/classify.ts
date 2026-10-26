/// <reference types="node" />
// POST /api/classify — free LLM chain for the news classifier (Groq → Gemini → Cloudflare → Ollama → OpenRouter free).
// Only our Supabase functions may call it (header x-translate-secret = TRANSLATE_SECRET).
// Request: { system, user, decisions[], slugs[], ids[], only?[] }  →  { data, provider, model, tried } or { data: null, tried }
// The caller falls back to Claude Haiku when data is null.
import { freeJson, freeProvidersReady } from './_lib/freeJson.js';

const env = (k: string) => (process.env[k] ?? '').trim();
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });

function safeEqual(a: string, b: string) {
  if (!a || !b || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

export async function POST(req: Request) {
  if (!safeEqual(req.headers.get('x-translate-secret') ?? '', env('TRANSLATE_SECRET'))) return json({ error: 'unauthorized' }, 401);
  const b = await req.json().catch(() => null);
  if (b?.ready) return json({ providers: freeProvidersReady() });
  if (typeof b?.system !== 'string' || typeof b?.user !== 'string') return json({ error: 'bad request' }, 400);
  const decisions = new Set<string>((b.decisions ?? []).map(String));
  const slugs = new Set<string>((b.slugs ?? []).map(String));
  const ids = new Set<string>((b.ids ?? []).map(String));
  const r = await freeJson(String(b.system).slice(0, 40000), String(b.user).slice(0, 20000), (o) => {
    const d = String(o.decision ?? '');
    if (!decisions.has(d)) return false;
    if (d === 'event' && !slugs.has(String(o.category_slug ?? ''))) return false;
    if (d === 'duplicate' && !ids.has(String(o.duplicate_of ?? ''))) return false;
    return typeof o.reason === 'string' || o.reason === undefined;
  }, { only: Array.isArray(b.only) ? b.only.map(String) : undefined, timeoutMs: 12_000 });
  return json(r ?? { data: null });
}
