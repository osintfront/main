import { supabase } from '@/integrations/supabase/client';
import type { PlanId } from '@/types/user';

function db() {
  if (!supabase) throw new Error('not configured');
  return supabase;
}
async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await db().rpc(fn, args);
  if (error) throw error;
  return data as T;
}

export const createLicense = (plan: 'pro' | 'max', days: 7 | 14 | 30, note: string, maxUses: number) =>
  rpc<string>('admin_create_license', { p_plan: plan, p_days: days, p_note: note || null, p_max_uses: maxUses });
export const revokeLicense = (key: string) => rpc<void>('admin_revoke_license', { p_key: key });
export const redeemLicense = (key: string) => rpc<{ ok: boolean; error?: string; plan?: PlanId; expires_at?: string }>('redeem_license', { p_key: key });
export const setPlan = (user: string, plan: PlanId, source: 'default' | 'eval' | 'paid', expires: string | null) =>
  rpc<void>('admin_set_plan', { p_user: user, p_plan: plan, p_source: source, p_expires: expires });
export const extendEval = (user: string, days: number) => rpc<void>('admin_extend_eval', { p_user: user, p_days: days });
export const removePlan = (user: string) => rpc<void>('admin_remove_plan', { p_user: user });

export interface LicenseRow { key: string; plan: string; duration_days: number; max_uses: number; uses: number; note: string | null; created_at: string; redeem_by: string; revoked: boolean }
export async function listLicenses(): Promise<LicenseRow[]> {
  const { data, error } = await db().from('license_keys').select('key,plan,duration_days,max_uses,uses,note,created_at,redeem_by,revoked').order('created_at', { ascending: false }).limit(50);
  if (error) throw error;
  return (data ?? []) as LicenseRow[];
}

export interface SessionRow { user_id: string; device_type: string | null; browser: string | null; last_seen: string; ended_at: string | null }
/** The latest session per user (Users page). */
export async function latestSessions(): Promise<Map<string, SessionRow>> {
  const { data } = await db().from('user_sessions').select('user_id,device_type,browser,last_seen,ended_at').order('last_seen', { ascending: false }).limit(1000);
  const out = new Map<string, SessionRow>();
  for (const r of (data ?? []) as SessionRow[]) if (!out.has(r.user_id)) out.set(r.user_id, r);
  return out;
}
