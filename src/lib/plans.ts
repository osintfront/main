import { useSyncExternalStore } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type { PlanId, Profile } from '@/types/user';

/**
 * Plans (Free / Pro / Max). Limits live in the database (plan_features) and the switch
 * app_settings.enforce_plans — while it is false, everyone has full access (today).
 */
export type FeatureKey =
  | 'live_map' | 'feed' | 'hfc_alerts' | 'translation_he' | 'push' | 'archive_days'
  | 'ships_aircraft' | 'satellite' | 'ai_expand_ask' | 'insights' | 'data_export';

interface FeatureRow { feature_key: string; plan_id: PlanId; enabled: boolean; limit_value: number | null }

let enforce = false;
let features: FeatureRow[] = [];
let me: Pick<Profile, 'plan' | 'planExpiresAt' | 'role'> | null = null;
const listeners = new Set<() => void>();
let loaded = false;

export async function loadPlanConfig() {
  if (!supabase || loaded) return;
  loaded = true;
  const [{ data: s }, { data: f }] = await Promise.all([
    supabase.from('app_settings').select('value').eq('key', 'enforce_plans').maybeSingle(),
    supabase.from('plan_features').select('feature_key,plan_id,enabled,limit_value'),
  ]);
  enforce = s?.value === true;
  features = (f ?? []) as FeatureRow[];
  listeners.forEach((l) => l());
}

/** Called by the auth hook with the signed-in user's profile. */
export function setPlanUser(p: Profile | null) {
  me = p;
  if (p) void loadPlanConfig();
  listeners.forEach((l) => l());
}

/** The plan in force: an expired plan counts as Free. */
export function effectivePlan(p: (Pick<Profile, 'plan' | 'planExpiresAt'> & { role?: Profile['role'] }) | null): PlanId {
  if (!p) return 'free';
  if (p.role === 'super_admin' || p.role === 'admin') return 'max'; // staff: everything
  if (p.plan !== 'free' && p.planExpiresAt && new Date(p.planExpiresAt).getTime() < Date.now()) return 'free';
  return p.plan;
}

/** Central check. Staff (admin roles) always pass; while plans are not enforced, everyone passes. */
export function hasFeature(user: Pick<Profile, 'plan' | 'planExpiresAt' | 'role'> | null = me, key: FeatureKey): boolean {
  if (!enforce) return true;
  if (user && user.role !== 'viewer') return true;
  const row = features.find((r) => r.feature_key === key && r.plan_id === effectivePlan(user));
  return !!row?.enabled;
}

export function featureLimit(key: FeatureKey, user = me): number | null {
  return features.find((r) => r.feature_key === key && r.plan_id === effectivePlan(user))?.limit_value ?? null;
}

export class PlanRequiredError extends Error {
  constructor(public feature: FeatureKey) { super('plan_required'); }
}
/** Throw when the current user's plan lacks the feature (never while not enforced). */
export function requireFeature(key: FeatureKey) {
  if (!hasFeature(me, key)) throw new PlanRequiredError(key);
}

export function usePlanVersion(): number {
  return useSyncExternalStore((l) => (listeners.add(l), () => listeners.delete(l)), () => (enforce ? 1 : 0) + features.length * 2, () => 0);
}

export const PLAN_LABEL: Record<PlanId, string> = { free: 'Free', pro: 'Pro', max: 'Max', intel: 'Intel' };
