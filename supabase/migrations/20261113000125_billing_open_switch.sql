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
