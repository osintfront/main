-- Stage A / review fixes I5 + I10: guests get live pulses; free accounts get 1 day of archive
-- and high-severity push only (when enforce_plans is on). Run inside begin; ... rollback;
do $$ begin
  assert has_table_privilege('anon', 'public.events_pulse', 'select'), 'guests: no events pulse';
  assert has_table_privilege('anon', 'public.hfc_pulse', 'select'), 'guests: no red-alert pulse';
end $$;
do $$
declare u uuid := gen_random_uuid(); n_all int; n_old int;
begin
  insert into auth.users (id, email, aud, role, email_confirmed_at) values (u, 'caps@e2e.test', 'authenticated', 'authenticated', now());
  update public.app_settings set value = 'true'::jsonb where key = 'enforce_plans';
  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth) values (u, 'https://push.e2e/caps', 'k', 'a');
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  set local role authenticated;
  assert public.my_archive_days() = 1, 'free archive days ' || coalesce(public.my_archive_days()::text, 'null');
  select count(*) into n_old from public.archived_events where occurred_at < now() - interval '1 day 1 hour';
  assert n_old = 0, 'free sees archive older than 1 day: ' || n_old;
  begin
    perform public.push_set_min_severity('https://push.e2e/caps', 'low');
    assert false, 'free could choose low-severity push';
  exception when others then
    assert sqlerrm like '%plan%', 'unexpected error: ' || sqlerrm;
  end;
  assert public.push_set_min_severity('https://push.e2e/caps', 'critical'), 'free may choose critical';
  reset role;
end $$;
