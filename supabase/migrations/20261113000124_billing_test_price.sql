-- Billing test mode: while app_settings.billing_test_price_agorot is set, orders opened by a super admin
-- are charged that amount (e.g. 100 = ₪1) instead of the plan price. Everyone else always pays the real price.
-- Turn it off with:  delete from public.app_settings where key = 'billing_test_price_agorot';

create or replace function public._billing_test_price(p_user uuid) returns int
language sql stable security definer set search_path = '' as $$
  select greatest(100, (s.value #>> '{}')::int)
    from public.app_settings s
    join public.profiles p on p.id = p_user and p.role = 'super_admin' and p.status = 'active'
   where s.key = 'billing_test_price_agorot' and jsonb_typeof(s.value) = 'number'
$$;
revoke all on function public._billing_test_price(uuid) from public, anon, authenticated;

create or replace function public.billing_create_order(p_user uuid, p_plan text, p_period text, p_sandbox boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare q jsonb; oid uuid; amount int; test int;
begin
  q := public._billing_quote(p_user, p_plan, p_period);
  if not (q ->> 'allowed')::boolean then
    return jsonb_build_object('ok', false, 'reason', q ->> 'reason');
  end if;
  amount := (q ->> 'amount_agorot')::int;
  test := public._billing_test_price(p_user);
  if test is not null and test < amount then amount := test; end if;
  -- One open order per user: an older unpaid one is closed.
  update public.billing_orders set status = 'abandoned' where user_id = p_user and status = 'pending';
  insert into public.billing_orders (user_id, plan, period, amount_agorot, kind, from_plan, from_subscription, credit_days, sandbox)
  values (p_user, p_plan, p_period, amount, q ->> 'kind', q ->> 'from_plan',
          nullif(q ->> 'from_subscription', '')::uuid, coalesce((q ->> 'credit_days')::numeric, 0),
          coalesce(p_sandbox, false) or test is not null)
  returning id into oid;
  return jsonb_build_object('ok', true, 'order_id', oid, 'amount_agorot', amount,
                            'kind', q ->> 'kind', 'credit_days', coalesce((q ->> 'credit_days')::numeric, 0), 'test', test is not null);
end $$;
revoke all on function public.billing_create_order(uuid, text, text, boolean) from public, anon, authenticated;
grant execute on function public.billing_create_order(uuid, text, text, boolean) to service_role;

-- The packages page shows the test amount to the super admin.
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
    'test_price_agorot', public._billing_test_price(u),
    'subscription', case when sub.id is null then null else to_jsonb(sub) end,
    'options', jsonb_build_object(
      'pro_monthly', public._billing_quote(u, 'pro', 'monthly'),
      'pro_yearly',  public._billing_quote(u, 'pro', 'yearly'),
      'max_monthly', public._billing_quote(u, 'max', 'monthly'),
      'max_yearly',  public._billing_quote(u, 'max', 'yearly')));
end $$;
revoke all on function public.billing_options() from public, anon;
grant execute on function public.billing_options() to authenticated;

-- Test mode on: ₪1 for super admins.
insert into public.app_settings (key, value) values ('billing_test_price_agorot', '100'::jsonb)
on conflict (key) do update set value = excluded.value, updated_at = now();
