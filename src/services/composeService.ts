import { supabase } from '@/integrations/supabase/client';
import type { PlaceInput } from '@/types/event';

/** What the editor agent made of a free-text report (nothing is saved). */
export interface ComposeResult {
  title: string;
  description: string;
  categoryId: string | null;
  categorySlug: string | null;
  severity: 'low' | 'medium' | 'high' | 'critical';
  isBreaking: boolean;
  country: string;
  region: string;
  city: string;
  locationName: string;
  latitude: number | null;
  longitude: number | null;
  precision: 'exact' | 'region' | null;
  /** Every place of the report (main first), each with what happened there. */
  locations: PlaceInput[];
}

/** Quick compose: one text in any language → the report form's fields. */
export async function composeEvent(text: string, sentAt?: string): Promise<ComposeResult> {
  if (!supabase) throw new Error('Not configured');
  const { data, error } = await supabase.functions.invoke('event-agent', { body: { action: 'compose', text, sent_at: sentAt } });
  if (error) throw new Error(String(error.message ?? error));
  if (!data?.ok) throw new Error(String(data?.error ?? 'compose failed'));
  return data as ComposeResult;
}
