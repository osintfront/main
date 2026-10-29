import { supabase } from '@/integrations/supabase/client';
import type { LatLng } from '@/lib/eventFilters';

/** Map-area social search ("intel" plan and staff; edge function social-search, migration 0074). */
export type SocialPlatform = 'x' | 'facebook' | 'instagram' | 'tiktok';
export interface SocialMedia { type: 'image' | 'video'; url: string | null; preview: string | null }
export interface SocialResult {
  platform: SocialPlatform;
  post_id: string;
  url: string | null;
  author: string | null;
  text: string | null;
  posted_at: string | null;
  media: SocialMedia[];
}
export interface SocialRun { status: 'running' | 'done' | 'error' | 'off'; error?: string }
export interface SocialSearch {
  id: string;
  places: string[];
  runs: Partial<Record<SocialPlatform, SocialRun>>;
  results: SocialResult[];
}

async function call(body: Record<string, unknown>): Promise<SocialSearch> {
  if (!supabase) throw new Error('offline');
  const { data, error } = await supabase.functions.invoke('social-search', { body });
  if (error) {
    let code = 'failed';
    try {
      const b = await (error as { context?: Response }).context?.clone().json();
      if (typeof b?.error === 'string') code = b.error;
    } catch {
      /* not JSON */
    }
    throw new Error(code);
  }
  return { id: data.search.id, places: data.search.places ?? [], runs: data.search.runs ?? {}, results: data.results ?? [] };
}

export const startSocialSearch = (polygon: LatLng[], hours: number, terms: string[] | null) =>
  call({ action: 'search', polygon, hours, terms: terms?.length ? terms : undefined });
export const pollSocialSearch = (id: string) => call({ action: 'poll', id });
