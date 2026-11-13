-- Billing M0: foundations for Grow payments. Nothing here is called by the site yet.
--  1) _plan_set records the billing period, and only for paid time.
--  2) redeem_license can no longer replace or shorten a paid plan, or replace a permanent plan.
--  3) Billing tables: orders, subscriptions, payments (customers may read their own rows) and events (server only).
--  4) billing_apply: the single entry point the Grow webhook will use. Service role only, idempotent per event.

-- ── 1) _plan_set with billing period ─────────────────────────────────────────────
drop function if exists public._plan_set(uuid, text, text, timestamptz, text, jsonb);

create or replace function public._plan_set(p_user uuid, p_plan text, p_source text, p_expires timestamptz, p_action text, p_details jsonb, p_billing text default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform set_config('osf.plan_ok', '1', true);
  update public.profiles
     set plan = p_plan,
         plan_source = p_source,
         plan_expires_at = p_expires,
         billing_period = case when p_plan = 'free' or p_source <> 'paid' then null else coalesce(p_billing, billing_period) end
   where id = p_user;
  perform set_config('osf.plan_ok', '', true);
  insert into public.plan_audit (actor, target_user, action, details)
  values (auth.uid(), p_user, p_action, coalesce(p_details, '{}') || jsonb_build_object('plan', p_plan, 'source', p_source, 'expires', p_expires, 'billing', p_billing));
end $$;
revoke all on function public._plan_set(uuid, text, text, timestamptz, text, jsonb, text) from public, anon, authenticated;

-- ── 2) redeem_license: paid and permanent plans are protected ────────────────────
create or replace function public.redeem_license(p_key text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare k record; me record; v text := upper(trim(p_key)); until_at timestamptz; base timestamptz;
begin
  if auth.uid() is null or not public.is_member() then raise exception 'not allowed'; end if;
  if (select count(*) from public.license_attempts where user_id = auth.uid() and at > now() - interval '15 minutes' and not ok) >= 5 then
    return jsonb_build_object('ok', false, 'error', 'rate_limited');
  end if;
  select * into k from public.license_keys where key = v for update;
  if k is null or k.revoked or k.uses >= k.max_uses or k.redeem_by < now()
     or exists (select 1 from public.license_redemptions r where r.key = v and r.user_id = auth.uid()) then
    insert into public.license_attempts (user_id, ok) values (auth.uid(), false);
    return jsonb_build_object('ok', false, 'error', 'invalid');
  end if;

  select plan, plan_source, plan_expires_at into me from public.profiles where id = auth.uid() for update;

  -- A paid subscription is never replaced, shortened or re-labelled by a license key.
  if me.plan_source = 'paid' and me.plan <> 'free' and (me.plan_expires_at is null or me.plan_expires_at > now()) then
    return jsonb_build_object('ok', false, 'error', 'paid_plan_active');
  end if;
  -- A permanent plan (no expiry, e.g. staff) is never replaced by a key.
  if me.plan <> 'free' and me.plan_expires_at is null then
    return jsonb_build_object('ok', false, 'error', 'plan_active');
  end if;
  -- A different active plan is not swapped out: the key is used after it ends.
  if me.plan <> 'free' and me.plan <> k.plan and me.plan_expires_at > now() then
    return jsonb_build_object('ok', false, 'error', 'other_plan_active');
  end if;

  -- Same plan: time stacks onto what is left. Otherwise the clock starts now.
  base := case when me.plan = k.plan and me.plan_expires_at > now() then me.plan_expires_at else now() end;
  until_at := base + make_interval(days => k.duration_days);
  update public.license_keys set uses = uses + 1 where key = v;
  insert into public.license_redemptions (key, user_id) values (v, auth.uid());
  insert into public.license_attempts (user_id, ok) values (auth.uid(), true);
  perform public._plan_set(auth.uid(), k.plan, 'eval', until_at, 'license_redeemed', jsonb_build_object('key', v), null);
  return jsonb_build_object('ok', true, 'plan', k.plan, 'expires_at', until_at);
end $$;

-- ── 3) Billing tables ────────────────────────────────────────────────────────────
create table if not exists public.billing_orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  plan text not null check (plan in ('pro', 'max')),
  period text not null check (period in ('monthly', 'yearly')),
  amount_agorot int not null check (amount_agorot > 0),
  currency text not null default 'ILS' check (currency = 'ILS'),
  status text not null default 'pending' check (status in ('pending', 'paid', 'failed', 'abandoned')),
  grow_process_id text unique,
  created_at timestamptz not null default now(),
  paid_at timestamptz
);

create table if not exists public.billing_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  plan text not null check (plan in ('pro', 'max')),
  period text not null check (period in ('monthly', 'yearly')),
  status text not null default 'active' check (status in ('active', 'past_due', 'canceled', 'ended', 'revoked')),
  grow_subscription_id text unique,
  current_period_end timestamptz not null,
  cancel_at_period_end boolean not null default false,
  failed_attempts int not null default 0,
  last_event_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- At most one live subscription per user.
create unique index if not exists billing_subscriptions_one_live on public.billing_subscriptions (user_id) where status in ('active', 'past_due');

create table if not exists public.billing_payments (
  grow_transaction_id text primary key,            -- unique: a repeated webhook cannot record a charge twice
  order_id uuid references public.billing_orders(id),
  subscription_id uuid references public.billing_subscriptions(id),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('payment', 'renewal', 'refund')),
  amount_agorot int not null,
  vat_agorot int not null default 0,
  invoice_ref text,
  created_at timestamptz not null default now()
);

create table if not exists public.billing_events (
  event_key text primary key,                      -- unique: each webhook event is applied once
  kind text not null,
  user_id uuid,
  outcome text not null default 'applied',
  payload jsonb not null default '{}'::jsonb,      -- never card data: the server strips it before insert
  received_at timestamptz not null default now()
);

alter table public.billing_orders enable row level security;
alter table public.billing_subscriptions enable row level security;
alter table public.billing_payments enable row level security;
alter table public.billing_events enable row level security;

create policy "billing orders: own or admin read" on public.billing_orders for select to authenticated
  using (user_id = (select auth.uid()) or public.is_super_admin());
create policy "billing subscriptions: own or admin read" on public.billing_subscriptions for select to authenticated
  using (user_id = (select auth.uid()) or public.is_super_admin());
create policy "billing payments: own or admin read" on public.billing_payments for select to authenticated
  using (user_id = (select auth.uid()) or public.is_super_admin());
-- billing_events: no policies at all, so only service_role can read or write it.

revoke all on public.billing_orders, public.billing_subscriptions, public.billing_payments, public.billing_events from anon, authenticated;
grant select on public.billing_orders, public.billing_subscriptions, public.billing_payments to authenticated;

-- ── 4) billing_apply: the one place that changes paid time from Grow events ─────
create or replace function public.billing_apply(
  p_event_key text,
  p_kind text,
  p_user uuid,
  p_plan text default null,
  p_period text default null,
  p_grow_subscription_id text default null,
  p_transaction_id text default null,
  p_order_id uuid default null,
  p_amount_agorot int default 0,
  p_vat_agorot int default 0,
  p_payload jsonb default '{}'::jsonb
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  sub public.billing_subscriptions%rowtype;
  me record;
  base timestamptz;
  new_end timestamptz;
  grace constant interval := interval '3 days';
  ins int;
begin
  if coalesce(trim(p_event_key), '') = '' then raise exception 'event key required'; end if;
  if p_user is null then raise exception 'user required'; end if;
  if p_kind not in ('payment', 'renewal', 'failed', 'canceled', 'refund') then raise exception 'bad kind'; end if;

  -- Idempotency: the same event is applied once. A duplicate returns without changing anything.
  insert into public.billing_events (event_key, kind, user_id, payload)
  values (p_event_key, p_kind, p_user, coalesce(p_payload, '{}'::jsonb))
  on conflict (event_key) do nothing;
  get diagnostics ins = row_count;
  if ins = 0 then return jsonb_build_object('ok', true, 'duplicate', true); end if;

  if p_grow_subscription_id is not null then
    select * into sub from public.billing_subscriptions where grow_subscription_id = p_grow_subscription_id for update;
    if sub.id is not null and sub.user_id <> p_user then raise exception 'subscription belongs to another user'; end if;
  end if;
  select plan, plan_source, plan_expires_at into me from public.profiles where id = p_user for update;

  if p_kind in ('payment', 'renewal') then
    if p_plan not in ('pro', 'max') or p_period not in ('monthly', 'yearly') then raise exception 'bad plan or period'; end if;
    if p_transaction_id is null then raise exception 'transaction id required'; end if;
    if p_kind = 'renewal' and sub.id is null then raise exception 'unknown subscription'; end if;
    if sub.id is not null and sub.plan <> p_plan then raise exception 'plan change is not supported yet'; end if;
    -- Another paid plan that is still running blocks a second purchase.
    if me.plan_source = 'paid' and me.plan <> 'free' and me.plan <> p_plan and me.plan_expires_at > now() and sub.id is null then
      raise exception 'another paid plan is active';
    end if;

    -- Time is added to what is left of the paid period (never shortened).
    if sub.id is not null and sub.status in ('active', 'past_due') and sub.current_period_end > now() then
      base := sub.current_period_end;
    elsif sub.id is null and me.plan_source = 'paid' and me.plan = p_plan and me.plan_expires_at > now() then
      base := me.plan_expires_at;
    else
      base := now();
    end if;
    new_end := base + case when p_period = 'yearly' then interval '1 year' else interval '1 month' end;

    if p_grow_subscription_id is not null then
      if sub.id is null then
        insert into public.billing_subscriptions (user_id, plan, period, status, grow_subscription_id, current_period_end, last_event_at)
        values (p_user, p_plan, p_period, 'active', p_grow_subscription_id, new_end, now())
        returning * into sub;
      else
        update public.billing_subscriptions
           set status = 'active', period = p_period, current_period_end = new_end, failed_attempts = 0,
               last_event_at = now(), updated_at = now()
         where id = sub.id
        returning * into sub;
      end if;
    end if;

    perform public._plan_set(p_user, p_plan, 'paid', new_end, 'billing_' || p_kind,
      jsonb_build_object('transaction', p_transaction_id, 'period', p_period), p_period);

    insert into public.billing_payments (grow_transaction_id, order_id, subscription_id, user_id, kind, amount_agorot, vat_agorot)
    values (p_transaction_id, p_order_id, sub.id, p_user, p_kind, p_amount_agorot, p_vat_agorot)
    on conflict (grow_transaction_id) do nothing;

    if p_order_id is not null then
      update public.billing_orders set status = 'paid', paid_at = now() where id = p_order_id and user_id = p_user;
    end if;

  elsif p_kind = 'failed' then
    if sub.id is null then raise exception 'unknown subscription'; end if;
    update public.billing_subscriptions
       set status = 'past_due', failed_attempts = failed_attempts + 1, last_event_at = now(), updated_at = now()
     where id = sub.id
    returning * into sub;
    -- Access continues through the grace period, then expire_plans drops the user to Free.
    perform public._plan_set(p_user, sub.plan, 'paid', sub.current_period_end + grace, 'billing_failed',
      jsonb_build_object('attempts', sub.failed_attempts), sub.period);

  elsif p_kind = 'canceled' then
    if sub.id is null then raise exception 'unknown subscription'; end if;
    -- Renewal stops. Access stays until the paid period ends (no immediate downgrade).
    update public.billing_subscriptions
       set status = 'canceled', cancel_at_period_end = true, last_event_at = now(), updated_at = now()
     where id = sub.id;

  elsif p_kind = 'refund' then
    -- A refund or chargeback removes paid access at once. Eval and default plans are not touched.
    if sub.id is not null then
      update public.billing_subscriptions set status = 'revoked', last_event_at = now(), updated_at = now() where id = sub.id;
    end if;
    if me.plan_source = 'paid' then
      perform public._plan_set(p_user, 'free', 'default', null, 'billing_refund', jsonb_build_object('transaction', p_transaction_id), null);
    end if;
    if p_transaction_id is not null then
      insert into public.billing_payments (grow_transaction_id, order_id, subscription_id, user_id, kind, amount_agorot, vat_agorot)
      values (p_transaction_id, p_order_id, sub.id, p_user, 'refund', p_amount_agorot, p_vat_agorot)
      on conflict (grow_transaction_id) do nothing;
    end if;
  end if;

  return jsonb_build_object('ok', true, 'duplicate', false);
end $$;

revoke all on function public.billing_apply(text, text, uuid, text, text, text, text, uuid, int, int, jsonb) from public, anon, authenticated;
grant execute on function public.billing_apply(text, text, uuid, text, text, text, text, uuid, int, int, jsonb) to service_role;
