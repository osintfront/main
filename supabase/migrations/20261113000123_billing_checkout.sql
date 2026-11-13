-- Billing checkout with Grow (through Make): what a user may buy, orders, the first payment,
-- monthly renewals, failed charges and cancellation.
--
-- Rules (Israeli Consumer Protection Law, section 13א):
--  * Monthly = an open-ended standing order, cancellable at any time. It has no end date, so it
--    renews by itself without breaking the "fixed-term contracts may not auto-renew" rule.
--  * Yearly  = paid once. It never renews by itself; near the end the user is offered a renewal.
--
-- What a user may buy:
--  * Nothing on a paid plan     -> any paid plan.
--  * Same plan                  -> nothing ("current plan"). Exception: yearly in its last 30 days -> renew.
--                                  A monthly plan whose last charge failed -> pay again with a new card (replace).
--  * Lower plan (Max -> Pro)    -> not offered.
--  * Higher plan (Pro -> Max)   -> upgrade. The value left on Pro becomes extra days on Max.
-- The browser only asks; these functions decide.

-- ── Prices (agorot, VAT included) ──────────────────────────────────────────────
-- Must match SERVER_PRICES in api/_lib/billing.ts and INTRO_PRICES in src/content/packages.ts.
create or replace function public.billing_price(p_plan text, p_period text) returns int
language sql immutable set search_path = '' as $$
  select case p_plan || ':' || p_period
    when 'pro:monthly' then 5900
    when 'pro:yearly'  then 59000
    when 'max:monthly' then 12900
    when 'max:yearly'  then 129000
  end
$$;
grant execute on function public.billing_price(text, text) to anon, authenticated, service_role;

-- Monthly access lasts this long after the paid month, so a renewal that arrives a little late
-- never drops the user to Free for a few hours.
create or replace function public.billing_grace() returns interval
language sql immutable set search_path = '' as $$ select interval '3 days' $$;

-- ── Columns for the checkout flow ──────────────────────────────────────────────
alter table public.billing_orders
  add column if not exists kind text not null default 'new',
  add column if not exists from_plan text,
  add column if not exists from_subscription uuid references public.billing_subscriptions(id),
  add column if not exists credit_days numeric not null default 0,
  add column if not exists grow_process_token text,
  add column if not exists failure_reason text,
  add column if not exists sandbox boolean not null default false;
alter table public.billing_orders drop constraint if exists billing_orders_kind_check;
alter table public.billing_orders add constraint billing_orders_kind_check check (kind in ('new', 'upgrade', 'renew', 'replace'));

alter table public.billing_subscriptions
  add column if not exists grow_transaction_id text,
  add column if not exists grow_transaction_token text,
  add column if not exists grow_asmachta text,
  add column if not exists payer_phone text,
  add column if not exists payer_email text,
  add column if not exists cancel_state text not null default 'none',
  add column if not exists canceled_at timestamptz;
alter table public.billing_subscriptions drop constraint if exists billing_subscriptions_cancel_state_check;
alter table public.billing_subscriptions add constraint billing_subscriptions_cancel_state_check
  check (cancel_state in ('none', 'pending', 'done', 'failed'));
create index if not exists billing_subscriptions_payer_phone on public.billing_subscriptions (payer_phone) where grow_subscription_id is null;

-- Members read their own rows, but never Grow's transaction tokens or the payer details.
revoke select on public.billing_orders, public.billing_subscriptions from authenticated;
grant select (id, user_id, plan, period, amount_agorot, currency, status, kind, from_plan, credit_days, failure_reason, created_at, paid_at)
  on public.billing_orders to authenticated;
grant select (id, user_id, plan, period, status, current_period_end, cancel_at_period_end, cancel_state, canceled_at, failed_attempts, created_at, updated_at)
  on public.billing_subscriptions to authenticated;

-- Notifications that need a person (unknown payer, a charge after cancelling, …).
alter table public.billing_events add column if not exists note text;

-- ── Phone numbers are compared as digits, with 972 turned back into 0 ───────────
create or replace function public.billing_phone(p text) returns text
language sql immutable set search_path = '' as $$
  select nullif(regexp_replace(regexp_replace(coalesce(p, ''), '\D', '', 'g'), '^972', '0'), '')
$$;

-- ── The quote: may this user buy this plan, and on what terms ───────────────────
create or replace function public._billing_quote(p_user uuid, p_plan text, p_period text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  me record;
  sub public.billing_subscriptions%rowtype;
  price int := public.billing_price(p_plan, p_period);
  cur_period text;
  cur_end timestamptz;
  cur_price int;
  value_left numeric;
  credit numeric := 0;
  rank_cur int;
  rank_new int;
  paid_active boolean;
  no jsonb := jsonb_build_object('allowed', false);
begin
  if price is null then return no || jsonb_build_object('reason', 'bad_plan'); end if;
  select plan, plan_source, plan_expires_at, billing_period into me from public.profiles where id = p_user;
  if not found then return no || jsonb_build_object('reason', 'no_profile'); end if;
  if me.plan = 'intel' then return no || jsonb_build_object('reason', 'custom_plan'); end if;

  select * into sub from public.billing_subscriptions where user_id = p_user and status in ('active', 'past_due') limit 1;
  paid_active := me.plan_source = 'paid' and me.plan in ('pro', 'max') and (me.plan_expires_at is null or me.plan_expires_at > now());

  if not paid_active then
    return jsonb_build_object('allowed', true, 'kind', 'new', 'amount_agorot', price, 'credit_days', 0);
  end if;

  rank_cur := case me.plan when 'pro' then 1 else 2 end;
  rank_new := case p_plan when 'pro' then 1 else 2 end;
  cur_period := coalesce(sub.period, me.billing_period, 'monthly');
  cur_end := coalesce(sub.current_period_end, me.plan_expires_at);

  if rank_new < rank_cur then
    return no || jsonb_build_object('reason', 'lower_plan', 'current_plan', me.plan, 'current_period', cur_period);
  end if;

  if rank_new = rank_cur then
    if sub.id is not null and sub.status = 'past_due' and p_period = sub.period then
      return jsonb_build_object('allowed', true, 'kind', 'replace', 'amount_agorot', price, 'credit_days', 0,
                                'from_subscription', sub.id, 'from_plan', me.plan);
    end if;
    if cur_period = 'yearly' and p_period = 'yearly' and cur_end < now() + interval '30 days' then
      return jsonb_build_object('allowed', true, 'kind', 'renew', 'amount_agorot', price, 'credit_days', 0,
                                'from_subscription', sub.id, 'from_plan', me.plan, 'renews_from', cur_end);
    end if;
    return no || jsonb_build_object('reason', 'current_plan', 'current_plan', me.plan, 'current_period', cur_period, 'current_end', cur_end);
  end if;

  -- Upgrade: what is left of the current paid period, in shekels, becomes days on the new plan.
  cur_price := public.billing_price(me.plan, cur_period);
  if cur_price is not null and cur_end is not null and cur_end > now() then
    value_left := cur_price * least(1, extract(epoch from (cur_end - now()))
                  / extract(epoch from case when cur_period = 'yearly' then interval '1 year' else interval '1 month' end));
    credit := round(value_left / (price::numeric / (extract(epoch from case when p_period = 'yearly' then interval '1 year' else interval '1 month' end) / 86400)), 1);
  end if;
  return jsonb_build_object('allowed', true, 'kind', 'upgrade', 'amount_agorot', price, 'credit_days', credit,
                            'from_subscription', sub.id, 'from_plan', me.plan, 'from_period', cur_period);
end $$;
revoke all on function public._billing_quote(uuid, text, text) from public, anon, authenticated;

-- What the signed-in user may buy, and their subscription (for the packages page).
create or replace function public.billing_options() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare u uuid := auth.uid(); sub record; me record;
begin
  if u is null then return jsonb_build_object('signed_in', false); end if;
  select plan, plan_source, plan_expires_at, billing_period into me from public.profiles where id = u;
  select id, plan, period, status, current_period_end, cancel_at_period_end, cancel_state, failed_attempts
    into sub from public.billing_subscriptions
   where user_id = u and (status in ('active', 'past_due') or (status = 'canceled' and current_period_end > now()))
   order by created_at desc limit 1;
  return jsonb_build_object(
    'signed_in', true,
    'plan', me.plan, 'plan_source', me.plan_source, 'plan_expires_at', me.plan_expires_at, 'billing_period', me.billing_period,
    'subscription', case when sub.id is null then null else to_jsonb(sub) end,
    'options', jsonb_build_object(
      'pro_monthly', public._billing_quote(u, 'pro', 'monthly'),
      'pro_yearly',  public._billing_quote(u, 'pro', 'yearly'),
      'max_monthly', public._billing_quote(u, 'max', 'monthly'),
      'max_yearly',  public._billing_quote(u, 'max', 'yearly')));
end $$;
revoke all on function public.billing_options() from public, anon;
grant execute on function public.billing_options() to authenticated;

-- ── Orders ─────────────────────────────────────────────────────────────────────
-- Called by the checkout API (service role) before asking Grow for a payment page.
create or replace function public.billing_create_order(p_user uuid, p_plan text, p_period text, p_sandbox boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare q jsonb; oid uuid;
begin
  q := public._billing_quote(p_user, p_plan, p_period);
  if not (q ->> 'allowed')::boolean then
    return jsonb_build_object('ok', false, 'reason', q ->> 'reason');
  end if;
  -- One open order per user: an older unpaid one is closed.
  update public.billing_orders set status = 'abandoned' where user_id = p_user and status = 'pending';
  insert into public.billing_orders (user_id, plan, period, amount_agorot, kind, from_plan, from_subscription, credit_days, sandbox)
  values (p_user, p_plan, p_period, (q ->> 'amount_agorot')::int, q ->> 'kind', q ->> 'from_plan',
          nullif(q ->> 'from_subscription', '')::uuid, coalesce((q ->> 'credit_days')::numeric, 0), coalesce(p_sandbox, false))
  returning id into oid;
  return jsonb_build_object('ok', true, 'order_id', oid, 'amount_agorot', (q ->> 'amount_agorot')::int,
                            'kind', q ->> 'kind', 'credit_days', coalesce((q ->> 'credit_days')::numeric, 0));
end $$;

create or replace function public.billing_attach_process(p_order uuid, p_process_id text, p_process_token text)
returns void language sql security definer set search_path = '' as $$
  update public.billing_orders set grow_process_id = p_process_id, grow_process_token = p_process_token
   where id = p_order and status = 'pending';
$$;

-- Grow could not open a payment page: the order is closed with the reason.
create or replace function public.billing_order_failed(p_order uuid, p_reason text)
returns void language sql security definer set search_path = '' as $$
  update public.billing_orders set status = 'failed', failure_reason = left(p_reason, 200)
   where id = p_order and status = 'pending';
$$;

-- ── First payment (Grow notification for a payment link) ────────────────────────
create or replace function public.billing_pay_order(
  p_event_key text,
  p_order uuid,
  p_process_id text,
  p_paid boolean,
  p_transaction_id text,
  p_transaction_token text,
  p_asmachta text,
  p_amount_agorot int,
  p_phone text,
  p_email text,
  p_status_text text,
  p_payload jsonb default '{}'::jsonb
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  o public.billing_orders%rowtype;
  old public.billing_subscriptions%rowtype;
  sub public.billing_subscriptions%rowtype;
  me record;
  base timestamptz := now();
  new_end timestamptz;
  ins int;
  cancel_old jsonb := null;
begin
  insert into public.billing_events (event_key, kind, payload) values (p_event_key, 'payment', coalesce(p_payload, '{}'::jsonb))
  on conflict (event_key) do nothing;
  get diagnostics ins = row_count;
  if ins = 0 then return jsonb_build_object('ok', true, 'duplicate', true); end if;

  if p_order is not null then
    select * into o from public.billing_orders where id = p_order for update;
  end if;
  if o.id is null and p_process_id is not null then
    select * into o from public.billing_orders where grow_process_id = p_process_id for update;
  end if;
  if o.id is null then
    update public.billing_events set outcome = 'unmatched', note = 'no order for this payment' where event_key = p_event_key;
    return jsonb_build_object('ok', false, 'reason', 'unknown_order');
  end if;
  update public.billing_events set user_id = o.user_id where event_key = p_event_key;

  if o.status = 'paid' then
    update public.billing_events set outcome = 'duplicate' where event_key = p_event_key;
    return jsonb_build_object('ok', true, 'duplicate', true, 'user_id', o.user_id);
  end if;

  if not p_paid then
    update public.billing_orders set status = 'failed', failure_reason = left(coalesce(nullif(p_status_text, ''), 'not paid'), 200)
     where id = o.id and status in ('pending', 'abandoned');
    update public.billing_events set outcome = 'not_paid' where event_key = p_event_key;
    return jsonb_build_object('ok', true, 'paid', false, 'user_id', o.user_id);
  end if;

  if p_transaction_id is null then raise exception 'transaction id required'; end if;
  if p_amount_agorot is distinct from o.amount_agorot then
    -- Money was taken, but not the amount we asked for: a person decides (refund or fix by hand).
    update public.billing_orders set status = 'failed', failure_reason = 'amount_mismatch' where id = o.id;
    update public.billing_events set outcome = 'amount_mismatch',
      note = format('expected %s agorot, got %s', o.amount_agorot, p_amount_agorot) where event_key = p_event_key;
    return jsonb_build_object('ok', false, 'reason', 'amount_mismatch', 'user_id', o.user_id);
  end if;

  select plan, plan_source, plan_expires_at into me from public.profiles where id = o.user_id for update;

  -- The subscription this payment replaces (upgrade / new card / yearly renewal).
  if o.from_subscription is not null then
    select * into old from public.billing_subscriptions where id = o.from_subscription for update;
  end if;
  if o.kind = 'renew' then
    base := greatest(now(), coalesce(old.current_period_end, me.plan_expires_at, now()));
  end if;
  new_end := base + case when o.period = 'yearly' then interval '1 year' else interval '1 month' end
                  + make_interval(secs => (o.credit_days * 86400)::double precision);

  -- Any other live subscription ends now (one live subscription per user).
  -- A monthly one still has a standing order at Grow: it is returned so the caller stops it there.
  for old in select * from public.billing_subscriptions
              where user_id = o.user_id and status in ('active', 'past_due', 'canceled')
                and (status <> 'canceled' or current_period_end > now())
              for update loop
    update public.billing_subscriptions set status = 'ended', updated_at = now(), last_event_at = now() where id = old.id;
    if old.period = 'monthly' and old.grow_transaction_id is not null and old.cancel_state not in ('done') then
      cancel_old := jsonb_build_object('subscription_id', old.id, 'transaction_id', old.grow_transaction_id,
                                       'transaction_token', old.grow_transaction_token, 'asmachta', old.grow_asmachta,
                                       'direct_debit_id', old.grow_subscription_id);
      update public.billing_subscriptions set cancel_state = 'pending', canceled_at = now() where id = old.id;
    end if;
  end loop;

  insert into public.billing_subscriptions
    (user_id, plan, period, status, current_period_end, last_event_at,
     grow_transaction_id, grow_transaction_token, grow_asmachta, payer_phone, payer_email)
  values (o.user_id, o.plan, o.period, 'active', new_end, now(),
          p_transaction_id, p_transaction_token, p_asmachta, public.billing_phone(p_phone), lower(nullif(trim(p_email), '')))
  returning * into sub;

  perform public._plan_set(o.user_id, o.plan, 'paid',
    new_end + case when o.period = 'monthly' then public.billing_grace() else interval '0' end,
    'billing_' || o.kind, jsonb_build_object('order', o.id, 'transaction', p_transaction_id, 'credit_days', o.credit_days), o.period);

  insert into public.billing_payments (grow_transaction_id, order_id, subscription_id, user_id, kind, amount_agorot)
  values (p_transaction_id, o.id, sub.id, o.user_id, 'payment', p_amount_agorot)
  on conflict (grow_transaction_id) do nothing;

  update public.billing_orders set status = 'paid', paid_at = now() where id = o.id;

  return jsonb_build_object('ok', true, 'paid', true, 'user_id', o.user_id, 'plan', o.plan, 'period', o.period,
                            'until', new_end, 'cancel_old', cancel_old);
end $$;

-- ── Monthly renewals (Grow's account webhook, from the second charge on) ────────
-- Grow names the standing order (directDebitId). The first payment does not carry it, so the first
-- renewal is matched by payer phone + monthly price, and the id is remembered from then on.
create or replace function public._billing_find_sub(p_direct_debit_id text, p_phone text, p_email text, p_amount_agorot int)
returns uuid language plpgsql security definer set search_path = '' as $$
declare sid uuid;
begin
  if nullif(p_direct_debit_id, '') is not null then
    select id into sid from public.billing_subscriptions where grow_subscription_id = p_direct_debit_id;
    if sid is not null then return sid; end if;
  end if;
  select id into sid from public.billing_subscriptions s
   where s.period = 'monthly' and s.grow_subscription_id is null
     and (public.billing_phone(p_phone) is not null and s.payer_phone = public.billing_phone(p_phone)
          or nullif(trim(p_email), '') is not null and s.payer_email = lower(trim(p_email)))
     and (p_amount_agorot is null or public.billing_price(s.plan, 'monthly') = p_amount_agorot)
   order by (s.status in ('active', 'past_due')) desc, s.created_at desc
   limit 1;
  if sid is not null and nullif(p_direct_debit_id, '') is not null then
    update public.billing_subscriptions set grow_subscription_id = p_direct_debit_id where id = sid;
  end if;
  return sid;
end $$;

create or replace function public.billing_renewal(
  p_event_key text, p_direct_debit_id text, p_transaction_id text, p_amount_agorot int,
  p_phone text, p_email text, p_payload jsonb default '{}'::jsonb
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare sub public.billing_subscriptions%rowtype; sid uuid; ins int; new_end timestamptz;
begin
  insert into public.billing_events (event_key, kind, payload) values (p_event_key, 'renewal', coalesce(p_payload, '{}'::jsonb))
  on conflict (event_key) do nothing;
  get diagnostics ins = row_count;
  if ins = 0 then return jsonb_build_object('ok', true, 'duplicate', true); end if;

  sid := public._billing_find_sub(p_direct_debit_id, p_phone, p_email, p_amount_agorot);
  if sid is null then
    update public.billing_events set outcome = 'unmatched', note = 'renewal for an unknown standing order' where event_key = p_event_key;
    return jsonb_build_object('ok', false, 'reason', 'unknown_subscription');
  end if;
  select * into sub from public.billing_subscriptions where id = sid for update;
  update public.billing_events set user_id = sub.user_id where event_key = p_event_key;

  if sub.status not in ('active', 'past_due') then
    -- Charged although the subscription was cancelled or replaced: a person refunds it and stops the order at Grow.
    update public.billing_events set outcome = 'charged_after_cancel', note = 'refund and stop the standing order in Grow'
     where event_key = p_event_key;
    insert into public.billing_payments (grow_transaction_id, subscription_id, user_id, kind, amount_agorot)
    values (coalesce(p_transaction_id, p_event_key), sub.id, sub.user_id, 'renewal', coalesce(p_amount_agorot, 0))
    on conflict (grow_transaction_id) do nothing;
    return jsonb_build_object('ok', false, 'reason', 'charged_after_cancel', 'user_id', sub.user_id);
  end if;

  new_end := greatest(sub.current_period_end, now()) + interval '1 month';
  update public.billing_subscriptions
     set status = 'active', current_period_end = new_end, failed_attempts = 0, last_event_at = now(), updated_at = now()
   where id = sub.id;
  perform public._plan_set(sub.user_id, sub.plan, 'paid', new_end + public.billing_grace(), 'billing_renewal',
    jsonb_build_object('transaction', p_transaction_id), 'monthly');
  insert into public.billing_payments (grow_transaction_id, subscription_id, user_id, kind, amount_agorot)
  values (coalesce(p_transaction_id, p_event_key), sub.id, sub.user_id, 'renewal', coalesce(p_amount_agorot, 0))
  on conflict (grow_transaction_id) do nothing;
  if p_amount_agorot is distinct from public.billing_price(sub.plan, 'monthly') then
    update public.billing_events set note = format('amount %s, price %s', p_amount_agorot, public.billing_price(sub.plan, 'monthly'))
     where event_key = p_event_key;
  end if;
  return jsonb_build_object('ok', true, 'user_id', sub.user_id, 'until', new_end);
end $$;

-- ── A monthly charge failed (Grow keeps retrying for a few days) ───────────────
create or replace function public.billing_failed(
  p_event_key text, p_direct_debit_id text, p_amount_agorot int, p_phone text, p_email text,
  p_error text, p_attempts int, p_payload jsonb default '{}'::jsonb
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare sub public.billing_subscriptions%rowtype; sid uuid; ins int;
begin
  insert into public.billing_events (event_key, kind, payload) values (p_event_key, 'failed', coalesce(p_payload, '{}'::jsonb))
  on conflict (event_key) do nothing;
  get diagnostics ins = row_count;
  if ins = 0 then return jsonb_build_object('ok', true, 'duplicate', true); end if;

  sid := public._billing_find_sub(p_direct_debit_id, p_phone, p_email, p_amount_agorot);
  if sid is null then
    update public.billing_events set outcome = 'unmatched', note = 'failed charge for an unknown standing order' where event_key = p_event_key;
    return jsonb_build_object('ok', false, 'reason', 'unknown_subscription');
  end if;
  select * into sub from public.billing_subscriptions where id = sid for update;
  update public.billing_events set user_id = sub.user_id, note = left(p_error, 200) where event_key = p_event_key;
  if sub.status not in ('active', 'past_due') then
    return jsonb_build_object('ok', true, 'ignored', true);
  end if;
  update public.billing_subscriptions
     set status = 'past_due', failed_attempts = greatest(failed_attempts + 1, coalesce(p_attempts, 0)),
         last_event_at = now(), updated_at = now()
   where id = sub.id;
  -- Access continues until the paid month ends plus the grace days, then expire_plans moves the user to Free.
  perform public._plan_set(sub.user_id, sub.plan, 'paid', sub.current_period_end + public.billing_grace(), 'billing_failed',
    jsonb_build_object('error', left(p_error, 200), 'attempts', p_attempts), sub.period);
  return jsonb_build_object('ok', true, 'user_id', sub.user_id);
end $$;

-- ── Cancel (the user's own button, as section 14ט requires for online sign-ups) ──
-- Step 1: the subscription stops renewing here; access stays until the paid month ends.
-- The caller then stops the standing order at Grow and reports the result with billing_cancel_done.
create or replace function public.billing_cancel_begin(p_user uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare sub public.billing_subscriptions%rowtype;
begin
  select * into sub from public.billing_subscriptions where user_id = p_user and status in ('active', 'past_due') limit 1 for update;
  if sub.id is null then return jsonb_build_object('ok', false, 'reason', 'no_subscription'); end if;
  if sub.period <> 'monthly' then return jsonb_build_object('ok', false, 'reason', 'yearly_does_not_renew'); end if;
  update public.billing_subscriptions
     set status = 'canceled', cancel_at_period_end = true, cancel_state = 'pending', canceled_at = now(),
         last_event_at = now(), updated_at = now()
   where id = sub.id;
  -- No grace after a cancellation: access ends with the paid month.
  perform public._plan_set(p_user, sub.plan, 'paid', greatest(sub.current_period_end, now()), 'billing_canceled', '{}', sub.period);
  insert into public.billing_events (event_key, kind, user_id, payload) values ('cancel:' || sub.id, 'canceled', p_user, '{}')
  on conflict (event_key) do nothing;
  return jsonb_build_object('ok', true, 'subscription_id', sub.id, 'until', sub.current_period_end,
    'transaction_id', sub.grow_transaction_id, 'transaction_token', sub.grow_transaction_token,
    'asmachta', sub.grow_asmachta, 'direct_debit_id', sub.grow_subscription_id);
end $$;

create or replace function public.billing_cancel_done(p_subscription uuid, p_ok boolean, p_note text default null)
returns void language sql security definer set search_path = '' as $$
  update public.billing_subscriptions set cancel_state = case when p_ok then 'done' else 'failed' end, updated_at = now()
   where id = p_subscription;
  update public.billing_events set note = left(p_note, 200), outcome = case when p_ok then 'applied' else 'needs_attention' end
   where event_key = 'cancel:' || p_subscription;
$$;

-- ── Housekeeping (hourly) ──────────────────────────────────────────────────────
create or replace function public.billing_housekeeping() returns void
language sql security definer set search_path = '' as $$
  update public.billing_orders set status = 'abandoned' where status = 'pending' and created_at < now() - interval '3 hours';
  update public.billing_subscriptions set status = 'ended', updated_at = now()
   where status in ('active', 'past_due', 'canceled')
     and current_period_end + case when period = 'monthly' and status <> 'canceled' then public.billing_grace() else interval '0' end < now();
$$;
select cron.schedule('osintfront-billing-housekeeping', '17 * * * *', $c$select public.billing_housekeeping()$c$);

-- ── Super admin: what needs a person ───────────────────────────────────────────
create or replace function public.billing_attention() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_super_admin() then raise exception 'not allowed'; end if;
  return jsonb_build_object(
    'cancellations', coalesce((
      select jsonb_agg(jsonb_build_object('subscription_id', s.id, 'email', p.email, 'name', p.full_name, 'plan', s.plan,
                                          'state', s.cancel_state, 'canceled_at', s.canceled_at, 'payer_phone', s.payer_phone) order by s.canceled_at desc)
        from public.billing_subscriptions s join public.profiles p on p.id = s.user_id
       where s.cancel_state in ('pending', 'failed') and s.canceled_at < now() - interval '2 minutes'), '[]'::jsonb),
    'events', coalesce((
      select jsonb_agg(jsonb_build_object('event_key', e.event_key, 'kind', e.kind, 'outcome', e.outcome, 'note', e.note,
                                          'email', p.email, 'received_at', e.received_at) order by e.received_at desc)
        from public.billing_events e left join public.profiles p on p.id = e.user_id
       where e.outcome in ('unmatched', 'charged_after_cancel', 'amount_mismatch', 'needs_attention')
         and e.received_at > now() - interval '60 days'), '[]'::jsonb),
    'recent', coalesce((
      select jsonb_agg(x order by x.at desc) from (
        select jsonb_build_object('at', o.created_at, 'email', p.email, 'plan', o.plan, 'period', o.period, 'kind', o.kind,
                                  'status', o.status, 'amount', o.amount_agorot / 100.0, 'sandbox', o.sandbox, 'reason', o.failure_reason) as x,
               o.created_at as at
          from public.billing_orders o join public.profiles p on p.id = o.user_id
         order by o.created_at desc limit 20) x), '[]'::jsonb));
end $$;
revoke all on function public.billing_attention() from public, anon;
grant execute on function public.billing_attention() to authenticated;

-- A person marks a cancellation as done after stopping the standing order in Grow by hand.
create or replace function public.billing_mark_cancel_done(p_subscription uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_super_admin() then raise exception 'not allowed'; end if;
  perform public.billing_cancel_done(p_subscription, true, 'stopped in Grow by hand');
end $$;
revoke all on function public.billing_mark_cancel_done(uuid) from public, anon;
grant execute on function public.billing_mark_cancel_done(uuid) to authenticated;

-- Server-only functions.
revoke all on function public.billing_create_order(uuid, text, text, boolean) from public, anon, authenticated;
revoke all on function public.billing_attach_process(uuid, text, text) from public, anon, authenticated;
revoke all on function public.billing_order_failed(uuid, text) from public, anon, authenticated;
revoke all on function public.billing_pay_order(text, uuid, text, boolean, text, text, text, int, text, text, text, jsonb) from public, anon, authenticated;
revoke all on function public._billing_find_sub(text, text, text, int) from public, anon, authenticated;
revoke all on function public.billing_renewal(text, text, text, int, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.billing_failed(text, text, int, text, text, text, int, jsonb) from public, anon, authenticated;
revoke all on function public.billing_cancel_begin(uuid) from public, anon, authenticated;
revoke all on function public.billing_cancel_done(uuid, boolean, text) from public, anon, authenticated;
revoke all on function public.billing_housekeeping() from public, anon, authenticated;
revoke all on function public.billing_grace() from public, anon;
grant execute on function public.billing_create_order(uuid, text, text, boolean) to service_role;
grant execute on function public.billing_attach_process(uuid, text, text) to service_role;
grant execute on function public.billing_order_failed(uuid, text) to service_role;
grant execute on function public.billing_pay_order(text, uuid, text, boolean, text, text, text, int, text, text, text, jsonb) to service_role;
grant execute on function public.billing_renewal(text, text, text, int, text, text, jsonb) to service_role;
grant execute on function public.billing_failed(text, text, int, text, text, text, int, jsonb) to service_role;
grant execute on function public.billing_cancel_begin(uuid) to service_role;
grant execute on function public.billing_cancel_done(uuid, boolean, text) to service_role;
