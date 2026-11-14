import { requireFeature } from '@/lib/plans';
import { supabase } from '@/integrations/supabase/client';
import { fetchPublicEventsByIds } from './eventService';
import type { PublicEvent } from '@/types/event';
import type { AskContext } from '@/lib/askChat';
import type { DashState, Preset, StatusPayload } from '@/lib/askStats';

export type AskMode = 'answer' | 'summary' | 'stats' | 'clarify_stats' | 'too_many';

/** "Ask the map": the answer and the events behind it (in the order the answer cites them: [1] = events[0]). */
export interface AskAnswer {
  question: string;
  answer: string;
  /** Cited/relevant event ids, [n] in the answer = ids[n-1]. */
  ids: string[];
  events: PublicEvent[];
  /** A direct answer, a summary in titled blocks, a statistics dashboard, the map's "dashboard or text?"
   *  question, or "too many events — narrow it". */
  mode: AskMode;
  /** A Pro user asked a count question: the text answer plus "dashboards are part of Max". */
  upgradeHint?: boolean;
  /** mode 'stats': the dashboard being built / built for this turn. */
  dashboard?: DashState;
  /** A short message after the clarify question that the server read as a new question (not a reply). */
  asNew?: boolean;
}

export type AskErrorCode = 'rate_limited' | 'quota' | 'budget' | 'upgrade' | 'sign_in' | 'failed' | 'quota_dashboard' | 'busy' | 'too_many' | 'not_in_plan';
export class AskError extends Error {
  constructor(public code: AskErrorCode, message: string = code, public left?: number) {
    super(message);
  }
}

/** The JSON body of a failed function call, when it has one. */
async function errorBody(error: unknown): Promise<Record<string, unknown> | null> {
  try {
    return (await (error as { context?: Response }).context?.clone().json()) ?? null;
  } catch {
    return null;
  }
}

/** A failed "ask" / dashboard call as an AskError. */
async function askFailure(error: unknown): Promise<AskError> {
  const status = (error as { context?: { status?: number } }).context?.status;
  const body = await errorBody(error);
  if (status === 429 && body?.error === 'quota_dashboard') return new AskError('quota_dashboard', 'quota_dashboard', Number(body.left ?? 0));
  if (status === 429) return new AskError(await aiLimitCode(error));
  if (status === 409) return new AskError('busy');
  if (status === 403) return new AskError('not_in_plan');
  if (status === 422) return new AskError('too_many');
  if (status === 401) return new AskError('sign_in');
  return new AskError('failed', String((error as { message?: string })?.message ?? error));
}

/** 429 from the AI agent: daily quota, site-wide budget, or the hourly rate limit. */
export async function aiLimitCode(error: unknown): Promise<'quota' | 'budget' | 'upgrade' | 'rate_limited'> {
  try {
    const body = await (error as { context?: Response }).context?.clone().json();
    if (body?.error === 'quota' || body?.error === 'budget' || body?.error === 'upgrade') return body.error;
  } catch {
    /* not JSON */
  }
  return 'rate_limited';
}

/** ctx = the conversation so far, for a follow-up question (see lib/askChat buildContext).
 *  lang = the UI language (it also tells the server this client can show dashboards);
 *  clarify = this message answers the map's "dashboard or text?" question. */
export async function askMap(question: string, ctx: AskContext | undefined, o: { lang: 'he' | 'en'; clarify?: 'dashboard' | 'text' | 'typed' }): Promise<AskAnswer> {
  requireFeature('ai_expand_ask');
  if (!supabase) throw new AskError('failed', 'Not configured');
  const { data, error } = await supabase.functions.invoke('event-agent', {
    body: {
      action: 'ask', question, lang: o.lang,
      ...(o.clarify ? { clarify_reply: o.clarify } : {}),
      ...(ctx?.history.length ? { history: ctx.history, prev_ids: ctx.prev_ids } : {}),
    },
  });
  if (error) throw await askFailure(error);
  if (!data?.ok) throw new AskError('failed', String(data?.error ?? 'failed'));
  const asNew = data.new_question === true ? { asNew: true } : {};
  if (data.mode === 'stats') {
    const dashboard: DashState = { id: String(data.dashboard_id), status: 'running', stage: 'finding', progress: null, result: null, cached: data.cached === true, rebuild: null, note: null };
    return { question, answer: '', ids: [], events: [], mode: 'stats', dashboard, ...asNew };
  }
  if (data.mode === 'clarify_stats' || data.mode === 'too_many') return { question, answer: '', ids: [], events: [], mode: data.mode, ...asNew };
  const ids: string[] = Array.isArray(data.ids) ? data.ids : [];
  const events = await fetchPublicEventsByIds(ids);
  return { question, answer: String(data.answer ?? ''), ids, events, mode: data.mode === 'summary' ? 'summary' : 'answer', ...(data.upgrade_hint === true ? { upgradeHint: true } : {}), ...asNew };
}

/** One poll of a dashboard build. */
export async function dashboardStatus(id: string): Promise<StatusPayload> {
  if (!supabase) throw new AskError('failed', 'Not configured');
  const { data, error } = await supabase.functions.invoke('event-agent', { body: { action: 'dashboard_status', id } });
  if (error) throw await askFailure(error);
  if (!data?.ok) throw new AskError('failed', String(data?.error ?? 'failed'));
  return { status: data.status, stage: data.stage, progress: data.progress ?? null, result: data.result ?? null, cached: data.cached === true };
}

/** A period chip: the same dashboard for another period (a new build, or a fresh copy from the last 15 minutes). */
export async function dashboardPeriod(id: string, preset: Preset): Promise<{ id: string; cached: boolean }> {
  if (!supabase) throw new AskError('failed', 'Not configured');
  const { data, error } = await supabase.functions.invoke('event-agent', { body: { action: 'dashboard_period', dashboard_id: id, period: preset } });
  if (error) throw await askFailure(error);
  if (data?.mode === 'too_many') throw new AskError('too_many');
  if (!data?.ok || !data.dashboard_id) throw new AskError('failed', String(data?.error ?? 'failed'));
  return { id: String(data.dashboard_id), cached: data.cached === true };
}

/** Today's AI credits (my_ai_quota); null when it cannot be read. */
export async function fetchAskQuota(): Promise<{ enabled: boolean; staff: boolean; limit: number | null; used: number } | null> {
  if (!supabase) return null;
  try {
    const { data, error } = await supabase.rpc('my_ai_quota');
    if (error || !data) return null;
    return { enabled: data.enabled === true, staff: data.staff === true, limit: data.limit == null ? null : Number(data.limit), used: Number(data.used ?? 0) };
  } catch {
    return null;
  }
}
