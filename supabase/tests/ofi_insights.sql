-- OFI Insights phase 1: tables are closed to readers, ofi_* return only what each tier may see.
-- Run inside begin; ... rollback; (changes nothing).
do $$ begin
  assert not has_table_privilege('anon', 'public.insight_events', 'select'), 'anon can read insight_events';
  assert not has_table_privilege('anon', 'public.insight_forecasts', 'select'), 'anon can read insight_forecasts';
  assert (select count(*) from public.insight_signals s join public.insight_events e on e.id = s.event_id
          where e.slug = 'iran-direct-confrontation') >= 14, 'seed signals missing';
end $$;

do $$
declare
  ev uuid;
  fid bigint;
  u_free uuid := gen_random_uuid();
  u_pro uuid := gen_random_uuid();
  j jsonb;
  n int;
begin
  update public.app_settings set value = 'true'::jsonb where key = 'enforce_plans';
  select id into ev from public.insight_events where slug = 'iran-direct-confrontation';
  update public.insight_events set is_published = true where id = ev;
  insert into public.insight_forecasts (event_id, ts, probability, confidence_low, confidence_high, contributions, model_version, summary_he, summary_en)
  values (ev, now() - interval '2 days', 0.03, 0.02, 0.05, '[]', 'test', null, null);
  insert into public.insight_forecasts (event_id, probability, confidence_low, confidence_high, contributions, model_version, summary_he, summary_en)
  values (ev, 0.07, 0.04, 0.11,
          '[{"key":"airspace_closure","pp":3.1},{"key":"internal_volume","pp":0.8},{"key":"finance_defense","pp":-0.2}]',
          'test', 'סיכום', 'summary')
  returning id into fid;
  insert into public.insight_resolutions (event_id, window_start, window_end, outcome, forecast_id)
  values (ev, now() - interval '50 hours', now() - interval '26 hours', false,
          (select id from public.insight_forecasts where event_id = ev order by ts asc limit 1));

  insert into auth.users (id, email, aud, role, email_confirmed_at) values
    (u_free, 'ofi-free@e2e.test', 'authenticated', 'authenticated', now()),
    (u_pro, 'ofi-pro@e2e.test', 'authenticated', 'authenticated', now());
  update public.profiles set status = 'active', role = 'viewer' where id in (u_free, u_pro);
  perform public._plan_set(u_pro, 'pro', 'paid', null, 'set', '{}'::jsonb);

  -- Guest: sees the card, never the number.
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  set local role anon;
  assert public.ofi_tier() = 0, 'guest tier ' || public.ofi_tier();
  j := public.ofi_list() -> 0;
  assert j ->> 'slug' = 'iran-direct-confrontation', 'guest: card missing';
  assert (j ->> 'locked')::boolean and j -> 'probability' = 'null'::jsonb, 'guest sees the probability';
  j := public.ofi_detail('iran-direct-confrontation');
  assert j -> 'probability' = 'null'::jsonb and jsonb_array_length(j -> 'contributions') = 0, 'guest detail leaks';
  j := public.ofi_track_record('iran-direct-confrontation');
  assert (j ->> 'n')::int = 1 and (j ->> 'brier')::numeric = 0.0009, 'track record ' || j::text;
  reset role;

  -- Free: number + trend + one teaser signal; no band, history, signals or summary.
  perform set_config('request.jwt.claims', json_build_object('sub', u_free, 'role', 'authenticated')::text, true);
  set local role authenticated;
  assert public.ofi_tier() = 1, 'free tier ' || public.ofi_tier();
  select count(*) into n from public.insight_events;
  assert n = 0, 'free reads insight_events directly';
  begin
    insert into public.insight_lexicon (event_id, term, category) values (ev, 'x', 'threat');
    assert false, 'free could write the lexicon';
  exception when insufficient_privilege then null;
  end;
  j := public.ofi_list() -> 0;
  assert (j ->> 'probability')::numeric = 0.07 and (j ->> 'previous_probability')::numeric = 0.03, 'free card ' || j::text;
  assert j -> 'spark' = 'null'::jsonb, 'free gets the sparkline';
  j := public.ofi_detail('iran-direct-confrontation');
  assert jsonb_array_length(j -> 'contributions') = 1 and j -> 'contributions' -> 0 ->> 'key' = 'airspace_closure', 'free teaser ' || j::text;
  assert (j ->> 'signal_count')::int = 3, 'free signal count';
  assert j -> 'confidence_low' = 'null'::jsonb and j -> 'signals' = 'null'::jsonb and j -> 'history' = 'null'::jsonb
     and j -> 'summary_he' = 'null'::jsonb, 'free gets Pro data';
  reset role;

  -- Pro: everything except history older than 30 days.
  perform set_config('request.jwt.claims', json_build_object('sub', u_pro, 'role', 'authenticated')::text, true);
  set local role authenticated;
  assert public.ofi_tier() = 2, 'pro tier ' || public.ofi_tier();
  j := public.ofi_detail('iran-direct-confrontation');
  assert jsonb_array_length(j -> 'contributions') = 3, 'pro contributions';
  assert (j ->> 'confidence_high')::numeric = 0.11 and j ->> 'summary_he' = 'סיכום', 'pro band/summary';
  assert jsonb_array_length(j -> 'signals') >= 14 and jsonb_array_length(j -> 'history') = 2, 'pro signals/history';
  assert jsonb_array_length(public.ofi_list() -> 0 -> 'spark') = 2, 'pro sparkline';
  reset role;

  -- Drafts are invisible to readers.
  update public.insight_events set is_published = false where id = ev;
  perform set_config('request.jwt.claims', json_build_object('sub', u_pro, 'role', 'authenticated')::text, true);
  set local role authenticated;
  assert public.ofi_detail('iran-direct-confrontation') is null, 'unpublished event visible';
  assert jsonb_array_length(public.ofi_list()) = 0, 'unpublished event listed';
  reset role;
end $$;
