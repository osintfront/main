import { supabase } from '@/integrations/supabase/client';
import { toServiceError } from './serviceError';

/**
 * OFI Insights. Readers only ever call the ofi_* database functions, which return just what their
 * plan may see (guests cannot call them at all). The admin calls (manual parameter, recompute,
 * signal weights) are refused by the server for anyone but the super admin.
 */

export type OfiTier = 0 | 1 | 2 | 3;

export interface OfiCard {
  slug: string;
  title_he: string;
  title_en: string;
  horizon_hours: number;
  status: string;
  min_tier: number;
  tier: OfiTier;
  locked: boolean;
  last_update: string | null;
  next_update: string | null;
  probability: number | null;
  previous_probability: number | null;
  /** [iso time, probability][] — Pro and above. */
  spark: [string, number][] | null;
}

export interface OfiContribution {
  key: string;
  name_he: string;
  name_en: string;
  source_type: string;
  score: number | null;
  weight: number;
  freshness: number;
  stale: boolean;
  logit: number;
  pp: number;
}

export interface OfiSignal {
  key: string;
  source_type: string;
  name_he: string;
  name_en: string;
  weight: number;
  direction: number;
  is_circuit_breaker: boolean;
  last_updated: string | null;
  stale: boolean;
  readings: [string, number][];
}

export interface OfiDetail extends Omit<OfiCard, 'spark'> {
  description_he: string | null;
  description_en: string | null;
  resolution_criteria_he: string;
  resolution_criteria_en: string;
  model_version: string | null;
  confidence_low: number | null;
  confidence_high: number | null;
  base_rate: number | null;
  summary_he: string | null;
  summary_en: string | null;
  signal_count: number;
  contributions: OfiContribution[];
  signals: OfiSignal[] | null;
  history: { ts: string; p: number; trigger: string }[] | null;
}

export interface OfiTrackRecord {
  n: number;
  brier: number | null;
  windows: { start: string; end: string; p: number | null; outcome: boolean }[];
}

function client() {
  if (!supabase) throw new Error('offline');
  return supabase;
}

export async function listInsights(): Promise<OfiCard[]> {
  const { data, error } = await client().rpc('ofi_list');
  if (error) throw toServiceError(error);
  return (Array.isArray(data) ? data : []) as OfiCard[];
}

export async function getInsight(slug: string): Promise<OfiDetail | null> {
  const { data, error } = await client().rpc('ofi_detail', { p_slug: slug });
  if (error) throw toServiceError(error);
  return (data ?? null) as OfiDetail | null;
}

export async function getTrackRecord(slug: string): Promise<OfiTrackRecord | null> {
  const { data, error } = await client().rpc('ofi_track_record', { p_slug: slug });
  if (error) throw toServiceError(error);
  return (data ?? null) as OfiTrackRecord | null;
}

// ── Super admin ──────────────────────────────────────────────────────────────────────────────

export interface OfiAdminEvent {
  id: string;
  slug: string;
  status: 'draft' | 'active' | 'paused' | 'resolved';
  is_published: boolean;
  base_rate: number;
  refresh_interval_hours: number;
  next_run_at: string;
  last_run_at: string | null;
}

export interface OfiAdminSignal {
  id: string;
  key: string;
  source_type: string;
  name_he: string;
  name_en: string;
  weight: number;
  enabled: boolean;
  is_circuit_breaker: boolean;
  stale_after_hours: number;
  last_updated: string | null;
  last_error: string | null;
  config: Record<string, unknown>;
}

export interface OfiManualReading {
  ts: string;
  raw_value: number | null;
  metadata: { note?: string; hours?: number };
}

export async function adminLoad(slug: string): Promise<{ event: OfiAdminEvent; signals: OfiAdminSignal[]; manual: OfiManualReading | null }> {
  const db = client();
  const { data: event, error } = await db.from('insight_events')
    .select('id,slug,status,is_published,base_rate,refresh_interval_hours,next_run_at,last_run_at').eq('slug', slug).single();
  if (error) throw toServiceError(error);
  const { data: signals, error: e2 } = await db.from('insight_signals')
    .select('id,key,source_type,name_he,name_en,weight,enabled,is_circuit_breaker,stale_after_hours,last_updated,last_error,config')
    .eq('event_id', event.id).order('source_type').order('key');
  if (e2) throw toServiceError(e2);
  const manualId = (signals ?? []).find((s) => s.key === 'manual_admin')?.id;
  let manual: OfiManualReading | null = null;
  if (manualId) {
    const { data } = await db.from('insight_signal_readings').select('ts,raw_value,metadata')
      .eq('signal_id', manualId).order('ts', { ascending: false }).limit(1).maybeSingle();
    manual = (data ?? null) as OfiManualReading | null;
  }
  return { event: event as OfiAdminEvent, signals: (signals ?? []) as OfiAdminSignal[], manual };
}

/** Manual parameter: level −100 … +100, held for `hours`. */
export async function adminSetManual(slug: string, level: number, note: string, hours: number): Promise<void> {
  const { error } = await client().rpc('ofi_admin_manual', { p_slug: slug, p_level: Math.round(level), p_note: note, p_hours: Math.round(hours) });
  if (error) throw toServiceError(error);
}

async function runner(body: Record<string, unknown>) {
  const { data, error } = await client().functions.invoke('ofi-runner', { body });
  if (error) throw toServiceError(error);
  if (data && data.ok === false) throw new Error(String(data.error ?? 'failed'));
  return data;
}

/** Recompute from the stored readings only (fast; e.g. right after a manual parameter). */
export const adminCompute = (slug: string) => runner({ action: 'compute', slug });
/** "Recompute now": read every source again, then compute (≈ 15–30 s). */
export const adminRecompute = (slug: string) => runner({ action: 'recompute', slug });

export async function adminUpdateSignal(id: string, patch: Partial<Pick<OfiAdminSignal, 'weight' | 'enabled'>>): Promise<void> {
  const { error } = await client().from('insight_signals').update(patch).eq('id', id);
  if (error) throw toServiceError(error);
}

export async function adminUpdateEvent(id: string, patch: Partial<Pick<OfiAdminEvent, 'status' | 'is_published' | 'base_rate' | 'refresh_interval_hours'>>): Promise<void> {
  const { error } = await client().from('insight_events').update(patch).eq('id', id);
  if (error) throw toServiceError(error);
}
