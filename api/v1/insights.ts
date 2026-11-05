/// <reference types="node" />
// GET /api/v1/insights — the paid data API: published OFI estimates (latest forecast per insight).
// Key: header "x-api-key" or "Authorization: Bearer ofk_…". Same keys, switch and limits as /api/v1/events;
// all checks run in the database: public.api_insights().
import { env, json } from '../_lib/member.js';

const SUPABASE_URL = () => env('SUPABASE_URL') || env('VITE_SUPABASE_URL');
const ANON_KEY = () => env('SUPABASE_ANON_KEY') || env('VITE_SUPABASE_ANON_KEY');

export async function GET(req: Request): Promise<Response> {
  const key = (req.headers.get('x-api-key') ?? req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '').trim();
  if (!key) return json({ error: 'missing_key' }, 401);
  try {
    const res = await fetch(`${SUPABASE_URL()}/rest/v1/rpc/api_insights`, {
      method: 'POST',
      headers: { apikey: ANON_KEY(), authorization: `Bearer ${ANON_KEY()}`, 'content-type': 'application/json' },
      body: JSON.stringify({ p_key: key }),
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
