import { supabase } from '@/integrations/supabase/client';

export interface SearchQuota {
  ok: boolean;
  unlimited?: boolean;
  remaining?: number | null;
  limit?: number;
}

/** One search from the search bar: 3 a day per user (super admins unlimited); same text again is free. */
export async function consumeSearchQuota(query: string): Promise<SearchQuota> {
  if (!supabase) return { ok: true, unlimited: true };
  const { data, error } = await supabase.rpc('use_search_quota', { p_query: query });
  if (error) throw error;
  return (data ?? { ok: true }) as SearchQuota;
}
