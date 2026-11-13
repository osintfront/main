// Billing helpers for Grow payments. Pure functions only: no network, no database.
// The Grow adapter (raw webhook payload -> VerifiedPayment) is written after real notifications are
// captured, because the field names are not confirmed yet. Until then, callers pass VerifiedPayment objects.
import { timingSafeEqual } from 'node:crypto';

/**
 * Server-side prices in shekels, VAT included. The server decides what a plan costs, never the browser.
 * Must match INTRO_PRICES in src/content/packages.ts (a test checks this).
 */
export const SERVER_PRICES = {
  pro: { monthly: 59, yearly: 590 },
  max: { monthly: 129, yearly: 1290 },
} as const;

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
  const p = SERVER_PRICES[plan];
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

// ── Webhook capture (stores notifications; never grants a plan) ───────────────────

/** Largest notification body we accept. */
export const MAX_WEBHOOK_BYTES = 64 * 1024;

/** Compares the URL token with the configured secret in constant time. An empty secret never matches. */
export function tokenMatches(given: string | null, expected: string): boolean {
  if (!expected || !given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Reads a notification body: JSON, form-encoded (what payment pages usually post), or plain text. */
export function parseWebhookBody(contentType: string | null, text: string): Record<string, unknown> {
  const type = (contentType ?? '').toLowerCase();
  if (type.includes('application/json')) {
    try {
      const v: unknown = JSON.parse(text);
      return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : { value: v };
    } catch {
      return { raw: text };
    }
  }
  if (type.includes('application/x-www-form-urlencoded')) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of new URLSearchParams(text)) out[k] = v;
    return out;
  }
  return { raw: text };
}

// ── Grow notifications → our shape ───────────────────────────────────────────────

/**
 * Grow posts form fields (data[sum]=…) or JSON ({ status, data: { … } }), depending on the source.
 * Everything is flattened to one level: data's fields at the top, Grow's outer status as topStatus.
 */
export function flattenGrow(body: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  // Product lists, shipping and page questions have their own "sum"/"price"/"name": never mixed in.
  const SKIP = /productData|dynamicFields|shipping/;
  const put = (k: string, v: unknown) => {
    if (v == null || SKIP.test(k)) return;
    if (typeof v === 'object') {
      if (Array.isArray(v)) return;
      for (const [k2, v2] of Object.entries(v as Record<string, unknown>)) put(k2, v2);
      return;
    }
    if (!(k in out)) out[k] = String(v).trim(); // the first (outer) value wins
  };
  for (const [key, value] of Object.entries(body)) {
    if (key === 'status' || key === 'err') {
      if (value && typeof value === 'object') out.topErr = String((value as Record<string, unknown>).message ?? '').trim();
      else out[key === 'status' ? 'topStatus' : 'topErr'] = String(value ?? '').trim();
      continue;
    }
    if (key === 'data' && value && typeof value === 'object') {
      put('data', value);
      continue;
    }
    if (SKIP.test(key)) continue;
    // data[sum] → sum, data[customFields][cField1] → cField1
    const m = /^data\[(.+)\]$/.exec(key);
    put(m ? m[1].split('][').pop()! : key, value);
  }
  return out;
}

export type GrowNotice =
  | {
      type: 'payment';
      eventKey: string;
      paid: boolean;
      orderId: string | null;
      processId: string | null;
      transactionId: string | null;
      transactionToken: string | null;
      asmachta: string | null;
      amountAgorot: number | null;
      phone: string | null;
      email: string | null;
      statusText: string;
    }
  | { type: 'renewal'; eventKey: string; directDebitId: string | null; transactionId: string | null; amountAgorot: number | null; phone: string | null; email: string | null }
  | { type: 'failed'; eventKey: string; directDebitId: string | null; amountAgorot: number | null; phone: string | null; email: string | null; error: string; attempts: number | null }
  | { type: 'unknown' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const toAgorot = (s: string | undefined): number | null => {
  if (s == null || s === '') return null;
  const n = Number(s.replace(/[^\d.]/g, ''));
  return Number.isFinite(n) ? Math.round(n * 100) : null;
};
const nz = (s: string | undefined) => (s && s !== '0' ? s : null);
const firstDigits = (s: string | undefined) => (s ? (/\d+/.exec(s)?.[0] ?? null) : null);

/** Which of Grow's notifications this is, with the fields billing needs. */
export function readGrowNotice(body: Record<string, unknown>): GrowNotice {
  const f = flattenGrow(body);

  // A monthly charge failed (account webhook "Failure recurring payments").
  if (f.regular_payment_id || (f.error_message && f.transaction_type)) {
    const id = firstDigits(f.regular_payment_id);
    const attempts = f.charges_attempts ? Number(f.charges_attempts) : null;
    return {
      type: 'failed',
      eventKey: `fail:${id ?? f.phone ?? 'x'}:${attempts ?? 0}:${new Date().toISOString().slice(0, 10)}`,
      directDebitId: id,
      amountAgorot: toAgorot(f.sum),
      phone: f.phone || null,
      email: f.email || null,
      error: f.error_message || 'charge failed',
      attempts: Number.isFinite(attempts) ? attempts : null,
    };
  }

  // A payment link was paid (our notifyUrl, or the account webhook for payment links).
  const processId = nz(f.paymentLinkProcessId) ?? null;
  if (processId || (f.transactionId && f.processId)) {
    const statusCode = f.statusCode ?? '';
    const paid = statusCode ? statusCode === '2' : f.status === 'שולם' || (f.topStatus === '1' && !!f.transactionId);
    const orderId = [f.cField1, f.customField1, f.custom_field_1].find((v) => v && UUID.test(v)) ?? null;
    return {
      type: 'payment',
      eventKey: `pay:${f.transactionId || processId}`,
      paid,
      orderId,
      processId,
      transactionId: f.transactionId || null,
      transactionToken: f.transactionToken || null,
      asmachta: f.asmachta || null,
      amountAgorot: toAgorot(f.sum),
      phone: f.payerPhone || null,
      email: f.payerEmail || null,
      statusText: f.status || f.topErr || '',
    };
  }

  // A monthly charge went through (account webhook "Recurring payment", from the second charge on).
  if (f.directDebitId || /הוראת קבע/.test(f.paymentType ?? '')) {
    const tx = f.transactionCode || f.asmachta || null;
    return {
      type: 'renewal',
      eventKey: `ren:${tx ?? `${f.directDebitId}:${f.paymentDate}`}`,
      directDebitId: firstDigits(f.directDebitId),
      transactionId: tx,
      amountAgorot: toAgorot(f.paymentSum ?? f.sum),
      phone: f.payerPhone || null,
      email: f.payerEmail || null,
    };
  }
  return { type: 'unknown' };
}

/** Grow's published server addresses (developers.grow.business → IP Addresses). */
export const GROW_IPS: ReadonlySet<string> = new Set([
  '3.123.194.128', '3.124.62.248', '18.198.97.252', '3.75.43.49', '18.156.94.176', '18.158.107.17',
  '3.121.149.170', '3.76.166.104', '3.69.160.29', '3.78.79.166', '3.71.221.153', '3.78.131.18',
  '3.67.110.47', '18.192.112.151', '52.59.95.229', '18.158.145.146', '3.75.128.58', '3.78.28.179',
  '3.122.21.187', '3.66.126.119', '35.158.249.118', '52.29.70.254', '52.59.159.234', '3.76.183.119',
  '18.157.106.67', '18.197.238.68', '3.66.129.154', '3.77.123.153', '3.70.40.72',
]);

/** The caller's address as Vercel sees it. */
export function callerIp(headers: Headers): string {
  return (headers.get('x-real-ip') ?? headers.get('x-forwarded-for')?.split(',')[0] ?? '').trim();
}

// ── Checkout input ──────────────────────────────────────────────────────────────

/** Grow needs a first and last name, each at least 2 letters. */
export function validFullName(s: unknown): string | null {
  if (typeof s !== 'string') return null;
  const clean = s.replace(/[^\p{L}\s'-]/gu, ' ').replace(/\s+/g, ' ').trim();
  const parts = clean.split(' ');
  return parts.length >= 2 && parts.every((p) => p.length >= 2) && clean.length <= 60 ? clean : null;
}

/** An Israeli mobile number as Grow wants it: 05XXXXXXXX. */
export function validPhone(s: unknown): string | null {
  if (typeof s !== 'string') return null;
  const d = s.replace(/\D/g, '').replace(/^972/, '0');
  return /^05\d{8}$/.test(d) ? d : null;
}

/** Field names that may carry card data. They are dropped before anything is stored. */
const CARD_FIELD = /card|cvv|cvc|ccno|creditcard|expir|exp_?(month|year|date)/i;

/** Removes card-like fields at any depth. Everything else is kept so the format can be learned. */
export function stripCardFields(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripCardFields);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if (CARD_FIELD.test(k)) continue;
      out[k] = stripCardFields(v);
    }
    return out;
  }
  return value;
}
