-- Chokepoint review fixes:
--  · geometry helpers without SET search_path, so Postgres inlines them in ais_upsert (cheaper live ingest);
--  · a crossing needs a moving ship (≥ 2 kn) and counts once per ship, chokepoint and direction per 24 h
--    (no hovering inflation; a Suez transit seen at both ends counts once);
--  · stats count commercial ships only (cargo 70–79, tanker 80–89);
--  · baseline and 7-day average in elapsed time since the first recorded crossing (not calendar dates);
--  · waiting areas trimmed to the strait approaches (no Jebel Ali / Dubai, Assab, Mocha, Sharm el-Sheikh).

create or replace function public.ais_side(a_lat float8, a_lng float8, b_lat float8, b_lng float8, p_lat float8, p_lng float8)
returns float8 language sql immutable parallel safe as $$
  select sign((b_lng - a_lng) * (p_lat - a_lat) - (b_lat - a_lat) * (p_lng - a_lng));
$$;
alter function public.ais_side(float8, float8, float8, float8, float8, float8) reset all;

create or replace function public.ais_gate_crossings(p0_lat float8, p0_lng float8, p1_lat float8, p1_lng float8)
returns table (gate text, dir smallint) language sql stable parallel safe as $$
  select g.id, (case when public.ais_side(g.a_lat, g.a_lng, g.b_lat, g.b_lng, p1_lat, p1_lng) > 0 then 1 else -1 end)::smallint
  from public.ais_gates g
  where public.ais_side(g.a_lat, g.a_lng, g.b_lat, g.b_lng, p0_lat, p0_lng)
      * public.ais_side(g.a_lat, g.a_lng, g.b_lat, g.b_lng, p1_lat, p1_lng) < 0
    and public.ais_side(p0_lat, p0_lng, p1_lat, p1_lng, g.a_lat, g.a_lng)
      * public.ais_side(p0_lat, p0_lng, p1_lat, p1_lng, g.b_lat, g.b_lng) < 0;
$$;
alter function public.ais_gate_crossings(float8, float8, float8, float8) reset all;

update public.ais_gates set wp_min_lat = 26.0, wp_min_lng = 55.8, wp_max_lat = 26.7, wp_max_lng = 56.3 where id = 'hormuz';
update public.ais_gates set wn_min_lat = 12.7, wn_min_lng = 42.9, wn_max_lat = 13.2, wn_max_lng = 43.5 where id = 'bab_el_mandeb';
update public.ais_gates set wn_min_lat = 27.75, wn_min_lng = 34.42, wn_max_lat = 27.93, wn_max_lng = 34.6 where id = 'tiran';

create index if not exists ais_crossings_at_idx on public.ais_crossings (at);

create or replace function public.ais_upsert(p_rows jsonb)
returns integer language plpgsql security definer set search_path = '' as $$
declare v_n integer := 0; v_m integer := 0;
begin
  insert into public.ais_crossings (gate, mmsi, dir, at, ship_type, name)
  select g.gate, r.mmsi, g.dir, coalesce(r.at, now()), coalesce(r.ship_type, v.ship_type), coalesce(nullif(r.name, ''), v.name)
  from jsonb_to_recordset(p_rows) as r(mmsi bigint, lat float8, lng float8, sog real, at timestamptz, ship_type smallint, name text)
  join public.ais_vessels v on v.mmsi = r.mmsi
  cross join lateral public.ais_gate_crossings(v.lat, v.lng, r.lat, r.lng) g
  join public.ais_gates gg on gg.id = g.gate
  where r.lat is not null and r.lng is not null
    and coalesce(r.sog, v.sog, 0) >= 2
    and v.updated_at > coalesce(r.at, now()) - interval '6 hours'
    and not exists (select 1 from public.ais_crossings c join public.ais_gates cg on cg.id = c.gate
                    where c.mmsi = r.mmsi and cg.chokepoint = gg.chokepoint and c.dir = g.dir
                      and c.at > coalesce(r.at, now()) - interval '24 hours');

  insert into public.ais_vessels as v (mmsi, name, callsign, imo, ship_type, destination, eta, length_m, lat, lng, sog, cog, heading, nav_status, updated_at, static_at)
  select r.mmsi, nullif(r.name, ''), nullif(r.callsign, ''), r.imo, r.ship_type, nullif(r.destination, ''), nullif(r.eta, ''), r.length_m,
         r.lat, r.lng, r.sog, r.cog, r.heading, r.nav_status, coalesce(r.at, now()), case when r.ship_type is not null or r.name is not null then now() end
  from jsonb_to_recordset(p_rows) as r(mmsi bigint, name text, callsign text, imo bigint, ship_type smallint, destination text, eta text,
                                       length_m smallint, lat float8, lng float8, sog real, cog real, heading smallint, nav_status smallint, at timestamptz)
  where r.lat is not null and r.lng is not null and r.lat between -90 and 90 and r.lng between -180 and 180 and r.mmsi > 0
  on conflict (mmsi) do update set
    name = coalesce(excluded.name, v.name), callsign = coalesce(excluded.callsign, v.callsign), imo = coalesce(excluded.imo, v.imo),
    ship_type = coalesce(excluded.ship_type, v.ship_type), destination = coalesce(excluded.destination, v.destination),
    eta = coalesce(excluded.eta, v.eta), length_m = coalesce(excluded.length_m, v.length_m),
    lat = excluded.lat, lng = excluded.lng, sog = excluded.sog, cog = excluded.cog,
    heading = coalesce(excluded.heading, v.heading), nav_status = coalesce(excluded.nav_status, v.nav_status),
    updated_at = greatest(excluded.updated_at, v.updated_at), static_at = coalesce(excluded.static_at, v.static_at);
  get diagnostics v_n = row_count;

  update public.ais_vessels v set
    name = coalesce(nullif(r.name, ''), v.name), callsign = coalesce(nullif(r.callsign, ''), v.callsign), imo = coalesce(r.imo, v.imo),
    ship_type = coalesce(r.ship_type, v.ship_type), destination = coalesce(nullif(r.destination, ''), v.destination),
    eta = coalesce(nullif(r.eta, ''), v.eta), length_m = coalesce(r.length_m, v.length_m), static_at = now()
  from jsonb_to_recordset(p_rows) as r(mmsi bigint, name text, callsign text, imo bigint, ship_type smallint, destination text, eta text, length_m smallint, lat float8)
  where r.lat is null and v.mmsi = r.mmsi;
  get diagnostics v_m = row_count;

  if extract(minute from now()) < 1 then
    delete from public.ais_vessels where updated_at < now() - interval '72 hours';
    delete from public.ais_crossings where at < now() - interval '60 days';
  end if;
  return v_n + v_m;
end;
$$;
revoke execute on function public.ais_upsert(jsonb) from public, anon, authenticated;
grant execute on function public.ais_upsert(jsonb) to service_role;

create or replace function public.chokepoint_stats()
returns jsonb language sql stable security definer set search_path = '' as $$
  with cp(id, ord) as (values ('hormuz', 1), ('bab_el_mandeb', 2), ('suez', 3), ('tiran', 4), ('bosphorus', 5), ('dardanelles', 6)),
  -- When collection started: the first recorded crossing anywhere (crossings are kept 60 days).
  start as (select min(at) as t from public.ais_crossings),
  span as (
    select
      greatest(0, least(28, extract(epoch from (now() - interval '24 hours') - s.t) / 86400.0)) as base_days,
      greatest(0, least(7, extract(epoch from now() - s.t) / 86400.0)) as week_days
    from start s
  ),
  c as (
    select g.chokepoint, x.*, case when x.dir > 0 then g.pos_en else g.neg_en end as dir_en,
           case when x.dir > 0 then g.pos_he else g.neg_he end as dir_he
    from public.ais_crossings x join public.ais_gates g on g.id = x.gate
    where x.at > now() - interval '29 days' and x.ship_type between 70 and 89   -- commercial: cargo and tankers
  ),
  agg as (
    select cp.id,
      count(c.id) filter (where c.at > now() - interval '24 hours') as crossings_24h,
      count(c.id) filter (where c.at > now() - interval '24 hours' and c.ship_type between 80 and 89) as tankers_24h,
      count(c.id) filter (where c.at <= now() - interval '24 hours' and c.at > now() - interval '29 days') as past_n,
      count(c.id) filter (where c.at > now() - interval '7 days') as week_n
    from cp left join c on c.chokepoint = cp.id
    group by cp.id
  ),
  waits as (
    select g.chokepoint, jsonb_agg(jsonb_build_object('en', w.name_en, 'he', w.name_he, 'n', (
      select count(*) from public.ais_vessels v
      where v.updated_at > now() - interval '3 hours' and coalesce(v.sog, 0) < 1
        and v.lat between w.min_lat and w.max_lat and v.lng between w.min_lng and w.max_lng)) order by g.id, w.side) as waiting
    from public.ais_gates g
    cross join lateral (values
      (1, g.wp_name_en, g.wp_name_he, g.wp_min_lat, g.wp_min_lng, g.wp_max_lat, g.wp_max_lng),
      (2, g.wn_name_en, g.wn_name_he, g.wn_min_lat, g.wn_min_lng, g.wn_max_lat, g.wn_max_lng)
    ) as w(side, name_en, name_he, min_lat, min_lng, max_lat, max_lng)
    where w.name_en is not null
    group by g.chokepoint
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', a.id,
    'crossings_24h', a.crossings_24h,
    'tankers_24h', a.tankers_24h,
    'avg_7d', case when coalesce(sp.week_days, 0) > 0 then round(a.week_n::numeric / greatest(sp.week_days, 1)::numeric, 1) else 0 end,
    'days', floor(coalesce(sp.base_days, 0))::int,
    'pct_normal', case when coalesce(sp.base_days, 0) >= 7 and a.past_n > 0
                       then round(100 * a.crossings_24h::numeric / (a.past_n::numeric / sp.base_days::numeric)) end,
    'waiting', coalesce(w.waiting, '[]'::jsonb),
    'last', (select jsonb_build_object('mmsi', l.mmsi, 'name', l.name, 'ship_type', l.ship_type, 'dir_en', l.dir_en, 'dir_he', l.dir_he, 'at', l.at)
             from c l where l.chokepoint = a.id order by l.at desc limit 1)
  ) order by cp.ord), '[]'::jsonb)
  from agg a join cp on cp.id = a.id left join waits w on w.chokepoint = a.id cross join span sp;
$$;
revoke all on function public.chokepoint_stats() from public;
grant execute on function public.chokepoint_stats() to anon, authenticated;
