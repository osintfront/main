import { supabase } from '@/integrations/supabase/client';
import { ServiceError, toServiceError } from './serviceError';

/** app_settings.auto_publish — imported drafts that publish themselves once placed on the map. */
export interface AutoPublishSetting {
  enabled: boolean;
  sourcePrefixes: string[];
}

function client() {
  if (!supabase) throw new ServiceError('not_configured', 'Supabase is not configured.');
  return supabase;
}

export async function getAutoPublish(): Promise<AutoPublishSetting> {
  const { data, error } = await client().from('app_settings').select('value').eq('key', 'auto_publish').maybeSingle();
  if (error) throw toServiceError(error);
  const value = ((data as { value?: unknown } | null)?.value ?? {}) as { enabled?: unknown; source_prefixes?: unknown };
  return {
    enabled: value.enabled === true,
    sourcePrefixes: Array.isArray(value.source_prefixes)
      ? value.source_prefixes.filter((p): p is string => typeof p === 'string')
      : [],
  };
}

export async function setAutoPublish(setting: AutoPublishSetting): Promise<void> {
  const prefixes = setting.sourcePrefixes.map((p) => p.trim().slice(0, 60)).filter(Boolean).slice(0, 20);
  const { data, error } = await client()
    .from('app_settings')
    .update({ value: { enabled: setting.enabled, source_prefixes: prefixes } })
    .eq('key', 'auto_publish')
    .select('key');
  if (error) throw toServiceError(error);
  // RLS hides the row from users without settings.manage: zero rows means "not allowed".
  if (!Array.isArray(data) || data.length === 0) throw new ServiceError('permission_denied', 'Not allowed to change settings.');
}

/** app_settings.hfc_alerts — Home Front Command alert polling and display. */
export interface HfcSettings {
  enabled: boolean;
  raw: Record<string, unknown>;
}

export interface HfcIngestStatus {
  lastOkAt: string | null;
  lastError: string | null;
  lastErrorAt: string | null;
}

export async function getHfcSettings(): Promise<HfcSettings> {
  const { data, error } = await client().from('app_settings').select('value').eq('key', 'hfc_alerts').maybeSingle();
  if (error) throw toServiceError(error);
  const raw = ((data as { value?: unknown } | null)?.value ?? {}) as Record<string, unknown>;
  return { enabled: raw.enabled === true, raw };
}

export async function setHfcEnabled(current: HfcSettings, enabled: boolean): Promise<void> {
  const { data, error } = await client()
    .from('app_settings')
    .update({ value: { ...current.raw, enabled } })
    .eq('key', 'hfc_alerts')
    .select('key');
  if (error) throw toServiceError(error);
  if (!Array.isArray(data) || data.length === 0) throw new ServiceError('permission_denied', 'Not allowed to change settings.');
}

/** Health of the live poll (the 5-second job). */
export async function getHfcIngestStatus(): Promise<HfcIngestStatus> {
  const { data, error } = await client()
    .from('hfc_ingest_status')
    .select('last_ok_at,last_error,last_error_at')
    .eq('source', 'live')
    .maybeSingle();
  if (error) throw toServiceError(error);
  const row = data as { last_ok_at: string | null; last_error: string | null; last_error_at: string | null } | null;
  return { lastOkAt: row?.last_ok_at ?? null, lastError: row?.last_error ?? null, lastErrorAt: row?.last_error_at ?? null };
}

/** Reader AI limits (migration 0071). */
export interface AiLimits {
  enabled: boolean;
  budgetUsd: number | null;
}

export async function getAiLimits(): Promise<AiLimits> {
  const { data, error } = await client().from('app_settings').select('key,value').in('key', ['ai_limits_enabled', 'ai_daily_budget_usd']);
  if (error) throw toServiceError(error);
  const rows = (data ?? []) as { key: string; value: unknown }[];
  const v = (k: string) => rows.find((r) => r.key === k)?.value;
  const b = v('ai_daily_budget_usd');
  return { enabled: v('ai_limits_enabled') === true, budgetUsd: typeof b === 'number' ? b : null };
}

export async function setAiSetting(key: 'ai_limits_enabled' | 'ai_daily_budget_usd', value: boolean | number | null): Promise<void> {
  const { data, error } = await client().from('app_settings').update({ value }).eq('key', key).select('key');
  if (error) throw toServiceError(error);
  if (!Array.isArray(data) || data.length === 0) throw new ServiceError('permission_denied', 'Not allowed to change settings.');
}

/** What signed-in readers' AI cost today (Israel day), in USD. */
export async function getReaderAiSpendToday(): Promise<number> {
  const now = new Date();
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' }).format(now);
  const offset = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Jerusalem' })).getTime() - new Date(now.toLocaleString('en-US', { timeZone: 'UTC' })).getTime();
  const since = new Date(Date.parse(`${day}T00:00:00Z`) - offset).toISOString();
  const { data, error } = await client().from('ai_usage').select('cost_usd').not('user_id', 'is', null).gte('at', since).limit(10000);
  if (error) throw toServiceError(error);
  return ((data ?? []) as { cost_usd: number }[]).reduce((s, r) => s + Number(r.cost_usd || 0), 0);
}
