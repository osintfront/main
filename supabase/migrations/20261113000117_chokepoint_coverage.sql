-- Ships not recognised in all straits (bug, Ben):
--  · aisstream.io has no shore receiver at Hormuz, Bab el-Mandeb, Tiran or the Dardanelles, and only the
--    southern mouth of the Bosphorus is heard. chokepoint_stats() now also returns seen_24h (ships heard in the
--    strait in the last 24 h) so the panel can say "no AIS reception" instead of "collecting baseline" forever.
--  · The Bosphorus gate sat at 41.09°N, north of anything the receivers hear (nothing above ~41.02°N), so no
--    crossing was ever recorded. It moves to the southern mouth (Sarayburnu → Salacak). Positive side stays north.
--  · The collector runs at minutes 4,9,…,59, so the "minute < 1" clean-up in ais_upsert never ran: ships from
--    10+ days ago were still stored. A separate hourly job now does the clean-up.

update public.ais_gates set a_lat = 41.0160, a_lng = 28.9855, b_lat = 41.0195, b_lng = 29.0060 where id = 'bosphorus';

create or replace function public.ais_cleanup()
returns void language sql security definer set search_path = '' as $$
  delete from public.ais_vessels where updated_at < now() - interval '72 hours';
  delete from public.ais_crossings where at < now() - interval '60 days';
$$;
revoke all on function public.ais_cleanup() from public, anon, authenticated;

select cron.unschedule(jobid) from cron.job where jobname = 'osintfront-ais-cleanup';
select cron.schedule('osintfront-ais-cleanup', '17 * * * *', $$select public.ais_cleanup();$$);

create or replace function public.chokepoint_stats()
returns jsonb language sql stable security definer set search_path = '' as $$
  -- Coverage box per chokepoint: the strait itself, tight enough that a busy port nearby (Dubai) does not count.
  with cp(id, ord, min_lat, min_lng, max_lat, max_lng) as (values
    ('hormuz', 1, 25.8, 55.8, 27.0, 57.0), ('bab_el_mandeb', 2, 12.2, 43.0, 13.0, 43.7),
    ('suez', 3, 29.85, 32.25, 31.3, 32.65), ('tiran', 4, 27.85, 34.3, 28.1, 34.6),
    ('bosphorus', 5, 40.98, 28.95, 41.25, 29.15), ('dardanelles', 6, 39.95, 26.15, 40.45, 26.75)),
  -- Ships heard inside each box in the last 24 h: 0 = no AIS receiver covers the strait right now.
  seen as (
    select cp.id, (select count(*) from public.ais_vessels v
                   where v.updated_at > now() - interval '24 hours'
                     and v.lat between cp.min_lat and cp.max_lat and v.lng between cp.min_lng and cp.max_lng) as n
    from cp
  ),
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
    'seen_24h', se.n,
    'avg_7d', case when coalesce(sp.week_days, 0) > 0 then round(a.week_n::numeric / greatest(sp.week_days, 1)::numeric, 1) else 0 end,
    'days', floor(coalesce(sp.base_days, 0))::int,
    'pct_normal', case when coalesce(sp.base_days, 0) >= 7 and a.past_n > 0
                       then round(100 * a.crossings_24h::numeric / (a.past_n::numeric / sp.base_days::numeric)) end,
    'waiting', coalesce(w.waiting, '[]'::jsonb),
    'last', (select jsonb_build_object('mmsi', l.mmsi, 'name', l.name, 'ship_type', l.ship_type, 'dir_en', l.dir_en, 'dir_he', l.dir_he, 'at', l.at)
             from c l where l.chokepoint = a.id order by l.at desc limit 1)
  ) order by cp.ord), '[]'::jsonb)
  from agg a join cp on cp.id = a.id join seen se on se.id = a.id left join waits w on w.chokepoint = a.id cross join span sp;
$$;
revoke all on function public.chokepoint_stats() from public;
grant execute on function public.chokepoint_stats() to anon, authenticated;
