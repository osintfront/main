import { supabase } from '@/integrations/supabase/client';

/**
 * Paid plans through Grow. The browser only asks: what may I buy (billing_options), open a payment page
 * (/api/billing?action=checkout), how is my order (billing_orders), cancel (/api/billing?action=cancel).
 * The database decides prices and what is allowed.
 */
export type PaidPlan = 'pro' | 'max';
export type Period = 'monthly' | 'yearly';
export type QuoteReason = 'current_plan' | 'lower_plan' | 'custom_plan' | 'bad_plan' | 'no_profile';

export interface Quote {
  allowed: boolean;
  kind?: 'new' | 'upgrade' | 'renew' | 'replace';
  amount_agorot?: number;
  credit_days?: number;
  from_plan?: string;
  reason?: QuoteReason;
  current_plan?: string;
  current_period?: Period;
  current_end?: string;
}

export interface Subscription {
  id: string;
  plan: PaidPlan;
  period: Period;
  status: 'active' | 'past_due' | 'canceled';
  current_period_end: string;
  cancel_at_period_end: boolean;
  cancel_state: 'none' | 'pending' | 'done' | 'failed';
  failed_attempts: number;
}

export interface BillingOptions {
  signed_in: boolean;
  plan?: string;
  plan_source?: string;
  plan_expires_at?: string | null;
  billing_period?: Period | null;
  /** Super admin test mode: the amount actually charged (agorot), e.g. 100 = ₪1. */
  test_price_agorot?: number | null;
  subscription?: Subscription | null;
  options?: Record<`${PaidPlan}_${Period}`, Quote>;
}

export interface OrderState {
  id: string;
  status: 'pending' | 'paid' | 'failed' | 'abandoned';
  plan: PaidPlan;
  period: Period;
  kind: string;
  failure_reason: string | null;
}

export async function loadBillingOptions(): Promise<BillingOptions | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.rpc('billing_options');
  return error ? null : (data as BillingOptions);
}

export async function loadOrder(id: string): Promise<OrderState | null> {
  if (!supabase) return null;
  const { data } = await supabase.from('billing_orders').select('id,status,plan,period,kind,failure_reason').eq('id', id).maybeSingle();
  return (data as OrderState | null) ?? null;
}

async function call(action: string, body: unknown): Promise<{ ok: boolean; data: Record<string, unknown> }> {
  if (!supabase) return { ok: false, data: { error: 'generic' } };
  const { data: s } = await supabase.auth.getSession();
  const token = s.session?.access_token;
  if (!token) return { ok: false, data: { error: 'signin_required' } };
  try {
    const res = await fetch(`/api/billing?action=${action}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify(body ?? {}),
    });
    const data = (await res.json().catch(() => ({ error: 'generic' }))) as Record<string, unknown>;
    return { ok: res.ok, data };
  } catch {
    return { ok: false, data: { error: 'generic' } };
  }
}

/** Opens a Grow payment page for this plan. Returns the page address, or an error code. */
export async function startCheckout(input: { plan: PaidPlan; period: Period; fullName: string; phone: string; returnTo: string }): Promise<{ url: string } | { error: string }> {
  const r = await call('checkout', input);
  return r.ok && typeof r.data.url === 'string' ? { url: r.data.url } : { error: String(r.data.error ?? 'generic') };
}

export async function cancelSubscription() {
  const r = await call('cancel', {});
  return r.ok ? { ok: true as const, until: String(r.data.until ?? '') } : { ok: false as const, error: String(r.data.error ?? 'generic') };
}

/** Client-side form checks (the server checks again). */
export const nameOk = (s: string) => {
  const parts = s.trim().split(/\s+/);
  return parts.length >= 2 && parts.every((p) => p.length >= 2);
};
export const phoneOk = (s: string) => /^05\d{8}$/.test(s.replace(/\D/g, '').replace(/^972/, '0'));
