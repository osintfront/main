-- Weather: plan feature for registered users + nearest-place lookup. Run inside begin; ... rollback;
do $$
begin
  assert (select not enabled from public.plan_features where feature_key='weather' and plan_id='guest'), 'guest weather must be off';
  assert (select count(*) from public.plan_features where feature_key='weather' and plan_id in ('free','pro','max','intel') and enabled and limit_value is null) = 4, 'weather on for free/pro/max/intel, no limit';
  assert (select count(*) from public.geo_nearest_place(33.2733, 35.2033)) = 1, 'a place near Tyre';
  assert (select count(*) from public.geo_nearest_place(33.0, 30.0)) = 0, 'nothing in the open sea';
end $$;
set local role anon;
do $$ begin
  perform public.geo_nearest_place(33.27, 35.2);
  raise exception 'anon must not call geo_nearest_place';
exception when insufficient_privilege then null; end $$;
reset role;
-- A right-click must not scan every place.
do $$
declare t0 timestamptz; ms numeric;
begin
  perform public.geo_nearest_place(33.2733, 35.2033);
  t0 := clock_timestamp();
  perform public.geo_nearest_place(33.2733, 35.2033);
  perform public.geo_nearest_place(31.5, 34.45);
  perform public.geo_nearest_place(35.7, 51.4);
  ms := extract(epoch from clock_timestamp() - t0) * 1000 / 3;
  assert ms < 150, format('geo_nearest_place too slow: %s ms per call', round(ms));
end $$;
