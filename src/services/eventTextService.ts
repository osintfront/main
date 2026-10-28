import { requireFeature } from '@/lib/plans';
import { supabase } from '@/integrations/supabase/client';
import type { PublicEvent } from '@/types/event';

/**
 * Extra text of one event, fetched only when a reader asks for it:
 *  - expand: the full report, religious meaning and other implications, written once per
 *    event by the event-agent and cached on the event (later readers get the cache);
 *  - source: the original report text as it arrived.
 */
export interface ExpandedText {
  details: string;
  religious: string;
  implications: string;
}
export type ExpandedByLang = { he: ExpandedText | null; en: ExpandedText | null };

const expandCache = new Map<string, ExpandedByLang>();
const sourceCache = new Map<string, string>();

/** Already expanded (cached on the event): no call needed. */
export function cachedExpansion(e: PublicEvent): ExpandedByLang | null {
  const pick = (l: 'he' | 'en'): ExpandedText | null => {
    const tr = e.translations[l];
    return tr?.details ? { details: tr.details, religious: tr.religious ?? '', implications: tr.implications ?? '' } : null;
  };
  const he = pick('he');
  return he ? { he, en: pick('en') } : expandCache.get(e.id) ?? null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function expandEvent(id: string): Promise<ExpandedByLang> {
  requireFeature('ai_expand_ask');
  const hit = expandCache.get(id);
  if (hit) return hit;
  if (!supabase) throw new Error('offline');
  // Another reader may be writing it right now (202): wait and ask again.
  for (let attempt = 0; attempt < 12; attempt++) {
    const { data, error } = await supabase.functions.invoke('event-agent', { body: { action: 'expand', id } });
    if (error) throw error;
    if (data?.he) {
      const out: ExpandedByLang = { he: data.he ?? null, en: data.en ?? null };
      expandCache.set(id, out);
      return out;
    }
    if (!data?.pending) break;
    await sleep(5000);
  }
  throw new Error('expand failed');
}

export async function fetchSourceText(id: string): Promise<string> {
  const hit = sourceCache.get(id);
  if (hit !== undefined) return hit;
  if (!supabase) return '';
  const { data, error } = await supabase.rpc('event_source_text', { p_id: id });
  if (error) throw error;
  const text = typeof data === 'string' ? data : '';
  sourceCache.set(id, text);
  return text;
}
