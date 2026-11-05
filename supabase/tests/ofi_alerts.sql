-- OFI alerts: Free none, Pro 3 (no webhook), Max unlimited + webhook; crossing an estimate queues them.
-- Run inside begin; ... rollback; (the queued pg_net call is discarded with the transaction).
do $$
declare ev uuid; u_free uuid := gen_random_uuid(); u_pro uuid := gen_random_uuid(); u_max uuid := gen_random_uuid(); fid bigint; n int;
begin
  update public.app_settings set value = 'true'::jsonb where key = 'enforce_plans';
  select id into ev from public.insight_events where slug = 'iran-direct-confrontation';
  update public.insight_events set is_published = true where id = ev;
  insert into auth.users (id, email, aud, role, email_confirmed_at) values
    (u_free, 'a1@e2e.test', 'authenticated', 'authenticated', now()), (u_pro, 'a2@e2e.test', 'authenticated', 'authenticated', now()),
    (u_max, 'a3@e2e.test', 'authenticated', 'authenticated', now());
  update public.profiles set status = 'active', role = 'viewer' where id in (u_free, u_pro, u_max);
  perform public._plan_set(u_pro, 'pro', 'paid', null, 'set', '{}'::jsonb);
  perform public._plan_set(u_max, 'max', 'paid', null, 'set', '{}'::jsonb);

  perform set_config('request.jwt.claims', json_build_object('sub', u_free, 'role', 'authenticated')::text, true);
  set local role authenticated;
  assert public.ofi_event_id('iran-direct-confrontation') is null, 'free gets event id';
  begin insert into public.insight_alerts (event_id, kind, value) values (ev, 'above', 0.1); assert false, 'free alert';
  exception when others then assert sqlerrm like 'plan:%', sqlerrm; end;
  reset role;

  perform set_config('request.jwt.claims', json_build_object('sub', u_pro, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.insight_alerts (event_id, kind, value) values (ev, 'above', 0.05), (ev, 'change', 1), (ev, 'below', 0.02);
  begin insert into public.insight_alerts (event_id, kind, value) values (ev, 'above', 0.5); assert false, '4th pro alert';
  exception when others then assert sqlerrm like 'plan:%', sqlerrm; end;
  begin insert into public.insight_alerts (event_id, kind, value, webhook_url) values (ev, 'above', 0.5, 'https://example.com/h'); assert false, 'pro webhook';
  exception when others then assert sqlerrm like 'plan:%', sqlerrm; end;
  reset role;

  perform set_config('request.jwt.claims', json_build_object('sub', u_max, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.insight_alerts (event_id, kind, value, webhook_url) values (ev, 'above', 0.05, 'https://example.com/hook');
  select count(*) into n from public.insight_alerts;
  assert n = 1, 'max sees others alerts: ' || n;
  reset role;

  insert into public.insight_forecasts (event_id, probability, contributions, model_version) values (ev, 0.07, '[]', 'test') returning id into fid;
  n := public.ofi_queue_alerts(fid);
  assert n >= 2, 'queued ' || n;
end $$;
