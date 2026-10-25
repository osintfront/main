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
  /** A link in the text was read: the page's source, date, pictures and text. */
  link?: { url: string; sourceName: string; occurredAt: string | null; media: ComposeMedia[]; text: string };
}

export interface ComposeMedia {
  url: string;
  kind: 'image' | 'video_thumb';
}

/** Save the composed link's pictures to a saved event. */
export async function attachComposeMedia(eventId: string, media: ComposeMedia[], postUrl: string | null): Promise<number> {
  if (!supabase || !media.length) return 0;
  const { data, error } = await supabase.functions.invoke('event-agent', { body: { action: 'attach_media', event_id: eventId, media, post_url: postUrl } });
  if (error || !data?.ok) return 0;
  return Number(data.saved ?? 0);
}

/** Quick compose: one text in any language → the report form's fields. */
export async function composeEvent(text: string, sentAt?: string): Promise<ComposeResult> {
  if (!supabase) throw new Error('Not configured');
  const { data, error } = await supabase.functions.invoke('event-agent', { body: { action: 'compose', text, sent_at: sentAt } });
  if (error) throw new Error(String(error.message ?? error));
  if (!data?.ok) throw new Error(String(data?.error ?? 'compose failed'));
  return data as ComposeResult;
}
