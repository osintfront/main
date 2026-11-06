-- chokepoint_stats: with no crossings yet, report 0 days (Postgres least/greatest skip NULLs, so least(28, NULL) was 28).
create or replace function public.chokepoint_stats()
returns jsonb language sql stable security definer set search_path = '' as $$
  with cp(id, ord) as (values ('hormuz', 1), ('bab_el_mandeb', 2), ('suez', 3), ('tiran', 4), ('bosphorus', 5), ('dardanelles', 6)),
  -- When collection started: the first recorded crossing anywhere (crossings are kept 60 days).
  start as (select min(at) as t from public.ais_crossings),
  span as (
    select
      greatest(0, least(28, coalesce(extract(epoch from (now() - interval '24 hours') - s.t) / 86400.0, 0))) as base_days,
      greatest(0, least(7, coalesce(extract(epoch from now() - s.t) / 86400.0, 0))) as week_days
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
