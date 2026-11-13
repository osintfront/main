-- Billing checkout checks (migration 20261113000123). Run as: begin; <this file>; rollback;
-- Covers: what a user may buy (same plan / lower / upgrade with credit / yearly renewal), the first
-- payment by order, duplicates, amount mismatch, renewal matched by phone, failed charge, cancel.
do $$
declare
  u uuid := gen_random_uuid();
  o jsonb; r jsonb; q jsonb; p record; s record;
  oid uuid;
begin
  -- Grants
  assert not has_function_privilege('authenticated', 'public.billing_create_order(uuid,text,text,boolean)', 'execute'), 'members must not create orders directly';
  assert not has_function_privilege('authenticated', 'public.billing_pay_order(text,uuid,text,boolean,text,text,text,int,text,text,text,jsonb)', 'execute'), 'members must not mark orders paid';
  assert has_function_privilege('authenticated', 'public.billing_options()', 'execute'), 'members read their options';
  assert not has_column_privilege('authenticated', 'public.billing_subscriptions', 'grow_transaction_token', 'select'), 'members never read Grow tokens';
  assert public.billing_price('pro', 'monthly') = 5900 and public.billing_price('max', 'yearly') = 129000, 'prices';

  insert into auth.users (id, email) values (u, 'billing-checkout-test@example.invalid');
  assert (select plan from public.profiles where id = u) = 'free', 'test user starts on Free';

  -- Free: everything may be bought
  q := public._billing_quote(u, 'pro', 'monthly');
  assert (q->>'allowed')::boolean and q->>'kind' = 'new' and (q->>'amount_agorot')::int = 5900, 'free user may buy Pro monthly';

  -- Buy Pro monthly
  o := public.billing_create_order(u, 'pro', 'monthly', true);
  oid := (o->>'order_id')::uuid;
  perform public.billing_attach_process(oid, 'pl-1', 'pltok-1');
  -- A second click opens a new order and closes the first
  o := public.billing_create_order(u, 'pro', 'monthly', true);
  assert (select status from public.billing_orders where id = oid) = 'abandoned', 'older open order is closed';
  oid := (o->>'order_id')::uuid;
  perform public.billing_attach_process(oid, 'pl-2', 'pltok-2');

  -- Wrong amount: nothing granted, flagged
  r := public.billing_pay_order('pay:bad', oid, 'pl-2', true, 'tx-bad', 't', 'a', 100, '0501111111', 'a@b.co', 'שולם');
  assert (r->>'reason') = 'amount_mismatch', 'amount mismatch is refused';
  assert (select plan from public.profiles where id = u) = 'free', 'no plan on a wrong amount';

  -- Correct payment (matched by process id, no order id in the notification)
  o := public.billing_create_order(u, 'pro', 'monthly', true);
  oid := (o->>'order_id')::uuid;
  perform public.billing_attach_process(oid, 'pl-3', 'pltok-3');
  r := public.billing_pay_order('pay:tx-1', null, 'pl-3', true, 'tx-1', 'tok-1', 'asm-1', 5900, '972-50-1111111', 'A@B.co', 'שולם');
  assert (r->>'paid')::boolean, 'payment applied';
  select plan, plan_source, billing_period, plan_expires_at into p from public.profiles where id = u;
  assert p.plan = 'pro' and p.plan_source = 'paid' and p.billing_period = 'monthly', 'user is on paid Pro monthly';
  assert p.plan_expires_at > now() + interval '32 days', 'monthly access includes the grace days';
  select * into s from public.billing_subscriptions where user_id = u and status = 'active';
  assert s.payer_phone = '0501111111' and s.payer_email = 'a@b.co', 'payer phone/email normalised';

  -- Same notification again: nothing changes
  r := public.billing_pay_order('pay:tx-1', null, 'pl-3', true, 'tx-1', 'tok-1', 'asm-1', 5900, '0501111111', 'a@b.co', 'שולם');
  assert (r->>'duplicate')::boolean, 'duplicate notification';
  assert (select count(*) from public.billing_payments where user_id = u) = 1, 'one payment recorded';

  -- Same plan cannot be bought again; Max is an upgrade with credit
  q := public._billing_quote(u, 'pro', 'monthly');
  assert not (q->>'allowed')::boolean and q->>'reason' = 'current_plan', 'same plan is not for sale';
  q := public._billing_quote(u, 'pro', 'yearly');
  assert not (q->>'allowed')::boolean, 'switching Pro monthly to yearly is not offered';
  q := public._billing_quote(u, 'max', 'monthly');
  assert (q->>'allowed')::boolean and q->>'kind' = 'upgrade', 'Max is an upgrade';
  assert (q->>'credit_days')::numeric between 12 and 15, 'a full month of Pro (59) is about 13.7 days of Max (129)';

  -- First renewal arrives with a standing-order id, matched by phone + price, then remembered
  r := public.billing_renewal('ren:R1', '777', 'R1', 5900, '0501111111', null);
  assert (r->>'ok')::boolean, 'renewal matched';
  assert (select grow_subscription_id from public.billing_subscriptions where id = s.id) = '777', 'standing order id remembered';
  assert (select current_period_end from public.billing_subscriptions where id = s.id) > s.current_period_end + interval '27 days', 'renewal adds a month';
  r := public.billing_renewal('ren:R1', '777', 'R1', 5900, '0501111111', null);
  assert (r->>'duplicate')::boolean, 'renewal applied once';

  -- Failed charge: past_due, access through the grace days
  r := public.billing_failed('fail:777:1:x', '777', 5900, '0501111111', null, 'פג תוקף', 1);
  assert (select status from public.billing_subscriptions where id = s.id) = 'past_due', 'failed charge → past_due';
  q := public._billing_quote(u, 'pro', 'monthly');
  assert (q->>'allowed')::boolean and q->>'kind' = 'replace', 'a past_due user may pay again with another card';

  -- Upgrade to Max: the Pro subscription ends and its standing order is handed back to stop at Grow
  o := public.billing_create_order(u, 'max', 'monthly', true);
  oid := (o->>'order_id')::uuid;
  perform public.billing_attach_process(oid, 'pl-4', 'pltok-4');
  r := public.billing_pay_order('pay:tx-2', oid, 'pl-4', true, 'tx-2', 'tok-2', 'asm-2', 12900, '0501111111', null, 'שולם');
  assert (r->>'paid')::boolean, 'upgrade paid';
  assert (r->'cancel_old'->>'transaction_id') = 'tx-1', 'old standing order returned to stop';
  assert (select status from public.billing_subscriptions where id = s.id) = 'ended', 'Pro subscription ended';
  assert (select plan from public.profiles where id = u) = 'max', 'user is on Max';
  q := public._billing_quote(u, 'pro', 'yearly');
  assert not (q->>'allowed')::boolean and q->>'reason' = 'lower_plan', 'Pro is not offered to a Max user';

  -- A charge on the old (ended) Pro order is flagged for a person
  r := public.billing_renewal('ren:R2', '777', 'R2', 5900, '0501111111', null);
  assert r->>'reason' = 'charged_after_cancel', 'charge after replacement is flagged';

  -- Cancel Max monthly: no more renewals, access until the paid month ends (no grace)
  r := public.billing_cancel_begin(u);
  assert (r->>'ok')::boolean and r->>'transaction_id' = 'tx-2', 'cancel returns the standing order to stop';
  perform public.billing_cancel_done((r->>'subscription_id')::uuid, true, 'test');
  select * into s from public.billing_subscriptions where id = (r->>'subscription_id')::uuid;
  assert s.status = 'canceled' and s.cancel_state = 'done', 'subscription cancelled';
  assert (select plan_expires_at from public.profiles where id = u) = s.current_period_end, 'access ends with the paid month';

  -- Declined first payment: order failed, nothing granted
  insert into auth.users (id, email) values (gen_random_uuid(), 'billing-checkout-test2@example.invalid');
  o := public.billing_create_order((select id from auth.users where email = 'billing-checkout-test2@example.invalid'), 'pro', 'yearly', true);
  r := public.billing_pay_order('pay:pl-9', (o->>'order_id')::uuid, null, false, null, null, null, 59000, null, null, 'נדחה');
  assert (select status from public.billing_orders where id = (o->>'order_id')::uuid) = 'failed', 'declined order failed';
  assert (select plan from public.profiles where id = (select id from auth.users where email = 'billing-checkout-test2@example.invalid')) = 'free', 'declined → still Free';

  raise notice 'ALL BILLING CHECKOUT CHECKS PASSED';
end $$;
