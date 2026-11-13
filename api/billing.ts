/// <reference types="node" />
// Payments with Grow, through a Make scenario (no Grow API keys needed: Make holds the Grow connection).
//
//   POST /api/billing?action=checkout   { plan, period, fullName, phone }   (Bearer = the user's session)
//        → the server checks what this user may buy, opens an order, asks Make to create a Grow payment
//          page for exactly that order, and answers { url, orderId }. The browser goes to the url.
//   POST /api/billing?action=cancel     (Bearer)  → cancels the monthly subscription (no more charges on our
//        side; a super admin stops the standing order in Grow, see stopStandingOrder).
//   POST /api/billing/grow-webhook/<GROW_WEBHOOK_TOKEN>    (rewritten to action=webhook)
//        → Grow's notifications: first payment, monthly renewals, failed charges.
//
// Env (Vercel): SUPABASE_URL, SUPABASE_ANON_KEY (or the VITE_ ones), SUPABASE_SERVICE_ROLE_KEY,
//   GROW_WEBHOOK_TOKEN, GROW_ACCOUNT_WEBHOOK_TOKEN, MAKE_BILLING_WEBHOOK_URL, MAKE_BILLING_SECRET,
//   BILLING_SANDBOX=1 while testing. Selling to everyone is app_settings.billing_open (or BILLING_OPEN=1);
//   until then only testers (super admins + app_settings.billing_testers) can pay.
//   GROW_IP_CHECK=off only if Grow's addresses change and payments stop arriving.
import { env, json } from './_lib/member.js';
import {
  callerIp,
  GROW_IPS,
  MAX_WEBHOOK_BYTES,
  parseWebhookBody,
  readGrowNotice,
  stripCardFields,
  tokenMatches,
  validFullName,
  validPhone,
  type BillingPeriod,
  type BillingPlan,
  PERIODS,
  PLANS,
} from './_lib/billing.js';

const SUPABASE_URL = () => env('SUPABASE_URL') || env('VITE_SUPABASE_URL');
const ANON_KEY = () => env('SUPABASE_ANON_KEY') || env('VITE_SUPABASE_ANON_KEY');
const SERVICE_KEY = () => env('SUPABASE_SERVICE_ROLE_KEY');

const PLAN_TITLE: Record<BillingPlan, string> = { pro: 'Osintfront Pro', max: 'Osintfront Max' };
const PERIOD_TITLE: Record<BillingPeriod, string> = { monthly: 'מנוי חודשי מתחדש עד ביטול', yearly: 'מנוי שנתי' };

// ── Supabase (service role) ─────────────────────────────────────────────────────
function serviceHeaders(extra: Record<string, string> = {}): Record<string, string> {
  const key = SERVICE_KEY();
  return { apikey: key, ...(key.startsWith('sb_') ? {} : { authorization: `Bearer ${key}` }), 'content-type': 'application/json', ...extra };
}

async function rpc<T = Record<string, unknown>>(fn: string, args: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${SUPABASE_URL()}/rest/v1/rpc/${fn}`, { method: 'POST', headers: serviceHeaders(), body: JSON.stringify(args) });
  const text = await res.text();
  if (!res.ok) throw new Error(`${fn}: ${res.status} ${text.slice(0, 300)}`);
  return (text ? JSON.parse(text) : null) as T;
}

/** The signed-in user behind the Bearer token, with their role. */
async function sessionUser(req: Request): Promise<{ id: string; email: string; role: string; fullName: string } | null> {
  const token = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!token) return null;
  const res = await fetch(`${SUPABASE_URL()}/auth/v1/user`, { headers: { apikey: ANON_KEY(), authorization: `Bearer ${token}` } });
  if (!res.ok) return null;
  const u = (await res.json()) as { id?: string; email?: string };
  if (!u.id) return null;
  const p = await fetch(`${SUPABASE_URL()}/rest/v1/profiles?id=eq.${u.id}&select=role,status,full_name`, { headers: serviceHeaders() });
  const rows = p.ok ? ((await p.json()) as { role: string; status: string; full_name: string | null }[]) : [];
  if (!rows[0] || rows[0].status !== 'active') return null;
  return { id: u.id, email: u.email ?? '', role: rows[0].role, fullName: rows[0].full_name ?? '' };
}

// ── Make ────────────────────────────────────────────────────────────────────────
/** Calls the Make scenario. It answers with the Webhook response module: JSON { ok, … }. */
async function make(action: string, payload: Record<string, unknown>, timeoutMs = 25_000): Promise<Record<string, unknown>> {
  const url = env('MAKE_BILLING_WEBHOOK_URL');
  if (!url) throw new Error('make_not_configured');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ secret: env('MAKE_BILLING_SECRET'), action, ...payload }),
      signal: ctrl.signal,
    });
    const text = await res.text();
    let body: Record<string, unknown> = {};
    try {
      body = JSON.parse(text) as Record<string, unknown>;
    } catch {
      body = { ok: false, error: text.slice(0, 200) || `http_${res.status}` };
    }
    if (!res.ok && body.ok !== false) body = { ok: false, error: `http_${res.status}` };
    return body;
  } finally {
    clearTimeout(timer);
  }
}

/** The payment page address Make returned (Grow's field is data.url; Make may pass it on as-is). */
function pickUrl(r: Record<string, unknown>): string | null {
  const d = (r.data && typeof r.data === 'object' ? r.data : {}) as Record<string, unknown>;
  const u = [r.url, r.payment_url, d.url].find((x) => typeof x === 'string' && /^https:\/\//.test(x as string));
  return (u as string | undefined) ?? null;
}
function pickProcess(r: Record<string, unknown>): { id: string | null; token: string | null } {
  const d = (r.data && typeof r.data === 'object' ? r.data : {}) as Record<string, unknown>;
  const id = r.process_id ?? r.paymentLinkProcessId ?? d.paymentLinkProcessId;
  const token = r.process_token ?? r.paymentLinkProcessToken ?? d.paymentLinkProcessToken;
  return { id: id != null && id !== '' ? String(id) : null, token: token != null && token !== '' ? String(token) : null };
}

function siteOrigin(req: Request): string {
  return env('PUBLIC_SITE_URL') || new URL(req.url).origin;
}

// ── Actions ─────────────────────────────────────────────────────────────────────
async function checkout(req: Request): Promise<Response> {
  const user = await sessionUser(req);
  if (!user) return json({ error: 'signin_required' }, 401);
  // Until payments open to everyone (BILLING_OPEN=1), only testers may pay: super admins and the
  // emails listed in app_settings.billing_testers.
  const open = env('BILLING_OPEN') === '1' || (await rpc<boolean>('billing_is_open', {})) === true;
  if (!open && user.role !== 'super_admin' && (await rpc<boolean>('billing_is_tester', { p_user: user.id })) !== true) {
    return json({ error: 'not_open_yet' }, 403);
  }

  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return json({ error: 'bad_request' }, 400);
  }
  const plan = body.plan as BillingPlan;
  const period = body.period as BillingPeriod;
  if (!PLANS.includes(plan) || !PERIODS.includes(period)) return json({ error: 'bad_plan' }, 400);
  const fullName = validFullName(body.fullName);
  const phone = validPhone(body.phone);
  if (!fullName) return json({ error: 'bad_name' }, 400);
  if (!phone) return json({ error: 'bad_phone' }, 400);
  const back = body.returnTo === '/packages-test' ? '/packages-test' : '/packages';

  // The database decides what this user may buy and the price (never the browser).
  const order = await rpc<{ ok: boolean; reason?: string; order_id?: string; amount_agorot?: number; kind?: string; credit_days?: number }>(
    'billing_create_order',
    { p_user: user.id, p_plan: plan, p_period: period, p_sandbox: env('BILLING_SANDBOX') === '1' },
  );
  if (!order.ok || !order.order_id) return json({ error: order.reason ?? 'not_allowed' }, 409);

  const origin = siteOrigin(req);
  const r = await make('create', {
    sandbox: env('BILLING_SANDBOX') === '1',
    order_id: order.order_id,
    title: `${PLAN_TITLE[plan]} - ${PERIOD_TITLE[period]}`,
    product_name: `${PLAN_TITLE[plan]} ${period === 'yearly' ? '12 months' : 'monthly'}`,
    amount: (order.amount_agorot ?? 0) / 100,
    payment_type: period === 'monthly' ? 'recurring' : 'payments',
    full_name: fullName,
    phone,
    email: user.email,
    success_url: `${origin}${back}?order=${order.order_id}`,
    notify_url: `${origin}/api/billing/grow-webhook/${env('GROW_WEBHOOK_TOKEN')}`,
  }).catch((e: Error) => ({ ok: false, error: e.message }));

  const url = pickUrl(r);
  if (r.ok === false || !url) {
    await rpc('billing_order_failed', { p_order: order.order_id, p_reason: `make: ${String(r.error ?? 'no url')}` }).catch(() => {});
    return json({ error: 'payment_page_failed' }, 502);
  }
  const proc = pickProcess(r);
  await rpc('billing_attach_process', { p_order: order.order_id, p_process_id: proc.id, p_process_token: proc.token });
  return json({ url, orderId: order.order_id, kind: order.kind, creditDays: order.credit_days ?? 0 });
}

/**
 * Stops a standing order at Grow. Grow's Make app cannot do this (its "Make an API Call" module has no
 * Grow connection), so the subscription is cancelled here and a super admin stops the standing order in
 * the Grow dashboard (the admin panel on /packages-test lists it). The law allows 3 business days.
 */
async function stopStandingOrder(_o: Record<string, unknown>): Promise<{ ok: boolean; note: string }> {
  return { ok: false, note: 'stop the standing order in the Grow dashboard' };
}

async function cancel(req: Request): Promise<Response> {
  const user = await sessionUser(req);
  if (!user) return json({ error: 'signin_required' }, 401);
  const b = await rpc<Record<string, unknown>>('billing_cancel_begin', { p_user: user.id });
  if (!b.ok) return json({ error: b.reason ?? 'not_allowed' }, 409);
  const stop = await stopStandingOrder(b);
  await rpc('billing_cancel_done', { p_subscription: b.subscription_id, p_ok: stop.ok, p_note: stop.note });
  // Either way the subscription is cancelled on our side. If Grow did not confirm, an admin stops it by hand.
  return json({ ok: true, until: b.until, stoppedAtGrow: stop.ok });
}

async function webhook(req: Request, token: string | null): Promise<Response> {
  // Two addresses: GROW_WEBHOOK_TOKEN is in every payment link's notifyUrl; GROW_ACCOUNT_WEBHOOK_TOKEN is the
  // one Grow support sets for the account webhooks (monthly renewals and failed charges).
  const secret = env('GROW_WEBHOOK_TOKEN');
  const accountSecret = env('GROW_ACCOUNT_WEBHOOK_TOKEN');
  if (!secret || !SUPABASE_URL() || !SERVICE_KEY()) return json({ error: 'not_configured' }, 503);
  if (!tokenMatches(token, secret) && !tokenMatches(token, accountSecret)) return json({ error: 'forbidden' }, 403);

  const text = await req.text();
  if (Buffer.byteLength(text) > MAX_WEBHOOK_BYTES) return json({ error: 'too_large' }, 413);
  const contentType = req.headers.get('content-type');
  const raw = parseWebhookBody(contentType, text);
  const ip = callerIp(req.headers);
  const fromGrow = env('GROW_IP_CHECK') === 'off' || GROW_IPS.has(ip);

  // 1) Keep a copy (card fields removed), so nothing is lost even if applying fails.
  const stored = await fetch(`${SUPABASE_URL()}/rest/v1/billing_webhook_inbox?select=id`, {
    method: 'POST',
    headers: serviceHeaders({ prefer: 'return=representation' }),
    body: JSON.stringify({ source: fromGrow ? 'grow' : `grow?ip=${ip}`.slice(0, 60), content_type: contentType?.slice(0, 120) ?? null, body: stripCardFields(raw) }),
  });
  if (!stored.ok) return json({ error: 'store_failed' }, 500); // Grow sends it again later
  const inboxId = ((await stored.json()) as { id: number }[])[0]?.id;
  // Not from Grow's servers: kept for a person to look at, never applied.
  if (!fromGrow) return json({ ok: true, held: true });

  // 2) Apply it.
  const n = readGrowNotice(raw);
  const payload = stripCardFields(raw) as Record<string, unknown>;
  try {
    if (n.type === 'payment') {
      const r = await rpc<Record<string, unknown>>('billing_pay_order', {
        p_event_key: n.eventKey,
        p_order: n.orderId,
        p_process_id: n.processId,
        p_paid: n.paid,
        p_transaction_id: n.transactionId,
        p_transaction_token: n.transactionToken,
        p_asmachta: n.asmachta,
        p_amount_agorot: n.amountAgorot,
        p_phone: n.phone,
        p_email: n.email,
        p_status_text: n.statusText,
        p_payload: payload,
      });
      // A new charge on an order that is already paid = the standing order charged again (a later month),
      // if Grow reports it to the payment link's notifyUrl too. It is applied as a renewal.
      if (r.duplicate === true && r.user_id && n.paid && n.transactionId) {
        await rpc('billing_renewal', {
          p_event_key: `ren:${n.transactionId}`, p_direct_debit_id: n.directDebitId, p_transaction_id: n.transactionId,
          p_amount_agorot: n.amountAgorot, p_phone: n.phone, p_email: n.email, p_payload: payload,
        });
      }
      // The first monthly payment names its standing order: remember it, so renewals and failed charges
      // are matched by that id (not by phone and price).
      if (r.paid === true && n.directDebitId && n.transactionId) {
        await fetch(`${SUPABASE_URL()}/rest/v1/billing_subscriptions?grow_transaction_id=eq.${encodeURIComponent(n.transactionId)}&grow_subscription_id=is.null`, {
          method: 'PATCH',
          headers: serviceHeaders({ prefer: 'return=minimal' }),
          body: JSON.stringify({ grow_subscription_id: n.directDebitId }),
        }).catch(() => {});
      }
      // Grow resends an unacknowledged notification after about 10, 20 and 30 minutes; billing_pay_order is
      // idempotent, so a repeat changes nothing.
      // An upgrade replaced a monthly plan: its standing order at Grow is stopped so it is not charged again.
      const old = r.cancel_old as Record<string, unknown> | null;
      if (old) {
        const stop = await stopStandingOrder(old);
        await rpc('billing_cancel_done', { p_subscription: old.subscription_id, p_ok: stop.ok, p_note: stop.note }).catch(() => {});
      }
    } else if (n.type === 'renewal') {
      await rpc('billing_renewal', {
        p_event_key: n.eventKey, p_direct_debit_id: n.directDebitId, p_transaction_id: n.transactionId,
        p_amount_agorot: n.amountAgorot, p_phone: n.phone, p_email: n.email, p_payload: payload,
      });
    } else if (n.type === 'failed') {
      await rpc('billing_failed', {
        p_event_key: n.eventKey, p_direct_debit_id: n.directDebitId, p_amount_agorot: n.amountAgorot,
        p_phone: n.phone, p_email: n.email, p_error: n.error, p_attempts: n.attempts, p_payload: payload,
      });
    } else {
      return json({ ok: true, ignored: true }); // kept in the inbox
    }
  } catch (e) {
    console.error('billing webhook', (e as Error).message);
    return json({ error: 'apply_failed' }, 500); // Grow retries; billing functions are idempotent
  }
  if (inboxId) {
    await fetch(`${SUPABASE_URL()}/rest/v1/billing_webhook_inbox?id=eq.${inboxId}`, {
      method: 'PATCH', headers: serviceHeaders({ prefer: 'return=minimal' }), body: JSON.stringify({ processed_at: new Date().toISOString() }),
    }).catch(() => {});
  }
  return json({ ok: true });
}

export async function POST(req: Request): Promise<Response> {
  const q = new URL(req.url).searchParams;
  const action = q.get('action');
  if (!SUPABASE_URL() || !SERVICE_KEY()) return json({ error: 'not_configured' }, 503);
  try {
    if (action === 'checkout') return await checkout(req);
    if (action === 'cancel') return await cancel(req);
    if (action === 'webhook') return await webhook(req, q.get('token'));
  } catch (e) {
    console.error('billing', action, (e as Error).message);
    return json({ error: 'server_error' }, 500);
  }
  return json({ error: 'not_found' }, 404);
}
