-- Stage A / Task 1: guest plan, daily limits, viewers -> Pro. Run inside begin; ... rollback;
do $$
declare f record;
begin
  assert exists (select 1 from public.plans where id = 'guest' and sort = 0), 'guest plan missing';
  -- expand_daily
  assert (select not enabled from public.plan_features where feature_key='expand_daily' and plan_id='guest'), 'guest expand must be off';
  assert (select enabled and limit_value = 3 from public.plan_features where feature_key='expand_daily' and plan_id='free'), 'free expand 3/day';
  assert (select count(*) from public.plan_features where feature_key='expand_daily' and plan_id in ('pro','max','intel') and enabled and limit_value is null) = 3, 'paid expand unlimited';
  -- satellite
  assert (select not enabled from public.plan_features where feature_key='satellite' and plan_id='guest'), 'guest satellite must be off';
  assert (select enabled and limit_value = 3 from public.plan_features where feature_key='satellite' and plan_id='free'), 'free satellite 3/day';
  assert (select count(*) from public.plan_features where feature_key='satellite' and plan_id in ('pro','max','intel') and enabled and limit_value is null) = 3, 'paid satellite unlimited';
  -- ships + aircraft for all
  assert (select count(*) from public.plan_features where feature_key='ships_aircraft' and enabled) = 5, 'ships_aircraft for all 5 plans';
  assert (select enabled and limit_value = 0 from public.plan_features where feature_key='archive_days' and plan_id='guest'), 'guest archive 0';
  -- viewers moved to Pro, no expiry
  assert (select count(*) from public.profiles where role='viewer' and plan='free') = 0, 'viewers still free';
end $$;
set local role anon;
do $$ begin
  assert (select count(*) from public.plan_features) > 0, 'anon cannot read plan_features';
  assert (select count(*) from public.plans) > 0, 'anon cannot read plans';
  assert exists (select 1 from public.app_settings where key = 'enforce_plans'), 'anon cannot read enforce_plans';
end $$;
reset role;
