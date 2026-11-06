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

  -- Through ais_upsert: a ship west of Hormuz, then east of it → one crossing row.
  perform public.ais_upsert('[{"mmsi": 999000001, "lat": 26.6, "lng": 56.0, "ship_type": 80, "name": "TEST TANKER"}]');
  perform public.ais_upsert('[{"mmsi": 999000001, "lat": 26.6, "lng": 56.8}]');
  assert (select count(*) from public.ais_crossings where mmsi = 999000001) = 1, 'crossing recorded';
  assert (select ship_type from public.ais_crossings where mmsi = 999000001) = 80, 'ship type kept';
  -- Back again within 30 minutes → still one.
  perform public.ais_upsert('[{"mmsi": 999000001, "lat": 26.6, "lng": 56.0}]');
  assert (select count(*) from public.ais_crossings where mmsi = 999000001) = 1, '30-minute rule';

  -- A stale previous position (8 h old) never makes a crossing.
  perform public.ais_upsert('[{"mmsi": 999000002, "lat": 26.6, "lng": 56.0}]');
  update public.ais_vessels set updated_at = now() - interval '8 hours' where mmsi = 999000002;
  perform public.ais_upsert('[{"mmsi": 999000002, "lat": 26.6, "lng": 56.8}]');
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
  v := public.chokepoint_stats();
  h := (select e from jsonb_array_elements(v) e where e->>'id' = 'hormuz');
  assert (h->>'crossings_24h')::int = 1, 'crossings 24h';
  assert (h->>'tankers_24h')::int = 1, 'tankers 24h';
  assert (h->>'days')::int = 8, 'days of data';
  assert (h->>'pct_normal')::int = 50, format('pct normal = %s', h->>'pct_normal');
  assert (h->'last'->>'mmsi')::bigint = 999000999, 'last crossing';
  assert h->'last'->>'dir_en' = 'out of the Gulf', 'last direction label';
end $$;
-- Guests may read the stats.
set local role anon;
do $$ begin
  assert jsonb_array_length(public.chokepoint_stats()) = 6, 'anon can read stats';
end $$;
