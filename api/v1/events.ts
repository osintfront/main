/// <reference types="node" />
// GET /api/v1/events — the paid data API (events only). Key: header "x-api-key" or "Authorization: Bearer ofk_…".
// Query: since, until (ISO dates), category (slug), country, limit (1–500, default 100).
// All checks (switch, key, per-minute and daily limits) run in the database: public.api_events().
import { env, json } from '../_lib/member.js';

const SUPABASE_URL = () => env('SUPABASE_URL') || env('VITE_SUPABASE_URL');
const ANON_KEY = () => env('SUPABASE_ANON_KEY') || env('VITE_SUPABASE_ANON_KEY');

const iso = (v: string | null) => (v && !Number.isNaN(Date.parse(v)) ? new Date(v).toISOString() : null);

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const key = (req.headers.get('x-api-key') ?? req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '').trim();
  if (!key) return json({ error: 'missing_key' }, 401);
  const limit = Number(url.searchParams.get('limit') ?? 100);
  const body = {
    p_key: key,
    p_since: iso(url.searchParams.get('since')),
    p_until: iso(url.searchParams.get('until')),
    p_category: url.searchParams.get('category')?.slice(0, 60) || null,
    p_country: url.searchParams.get('country')?.slice(0, 60) || null,
    p_limit: Number.isFinite(limit) ? Math.trunc(limit) : 100,
  };
  try {
    const res = await fetch(`${SUPABASE_URL()}/rest/v1/rpc/api_events`, {
      method: 'POST',
      headers: { apikey: ANON_KEY(), authorization: `Bearer ${ANON_KEY()}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) return json({ error: 'unavailable' }, 502);
    const out = (await res.json()) as { error?: string; status?: number; retry_after?: number };
    if (out?.error) {
      const r = json({ error: out.error }, out.status ?? 400);
      if (out.retry_after) r.headers.set('retry-after', String(out.retry_after));
      return r;
    }
    return json(out);
  } catch {
    return json({ error: 'unavailable' }, 502);
  }
}
