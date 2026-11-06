-- Ships upgrade: chokepoint gates, crossings, stats. Run inside begin; ... rollback;
do $$
declare v jsonb; h jsonb;
begin
  -- Geometry: west → east across Hormuz is one crossing, "out of the Gulf"; the reverse is the opposite direction.
  assert (select count(*) from public.ais_gate_crossings(26.6, 56.0, 26.6, 56.8)) = 1, 'one crossing';
  assert (select gate from public.ais_gate_crossings(26.6, 56.0, 26.6, 56.8)) = 'hormuz', 'hormuz';
  assert (select g.dir from public.ais_gate_crossings(26.6, 56.0, 26.6, 56.8) g)
       = -(select g.dir from public.ais_gate_crossings(26.6, 56.8, 26.6, 56.0) g), 'opposite directions';
  assert (select case when g.dir > 0 then x.pos_en else x.neg_en end
          from public.ais_gate_crossings(26.6, 56.0, 26.6, 56.8) g join public.ais_gates x on x.id = g.gate) = 'out of the Gulf', 'label';
  -- Moving alongside the gate (0.05° west of it) is not a crossing.
  assert (select count(*) from public.ais_gate_crossings(26.4, 56.37, 26.9, 56.31)) = 0, 'alongside';
  -- Every gate is crossable straight through its middle.
  assert (select count(*) from public.ais_gates x,
          lateral public.ais_gate_crossings((x.a_lat + x.b_lat) / 2 + 0.05 * (x.b_lng - x.a_lng), (x.a_lng + x.b_lng) / 2 - 0.05 * (x.b_lat - x.a_lat),
                                            (x.a_lat + x.b_lat) / 2 - 0.05 * (x.b_lng - x.a_lng), (x.a_lng + x.b_lng) / 2 + 0.05 * (x.b_lat - x.a_lat)) g
          where g.gate = x.id) = 7, 'all seven gates cross';

  -- Through ais_upsert: a moving ship west of Hormuz, then east of it → one crossing row.
  perform public.ais_upsert('[{"mmsi": 999000001, "lat": 26.6, "lng": 56.0, "sog": 12, "ship_type": 80, "name": "TEST TANKER"}]');
  perform public.ais_upsert('[{"mmsi": 999000001, "lat": 26.6, "lng": 56.8, "sog": 12}]');
  assert (select count(*) from public.ais_crossings where mmsi = 999000001) = 1, 'crossing recorded';
  assert (select ship_type from public.ais_crossings where mmsi = 999000001) = 80, 'ship type kept';
  -- Hovering on the line (out, in, out, in within a day) → at most one per direction: 2 rows.
  perform public.ais_upsert('[{"mmsi": 999000001, "lat": 26.6, "lng": 56.0, "sog": 3}]');
  perform public.ais_upsert('[{"mmsi": 999000001, "lat": 26.6, "lng": 56.8, "sog": 3}]');
  perform public.ais_upsert('[{"mmsi": 999000001, "lat": 26.6, "lng": 56.0, "sog": 3}]');
  assert (select count(*) from public.ais_crossings where mmsi = 999000001) = 2, 'hovering: one per direction per day';
  -- A drifting ship (under 2 kn) is not a crossing.
  perform public.ais_upsert('[{"mmsi": 999000003, "lat": 26.6, "lng": 56.0, "sog": 0.5}]');
  perform public.ais_upsert('[{"mmsi": 999000003, "lat": 26.6, "lng": 56.8, "sog": 0.5}]');
  assert (select count(*) from public.ais_crossings where mmsi = 999000003) = 0, 'slow ship ignored';
  -- A northbound Suez transit crosses both gates but counts once.
  perform public.ais_upsert('[{"mmsi": 999000004, "lat": 29.85, "lng": 32.57, "sog": 8, "ship_type": 70}]');
  perform public.ais_upsert('[{"mmsi": 999000004, "lat": 30.00, "lng": 32.57, "sog": 8}]');
  perform public.ais_upsert('[{"mmsi": 999000004, "lat": 31.10, "lng": 32.33, "sog": 8}]');
  perform public.ais_upsert('[{"mmsi": 999000004, "lat": 31.30, "lng": 32.33, "sog": 8}]');
  assert (select count(*) from public.ais_crossings where mmsi = 999000004) = 1, 'suez transit once';

  -- A stale previous position (8 h old) never makes a crossing.
  perform public.ais_upsert('[{"mmsi": 999000002, "lat": 26.6, "lng": 56.0, "sog": 12}]');
  update public.ais_vessels set updated_at = now() - interval '8 hours' where mmsi = 999000002;
  perform public.ais_upsert('[{"mmsi": 999000002, "lat": 26.6, "lng": 56.8, "sog": 12}]');
  assert (select count(*) from public.ais_crossings where mmsi = 999000002) = 0, 'stale position ignored';

  -- Stats with no history: six chokepoints, all collecting.
  delete from public.ais_crossings;
  v := public.chokepoint_stats();
  assert jsonb_array_length(v) = 6, 'six chokepoints';
  assert (select bool_and(e->'pct_normal' = 'null'::jsonb and (e->>'days')::int = 0) from jsonb_array_elements(v) e), 'collecting';

  -- 2 crossings a day on 8 past days + 1 in the last 24 h → 50% of normal.
  insert into public.ais_crossings (gate, mmsi, dir, at, ship_type)
  select 'hormuz', 999000100 + d * 10 + k, 1, now() - (d || ' days')::interval - interval '2 hours', 70
  from generate_series(1, 8) d, generate_series(1, 2) k;
  insert into public.ais_crossings (gate, mmsi, dir, at, ship_type) values ('hormuz', 999000999, -1, now() - interval '1 hour', 82);
  -- A ferry (passenger, 60) is not a commercial crossing.
  insert into public.ais_crossings (gate, mmsi, dir, at, ship_type) values ('hormuz', 999000998, 1, now() - interval '2 hours', 60);
  v := public.chokepoint_stats();
  h := (select e from jsonb_array_elements(v) e where e->>'id' = 'hormuz');
  assert (h->>'crossings_24h')::int = 1, 'crossings 24h (commercial only)';
  assert (h->>'tankers_24h')::int = 1, 'tankers 24h';
  -- Baseline in elapsed time since the first crossing (now − 8 d − 2 h): 7.08 days, 16 crossings → 2.26/day → 44%.
  assert (h->>'days')::int = 7, format('days of data = %s', h->>'days');
  assert (h->>'pct_normal')::int = 44, format('pct normal = %s', h->>'pct_normal');
  -- 7-day average: 12 seeded + 1 recent = 13 commercial crossings / 7 days = 1.9.
  assert (h->>'avg_7d')::numeric = 1.9, format('avg 7d = %s', h->>'avg_7d');
  assert (h->'last'->>'mmsi')::bigint = 999000999, 'last crossing';
  assert h->'last'->>'dir_en' = 'out of the Gulf', 'last direction label';
end $$;
-- Waiting areas cover the strait approaches, not nearby ports (Jebel Ali, Assab, Sharm el-Sheikh).
do $$ begin
  assert not exists (select 1 from public.ais_gates g, (values (25.01, 55.06, 'hormuz'), (13.00, 42.74, 'bab_el_mandeb'), (27.86, 34.30, 'tiran')) p(lat, lng, gate)
    where g.id = p.gate and ((p.lat between g.wp_min_lat and g.wp_max_lat and p.lng between g.wp_min_lng and g.wp_max_lng)
                          or (p.lat between g.wn_min_lat and g.wn_max_lat and p.lng between g.wn_min_lng and g.wn_max_lng))), 'ports outside waiting areas';
  -- The geometry helpers carry no SET clause, so Postgres can inline them in ais_upsert.
  assert (select bool_and(proconfig is null) from pg_proc where proname in ('ais_side', 'ais_gate_crossings') and pronamespace = 'public'::regnamespace), 'inlinable';
end $$;
-- Guests may read the stats.
set local role anon;
do $$ begin
  assert jsonb_array_length(public.chokepoint_stats()) = 6, 'anon can read stats';
end $$;
