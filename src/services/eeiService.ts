import { supabase } from '@/integrations/supabase/client';
import { sanitizeEeiList, type EeiList, type TagRow } from '@/lib/eeiLens';

/**
 * Free-text EEI (צי"ח): split a pasted list, save / clear the user's list (event-agent), read the
 * saved list (eei_lists, own row) and the AI's marks (eei_my_tags). Errors are thrown as Error with
 * message = the server's code ('upgrade' | 'quota' | 'budget' | 'empty' | 'sign_in' | 'failed').
 */

function client() {
  if (!supabase) throw new Error('failed');
  return supabase;
}

async function errorCode(error: unknown): Promise<string> {
  const ctx = (error as { context?: Response }).context;
  if (ctx?.status === 401) return 'sign_in';
  try {
    const body = await ctx?.clone().json();
    if (typeof body?.error === 'string' && ['upgrade', 'quota', 'budget', 'empty'].includes(body.error)) return body.error;
  } catch {
    /* not JSON */
  }
  return 'failed';
}

async function call(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const { data, error } = await client().functions.invoke('event-agent', { body });
  if (error) throw new Error(await errorCode(error));
  if (!data?.ok) throw new Error(typeof data?.error === 'string' ? data.error : 'failed');
  return data as Record<string, unknown>;
}

/** Theatres from the server: cleaned, each with its id (hash, or 'exceptional'). */
function toList(raw: unknown): EeiList | null {
  const theatres = raw && typeof raw === 'object' ? (raw as { theatres?: unknown }).theatres : null;
  if (!Array.isArray(theatres)) return null;
  return sanitizeEeiList({
    theatres: theatres.map((t) => (t && typeof t === 'object' ? { ...(t as object), id: (t as { kind?: string }).kind === 'exceptional' ? 'exceptional' : (t as { hash?: string }).hash } : t)),
  });
}

/** For sending back: drop the browser-only id. */
function forServer(list: EeiList) {
  return { theatres: list.theatres.map(({ id: _id, ...t }) => t) };
}

export async function parseEei(text: string): Promise<EeiList> {
  const data = await call({ action: 'eei_parse', text });
  const list = toList({ theatres: data.theatres });
  if (!list || !list.theatres.length) throw new Error('empty');
  return list;
}

export async function saveEei(rawText: string, list: EeiList): Promise<EeiList> {
  const data = await call({ action: 'eei_save', raw_text: rawText, list: forServer(list) });
  const saved = toList(data.list);
  if (!saved) throw new Error('failed');
  return saved;
}

export async function clearEei(): Promise<void> {
  await call({ action: 'eei_clear' });
}

export async function fetchMyList(): Promise<{ rawText: string; list: EeiList | null; prevRawText: string; prevList: EeiList | null } | null> {
  const { data, error } = await client().from('eei_lists').select('raw_text,list,prev_raw_text,prev_list').maybeSingle();
  if (error || !data) return null;
  return {
    rawText: data.raw_text ?? '',
    list: toList(data.list),
    prevRawText: data.prev_raw_text ?? '',
    prevList: toList(data.prev_list),
  };
}

export async function fetchMyTags(after: string | null): Promise<{ degraded: boolean; tags: TagRow[] }> {
  const { data, error } = await client().rpc('eei_my_tags', { p_after: after });
  if (error || !data) return { degraded: false, tags: [] };
  const rows = Array.isArray(data.tags) ? (data.tags as TagRow[]) : [];
  return {
    degraded: data.degraded === true,
    tags: rows.filter((r) => r && typeof r.h === 'string' && typeof r.e === 'string' && Array.isArray(r.t) && typeof r.at === 'string'),
  };
}
