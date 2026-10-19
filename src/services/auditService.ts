import { supabase } from '@/integrations/supabase/client';

/**
 * Audit entries are written by database triggers (events, profiles,
 * invitations) so the client cannot skip or forge them. The only
 * client-initiated entry is the login stamp, done through a narrow RPC
 * that also records the server-side timestamp and request IP.
 */
export async function recordLogin(): Promise<void> {
  if (!supabase) return;
  const { error } = await supabase.rpc('record_login');
  if (error) console.warn('[audit] record_login failed:', error.message);
}
