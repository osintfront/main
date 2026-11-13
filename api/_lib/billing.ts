// Billing helpers for Grow payments. Pure functions only: no network, no database.
// The Grow adapter (raw webhook payload -> VerifiedPayment) is written after the sandbox is available,
// because the field names are not confirmed yet. Until then, callers pass VerifiedPayment objects.
import { INTRO_PRICES } from '../../src/content/packages.ts';

export type BillingPlan = 'pro' | 'max';
export type BillingPeriod = 'monthly' | 'yearly';
export type BillingKind = 'payment' | 'renewal' | 'failed' | 'canceled' | 'refund';

/** An event Grow has confirmed server-to-server, in our own shape. */
export interface VerifiedPayment {
  eventKey: string;
  kind: BillingKind;
  userId: string;
  plan?: BillingPlan;
  period?: BillingPeriod;
  growSubscriptionId?: string;
  transactionId?: string;
  orderId?: string;
  amountAgorot?: number;
  vatAgorot?: number;
}

/** Arguments of the billing_apply RPC (names match the SQL parameters). */
export interface BillingApplyArgs {
  p_event_key: string;
  p_kind: BillingKind;
  p_user: string;
  p_plan: string | null;
  p_period: string | null;
  p_grow_subscription_id: string | null;
  p_transaction_id: string | null;
  p_order_id: string | null;
  p_amount_agorot: number;
  p_vat_agorot: number;
}

export const PLANS: readonly BillingPlan[] = ['pro', 'max'];
export const PERIODS: readonly BillingPeriod[] = ['monthly', 'yearly'];

/** Price in agorot (1 shekel = 100 agorot), from the same table the packages page shows. */
export function priceAgorot(plan: BillingPlan, period: BillingPeriod): number {
  const p = INTRO_PRICES[plan];
  const shekels = period === 'yearly' ? p.yearly : p.monthly;
  return shekels * 100;
}

/**
 * Checks a verified event and returns the RPC arguments.
 * Throws on anything the database would reject, so a bad event never reaches billing_apply.
 */
export function toBillingApplyArgs(e: VerifiedPayment): BillingApplyArgs {
  if (!e.eventKey.trim()) throw new Error('event key required');
  if (!e.userId.trim()) throw new Error('user required');

  if (e.kind === 'payment' || e.kind === 'renewal') {
    if (!e.plan || !PLANS.includes(e.plan)) throw new Error('unknown plan');
    if (!e.period || !PERIODS.includes(e.period)) throw new Error('unknown period');
    if (!e.transactionId) throw new Error('transaction id required');
    const expected = priceAgorot(e.plan, e.period);
    if (e.amountAgorot !== expected) throw new Error(`amount mismatch: expected ${expected}, got ${e.amountAgorot}`);
  }
  if (e.kind === 'refund' && (e.amountAgorot ?? 0) < 0) throw new Error('refund amount must not be negative');

  return {
    p_event_key: e.eventKey,
    p_kind: e.kind,
    p_user: e.userId,
    p_plan: e.plan ?? null,
    p_period: e.period ?? null,
    p_grow_subscription_id: e.growSubscriptionId ?? null,
    p_transaction_id: e.transactionId ?? null,
    p_order_id: e.orderId ?? null,
    p_amount_agorot: e.amountAgorot ?? 0,
    p_vat_agorot: e.vatAgorot ?? 0,
  };
}
