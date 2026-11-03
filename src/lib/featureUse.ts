import { useEffect, useSyncExternalStore } from 'react';
import { supabase } from '@/integrations/supabase/client';

/**
 * Daily uses counted in the database (migration 20261104000077): every "expand" click and every
 * satellite turn-on. The server decides; the site only asks and shows what is left.
 */
export type UseReason = null | 'signup_required' | 'not_in_plan' | 'quota_exceeded' | 'error';
export interface UseResult { ok: boolean; reason: UseReason; used: number; limit: number | null; remaining: number | null }
export type CountedFeature = 'expand_daily' | 'satellite';
type Usage = Partial<Record<CountedFeature, { used: number; limit: number | null }>>;

let usage: Usage = {};
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

async function signedIn(): Promise<boolean> {
  if (!supabase) return false;
  const { data } = await supabase.auth.getSession();
  return !!data.session;
}

/** Today's uses for the signed-in user (empty for guests). */
export async function refreshFeatureUsage(): Promise<void> {
  if (!supabase || !(await signedIn())) {
    usage = {};
    return emit();
  }
  const { data, error } = await supabase.rpc('my_feature_usage');
  if (!error && data) usage = data as Usage;
  emit();
}

/** Spend one use of a counted feature. Guests get signup_required without a request. */
export async function spendFeature(key: CountedFeature): Promise<UseResult> {
  const refused = (reason: UseReason): UseResult => ({ ok: false, reason, used: 0, limit: null, remaining: null });
  if (!supabase || !(await signedIn())) return refused('signup_required');
  const { data, error } = await supabase.rpc('use_feature', { p_key: key });
  if (error || !data) return refused('error');
  const r = data as UseResult;
  usage = { ...usage, [key]: { used: r.used, limit: r.limit } };
  emit();
  return r;
}

/** Live view of today's uses; loads once per mount. */
export function useFeatureUsage(): Usage {
  useEffect(() => void refreshFeatureUsage(), []);
  return useSyncExternalStore((l) => (listeners.add(l), () => listeners.delete(l)), () => usage, () => usage);
}
