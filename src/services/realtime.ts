import { supabase } from '@/integrations/supabase/client';

/**
 * Listen to a one-row "pulse" table over Supabase Realtime. The server bumps
 * it whenever public data changes; the caller refetches through the normal
 * public views. Bursts (e.g. 30 events archived at once) are coalesced into
 * one call. Returns an unsubscribe function.
 */
export function subscribeToPulse(table: 'events_pulse' | 'hfc_pulse', onChange: () => void, debounceMs = 400): () => void {
  const client = supabase;
  if (!client) return () => {};
  let timer: number | undefined;
  const channel = client
    .channel(`pulse:${table}`)
    .on('postgres_changes', { event: '*', schema: 'public', table }, () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(onChange, debounceMs);
    })
    .subscribe();
  return () => {
    window.clearTimeout(timer);
    void client.removeChannel(channel);
  };
}
