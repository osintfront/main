import { supabase } from '@/integrations/supabase/client';
import { mapEntry, sanitizeTerms, type DeepEntry, type EventTerm } from '@/lib/deepTerms';

/**
 * Deep analysis: the event's term links (event_terms_for), an entry (deep_entry), the caller's day
 * (deep_my_quota), and the writes through event-agent (start / poll a new entry, refresh, hand
 * edit, remove). Errors are thrown as DeepError with the server's code.
 */
export type DeepCode = 'signup_required' | 'not_in_plan' | 'quota_exceeded' | 'budget' | 'busy' | 'no_entry' | 'failed' | 'alias_taken' | 'forbidden';
const CODES: readonly string[] = ['signup_required', 'not_in_plan', 'quota_exceeded', 'budget', 'busy', 'no_entry', 'failed', 'alias_taken', 'forbidden'];

export class DeepError extends Error {
  constructor(public code: DeepCode) {
    super(code);
  }
}

export interface DeepQuota { enabled: boolean; staff: boolean; used: number; limit: number | null; budgetLeft: boolean }

const POLL_MS = 5000;
const POLLS = 48;
const termsCache = new Map<string, EventTerm[]>();
const entryCache = new Map<string, DeepEntry | null>();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function client() {
  if (!supabase) throw new DeepError('failed');
  return supabase;
}

async function errorCode(error: unknown): Promise<DeepCode> {
  const ctx = (error as { context?: Response }).context;
  if (ctx?.status === 401) return 'signup_required';
  if (ctx?.status === 403) return 'forbidden';
  if (ctx?.status === 409 || ctx?.status === 429) {
    try {
      const body = await ctx.clone().json();
      if (typeof body?.error === 'string' && CODES.includes(body.error)) return body.error as DeepCode;
      if (body?.error === 'quota' || body?.error === 'quota_exceeded') return 'quota_exceeded';
    } catch {
      /* not JSON */
    }
  }
  return 'failed';
}

async function call(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const { data, error } = await client().functions.invoke('event-agent', { body });
  if (error) throw new DeepError(await errorCode(error));
  return (data ?? {}) as Record<string, unknown>;
}

export async function fetchEventTerms(eventId: string, force = false): Promise<EventTerm[]> {
  if (!force && termsCache.has(eventId)) return termsCache.get(eventId)!;
  try {
    const { data, error } = await client().rpc('event_terms_for', { p_event: eventId });
    if (error) return [];
    const list = sanitizeTerms(data);
    termsCache.set(eventId, list);
    return list;
  } catch {
    return [];
  }
}

export async function fetchEntry(id: string, force = false): Promise<DeepEntry | null> {
  if (!force && entryCache.has(id)) return entryCache.get(id)!;
  const { data, error } = await client().rpc('deep_entry', { p_id: id });
  if (error) throw new DeepError('failed');
  const e = mapEntry(data);
  entryCache.set(id, e);
  return e;
}

function forget(eventId?: string, entryId?: string) {
  if (eventId) termsCache.delete(eventId);
  else termsCache.clear();
  if (entryId) entryCache.delete(entryId);
}

/** Open or start an entry for a marked term (`key`) or a staff selection (`text`); resolves to its id. */
export async function writeEntry(a: { eventId: string; key?: string; text?: string; lang?: 'he' | 'en' }, onPending?: () => void): Promise<string> {
  const body: Record<string, unknown> = { action: 'deep_write', event_id: a.eventId, ...(a.text ? { text: a.text, lang: a.lang ?? 'en' } : { key: a.key }) };
  for (let i = 0; i <= POLLS; i++) {
    const r = await call(i === 0 ? body : { ...body, poll: true });
    if (typeof r.entry_id === 'string') {
      forget(a.eventId, r.entry_id);
      return r.entry_id;
    }
    if (!r.pending) throw new DeepError('failed');
    onPending?.();
    await sleep(POLL_MS);
  }
  throw new DeepError('failed');
}

export async function refreshEntry(id: string, onPending?: () => void): Promise<void> {
  for (let i = 0; i <= POLLS; i++) {
    const r = await call({ action: 'deep_refresh', entry_id: id, ...(i ? { poll: true } : {}) });
    if (r.ok) {
      forget(undefined, id);
      return;
    }
    if (!r.pending) throw new DeepError('failed');
    onPending?.();
    await sleep(POLL_MS);
  }
  throw new DeepError('failed');
}

export async function updateEntry(id: string, patch: Record<string, unknown>): Promise<void> {
  const r = await call({ action: 'deep_update', entry_id: id, patch });
  if (!r.ok) throw new DeepError('failed');
  forget(undefined, id);
}

export async function removeEntry(id: string): Promise<void> {
  const r = await call({ action: 'deep_remove', entry_id: id });
  if (!r.ok) throw new DeepError('failed');
  forget(undefined, id);
}

export async function fetchDeepQuota(): Promise<DeepQuota> {
  const { data, error } = await client().rpc('deep_my_quota');
  if (error || !data) return { enabled: false, staff: false, used: 0, limit: null, budgetLeft: false };
  const d = data as Record<string, unknown>;
  return {
    enabled: d.enabled === true,
    staff: d.staff === true,
    used: Number(d.used) || 0,
    limit: d.limit == null ? null : Number(d.limit),
    budgetLeft: d.budget_left !== false,
  };
}
