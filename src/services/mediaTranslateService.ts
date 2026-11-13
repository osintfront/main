import { supabase } from '@/integrations/supabase/client';
import { mapTranslation, type MediaTranslation } from '@/lib/mediaReading';

/**
 * Media translation: the saved reading of an event's media (media_translation, a read with no AI) and
 * a run through event-agent (start, then polls that can never start a second run). Errors are thrown
 * as MediaTranslateError with the server's code.
 */
export type MediaCode = 'signup_required' | 'not_in_plan' | 'quota_exceeded' | 'budget' | 'busy' | 'failed' | 'no_media' | 'forbidden';
const CODES: readonly string[] = ['signup_required', 'not_in_plan', 'quota_exceeded', 'budget', 'busy', 'failed', 'no_media', 'forbidden'];

export class MediaTranslateError extends Error {
  constructor(public code: MediaCode) {
    super(code);
  }
}

const POLL_MS = 4000;
const POLLS = 50;
const cache = new Map<string, MediaTranslation | null>();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function client() {
  if (!supabase) throw new MediaTranslateError('failed');
  return supabase;
}

async function errorCode(error: unknown): Promise<MediaCode> {
  const ctx = (error as { context?: Response }).context;
  if (ctx?.status === 401) return 'signup_required';
  if (ctx?.status === 403) return 'forbidden';
  if (ctx?.status === 404) return 'no_media';
  if (ctx?.status === 409 || ctx?.status === 429) {
    try {
      const body = await ctx.clone().json();
      if (body?.error === 'quota' || body?.error === 'quota_exceeded') return 'quota_exceeded';
      if (body?.error === 'upgrade') return 'not_in_plan';
      if (typeof body?.error === 'string' && CODES.includes(body.error)) return body.error as MediaCode;
    } catch {
      /* not JSON */
    }
  }
  return 'failed';
}

/** The saved reading for this event (cached per event for the session); null when not allowed or on error. */
export async function fetchMediaTranslation(eventId: string, force = false): Promise<MediaTranslation | null> {
  if (!force && cache.has(eventId)) return cache.get(eventId)!;
  try {
    const { data, error } = await client().rpc('media_translation', { p_event: eventId });
    if (error) return null;
    const m = mapTranslation(data);
    cache.set(eventId, m);
    return m;
  } catch {
    return null;
  }
}

/** Start a reading (or join one in progress) and wait for it. `ran` = the server worked on it. */
export async function runMediaTranslation(
  eventId: string,
  o: { redo?: boolean } = {},
  onPending?: () => void,
): Promise<{ data: MediaTranslation | null; ran: boolean }> {
  let ran = false;
  let poll = false;
  for (let i = 0; i <= POLLS; i++) {
    const { data, error } = await client().functions.invoke('event-agent', {
      body: { action: 'media_translate', event_id: eventId, ...(o.redo && !poll ? { redo: true } : {}), ...(poll ? { poll: true } : {}) },
    });
    if (error) throw new MediaTranslateError(await errorCode(error));
    const d = (data ?? {}) as Record<string, unknown>;
    if (d.pending === true) {
      ran = true;
      if (i === 0) onPending?.();
      poll = true;
      await sleep(POLL_MS);
      continue;
    }
    return { data: await fetchMediaTranslation(eventId, true), ran };
  }
  throw new MediaTranslateError('failed');
}
