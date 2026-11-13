-- Billing go-live switch and cancellation by request.
--  * app_settings.billing_open (true/false): when true, /packages sells online to everyone.
--    While false, only testers (super admins + app_settings.billing_testers) can pay, on /packages-test.
--  * Customers cancel by writing to us (contact / cancel-subscription page). A super admin then cancels
--    the subscription here (billing_admin_cancel) and stops the standing order in Grow.

insert into public.app_settings (key, value) values ('billing_open', 'false'::jsonb) on conflict (key) do nothing;

create or replace function public.billing_is_open() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select (value #>> '{}')::boolean from public.app_settings where key = 'billing_open' and jsonb_typeof(value) = 'boolean'), false)
$$;
revoke all on function public.billing_is_open() from public;
grant execute on function public.billing_is_open() to anon, authenticated, service_role;

-- Super admin: cancel a customer's monthly subscription after their cancellation request.
-- No more renewals here; access stays until the end of the month already paid. The cancellation then
-- shows in billing_attention until the standing order is stopped in Grow and marked done.
create or replace function public.billing_admin_cancel(p_email text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare uid uuid; r jsonb;
begin
  if not public.is_super_admin() then raise exception 'not allowed'; end if;
  select id into uid from public.profiles where lower(email) = lower(trim(p_email));
  if uid is null then return jsonb_build_object('ok', false, 'reason', 'no_such_user'); end if;
  r := public.billing_cancel_begin(uid);
  if (r ->> 'ok')::boolean then
    perform public.billing_cancel_done((r ->> 'subscription_id')::uuid, false, 'cancelled by admin on request; stop the standing order in Grow');
  end if;
  return r;
end $$;
revoke all on function public.billing_admin_cancel(text) from public, anon;
grant execute on function public.billing_admin_cancel(text) to authenticated;

-- ── Assumed renewals (bridge until Grow's account webhooks are on) ─────────────
-- A monthly standing order keeps charging until it is stopped, and customers cancel through us. So a
-- monthly subscription that is still active (not cancelled, no failed charge) one day after its paid
-- month ended is extended by a month, marked "assumed". The admin panel lists them so a person can check
-- the charge in Grow. When Grow's real renewal notification arrives it uses up an assumption instead of
-- adding a second month; a failed-charge notification takes the assumed month back.
alter table public.billing_subscriptions
  add column if not exists assumed_renewals int not null default 0,
  add column if not exists last_assumed_at timestamptz;

create or replace function public.billing_assume_renewals() returns int
language plpgsql security definer set search_path = '' as $$
declare s record; n int := 0; new_end timestamptz;
begin
  for s in select * from public.billing_subscriptions
            where period = 'monthly' and status = 'active' and cancel_state = 'none'
              and current_period_end < now() - interval '1 day'
              and created_at > now() - interval '36 months'   -- Grow's standing order stops after 36 charges
            for update loop
    new_end := s.current_period_end + interval '1 month';
    update public.billing_subscriptions
       set current_period_end = new_end, assumed_renewals = assumed_renewals + 1, last_assumed_at = now(), updated_at = now()
     where id = s.id;
    perform public._plan_set(s.user_id, s.plan, 'paid', new_end + public.billing_grace(), 'billing_assumed_renewal', '{}', 'monthly');
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.billing_assume_renewals() from public, anon, authenticated;
select cron.schedule('osintfront-billing-assume', '41 * * * *', $c$select public.billing_assume_renewals()$c$);

-- Real renewal: uses up an assumed month first.
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
    update public.billing_events set outcome = 'charged_after_cancel', note = 'refund and stop the standing order in Grow'
     where event_key = p_event_key;
    insert into public.billing_payments (grow_transaction_id, subscription_id, user_id, kind, amount_agorot)
    values (coalesce(p_transaction_id, p_event_key), sub.id, sub.user_id, 'renewal', coalesce(p_amount_agorot, 0))
    on conflict (grow_transaction_id) do nothing;
    return jsonb_build_object('ok', false, 'reason', 'charged_after_cancel', 'user_id', sub.user_id);
  end if;

  if sub.assumed_renewals > 0 then
    -- This charge pays for a month already given: confirm it, do not add another.
    new_end := sub.current_period_end;
    update public.billing_subscriptions
       set status = 'active', assumed_renewals = assumed_renewals - 1, failed_attempts = 0, last_event_at = now(), updated_at = now()
     where id = sub.id;
  else
    new_end := greatest(sub.current_period_end, now()) + interval '1 month';
    update public.billing_subscriptions
       set status = 'active', current_period_end = new_end, failed_attempts = 0, last_event_at = now(), updated_at = now()
     where id = sub.id;
  end if;
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
revoke all on function public.billing_renewal(text, text, text, int, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.billing_renewal(text, text, text, int, text, text, jsonb) to service_role;

-- Failed charge: an assumed month is taken back.
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
  if sub.assumed_renewals > 0 then
    update public.billing_subscriptions
       set current_period_end = current_period_end - interval '1 month', assumed_renewals = assumed_renewals - 1
     where id = sub.id
    returning * into sub;
  end if;
  update public.billing_subscriptions
     set status = 'past_due', failed_attempts = greatest(failed_attempts + 1, coalesce(p_attempts, 0)),
         last_event_at = now(), updated_at = now()
   where id = sub.id;
  perform public._plan_set(sub.user_id, sub.plan, 'paid', sub.current_period_end + public.billing_grace(), 'billing_failed',
    jsonb_build_object('error', left(p_error, 200), 'attempts', p_attempts), sub.period);
  return jsonb_build_object('ok', true, 'user_id', sub.user_id);
end $$;
revoke all on function public.billing_failed(text, text, int, text, text, text, int, jsonb) from public, anon, authenticated;
grant execute on function public.billing_failed(text, text, int, text, text, text, int, jsonb) to service_role;

-- Super admin: the charge did not go through (seen in Grow) → back to Free now.
create or replace function public.billing_admin_revoke(p_subscription uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare s record;
begin
  if not public.is_super_admin() then raise exception 'not allowed'; end if;
  select * into s from public.billing_subscriptions where id = p_subscription for update;
  if s.id is null then raise exception 'no subscription'; end if;
  update public.billing_subscriptions set status = 'revoked', cancel_state = case when period = 'monthly' then 'pending' else cancel_state end,
         canceled_at = coalesce(canceled_at, now()), updated_at = now() where id = s.id;
  perform public._plan_set(s.user_id, 'free', 'default', null, 'billing_admin_revoke', jsonb_build_object('subscription', s.id), null);
end $$;
revoke all on function public.billing_admin_revoke(uuid) from public, anon;
grant execute on function public.billing_admin_revoke(uuid) to authenticated;

-- A person confirmed in Grow that the assumed months were really charged.
create or replace function public.billing_admin_confirm_assumed(p_subscription uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_super_admin() then raise exception 'not allowed'; end if;
  update public.billing_subscriptions set assumed_renewals = 0, updated_at = now() where id = p_subscription;
end $$;
revoke all on function public.billing_admin_confirm_assumed(uuid) from public, anon;
grant execute on function public.billing_admin_confirm_assumed(uuid) to authenticated;

-- Cancellations needing Grow action show at once (no 2-minute wait any more).
create or replace function public.billing_attention() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_super_admin() then raise exception 'not allowed'; end if;
  return jsonb_build_object(
    'open', public.billing_is_open(),
    'cancellations', coalesce((
      select jsonb_agg(jsonb_build_object('subscription_id', s.id, 'email', p.email, 'name', p.full_name, 'plan', s.plan,
                                          'state', s.cancel_state, 'canceled_at', s.canceled_at, 'payer_phone', s.payer_phone,
                                          'direct_debit_id', s.grow_subscription_id) order by s.canceled_at desc)
        from public.billing_subscriptions s join public.profiles p on p.id = s.user_id
       where s.cancel_state in ('pending', 'failed')), '[]'::jsonb),
    'assumed', coalesce((
      select jsonb_agg(jsonb_build_object('subscription_id', s.id, 'email', p.email, 'name', p.full_name, 'plan', s.plan,
                                          'months', s.assumed_renewals, 'until', s.current_period_end, 'payer_phone', s.payer_phone,
                                          'direct_debit_id', s.grow_subscription_id) order by s.last_assumed_at desc)
        from public.billing_subscriptions s join public.profiles p on p.id = s.user_id
       where s.assumed_renewals > 0 and s.status in ('active', 'past_due')), '[]'::jsonb),
    'events', coalesce((
      select jsonb_agg(jsonb_build_object('event_key', e.event_key, 'kind', e.kind, 'outcome', e.outcome, 'note', e.note,
                                          'email', p.email, 'received_at', e.received_at) order by e.received_at desc)
        from public.billing_events e left join public.profiles p on p.id = e.user_id
       where e.outcome in ('unmatched', 'charged_after_cancel', 'amount_mismatch')
         and e.received_at > now() - interval '60 days'), '[]'::jsonb),
    'recent', coalesce((
      select jsonb_agg(x.j order by x.at desc) from (
        select jsonb_build_object('at', o.created_at, 'email', p.email, 'plan', o.plan, 'period', o.period, 'kind', o.kind,
                                  'status', o.status, 'amount', round(o.amount_agorot / 100.0, 2), 'sandbox', o.sandbox, 'reason', o.failure_reason) as j,
               o.created_at as at
          from public.billing_orders o join public.profiles p on p.id = o.user_id
         order by o.created_at desc limit 20) x), '[]'::jsonb));
end $$;
revoke all on function public.billing_attention() from public, anon;
grant execute on function public.billing_attention() to authenticated;
