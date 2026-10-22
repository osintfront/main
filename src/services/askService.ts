import { supabase } from '@/integrations/supabase/client';
import { fetchPublicEventsByIds } from './eventService';
import type { PublicEvent } from '@/types/event';

/** "Ask the map": the answer and the events behind it (in the order the answer cites them: [1] = events[0]). */
export interface AskAnswer {
  question: string;
  answer: string;
  /** Cited/relevant event ids, [n] in the answer = ids[n-1]. */
  ids: string[];
  events: PublicEvent[];
}

export class AskError extends Error {
  constructor(public code: 'rate_limited' | 'sign_in' | 'failed', message: string = code) {
    super(message);
  }
}

export async function askMap(question: string): Promise<AskAnswer> {
  if (!supabase) throw new AskError('failed', 'Not configured');
  const { data, error } = await supabase.functions.invoke('event-agent', { body: { action: 'ask', question } });
  if (error) {
    const status = (error as { context?: { status?: number } }).context?.status;
    if (status === 429) throw new AskError('rate_limited');
    if (status === 401) throw new AskError('sign_in');
    throw new AskError('failed', String(error.message ?? error));
  }
  if (!data?.ok) throw new AskError('failed', String(data?.error ?? 'failed'));
  const ids: string[] = Array.isArray(data.ids) ? data.ids : [];
  const events = await fetchPublicEventsByIds(ids);
  return { question, answer: String(data.answer ?? ''), ids, events };
}
