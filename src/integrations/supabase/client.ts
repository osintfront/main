import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = (import.meta.env.VITE_SUPABASE_URL ?? '').toString().trim();
const anonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY ?? '').toString().trim();

function looksLikeServiceRoleKey(key: string): boolean {
  // Supabase JWT keys carry their role in the payload. Refuse to run with a
  // service-role key in the browser — it bypasses every RLS policy.
  try {
    const payload = JSON.parse(atob(key.split('.')[1] ?? ''));
    return payload?.role === 'service_role';
  } catch {
    return key.startsWith('sb_secret_');
  }
}

export const supabaseConfigError: string | null = !url || !anonKey
  ? 'missing'
  : looksLikeServiceRoleKey(anonKey)
    ? 'service_role'
    : null;

export const isSupabaseConfigured = supabaseConfigError === null;

/**
 * The browser client. `null` when the project is not configured, in which case
 * the public map runs on bundled demo data and admin routes show a setup notice.
 */
export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(url, anonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        storageKey: 'ofm.auth',
      },
    })
  : null;

export const supabaseHost = (() => {
  try {
    return url ? new URL(url).host : '';
  } catch {
    return '';
  }
})();
