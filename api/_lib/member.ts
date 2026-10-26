/// <reference types="node" />
// Who may call the map's data routes: a signed-in, active member of the site
// (Authorization: Bearer <Supabase session token>, checked with the is_member() RPC).
import { createHmac } from 'node:crypto';

export const env = (k: string) => (process.env[k] ?? '').trim();
const SUPABASE_URL = () => env('SUPABASE_URL') || env('VITE_SUPABASE_URL');
const ANON_KEY = () => env('SUPABASE_ANON_KEY') || env('VITE_SUPABASE_ANON_KEY');

export const json = (body: unknown, status = 200, cache = 'no-store') =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': cache } });

const seen = new Map<string, number>();

export async function isMember(req: Request): Promise<boolean> {
  const token = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!token || !SUPABASE_URL() || !ANON_KEY()) return false;
  // The same session asks every few seconds (aircraft refresh): remember a yes for 5 minutes.
  const until = seen.get(token);
  if (until && until > Date.now()) return true;
  try {
    const res = await fetch(`${SUPABASE_URL()}/rest/v1/rpc/is_member`, {
      method: 'POST',
      headers: { apikey: ANON_KEY(), authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: '{}',
    });
    const ok = res.ok && (await res.json()) === true;
    if (ok) {
      if (seen.size > 2000) seen.clear();
      seen.set(token, Date.now() + 5 * 60_000);
    }
    return ok;
  } catch {
    return false;
  }
}

/**
 * Picture tiles are loaded by <img> tags, which cannot send the session token. A member gets
 * a key for the current week instead (signed with a server secret); a tile request must carry it.
 */
function secret(): string {
  return env('TILE_KEY_SECRET') || env('TRANSLATE_SECRET') || env('SUPABASE_SERVICE_ROLE_KEY');
}
function week(offset = 0): number {
  return Math.floor(Date.now() / (7 * 86400_000)) + offset;
}
const sign = (w: number) => createHmac('sha256', secret()).update(`tiles:${w}`).digest('base64url').slice(0, 22);

export function tileKey(): string {
  return sign(week());
}
export function tileKeyOk(k: string | null): boolean {
  if (!k || !secret()) return false;
  return k === sign(week()) || k === sign(week(-1));
}
