-- Ships upgrade: chokepoint gates and crossings.
-- A gate is a line across a strait. When a ship's previous position (≤ 6 h old) and its new one lie on
-- opposite sides and the movement crosses the line, ais_upsert records a crossing (one per ship per gate per
-- 30 minutes). chokepoint_stats() summarises them against our own history. Everyone may read (like ais_vessels).
-- Ships now stay 72 h after last contact (silent ships), crossings 60 days.

create table if not exists public.ais_gates (
  id         text primary key,
  chokepoint text not null,
  a_lat float8 not null, a_lng float8 not null, b_lat float8 not null, b_lng float8 not null,
  -- Moving INTO the positive / negative side of the line (side = sign of (b − a) × (p − a), x = lng, y = lat).
  pos_en text not null, neg_en text not null, pos_he text not null, neg_he text not null,
  -- Waiting areas on each side (null when the chokepoint's other gate covers that side).
  wp_name_en text, wp_name_he text, wp_min_lat float8, wp_min_lng float8, wp_max_lat float8, wp_max_lng float8,
  wn_name_en text, wn_name_he text, wn_min_lat float8, wn_min_lng float8, wn_max_lat float8, wn_max_lng float8
);

create or replace function public.ais_side(a_lat float8, a_lng float8, b_lat float8, b_lng float8, p_lat float8, p_lng float8)
returns float8 language sql immutable parallel safe set search_path = '' as $$
  select sign((b_lng - a_lng) * (p_lat - a_lat) - (b_lat - a_lat) * (p_lng - a_lng));
$$;

-- Seed: each side is given by a reference box; which one is "positive" is computed from the gate's geometry.
with s(id, chokepoint, a_lat, a_lng, b_lat, b_lng,
       s1_move_en, s1_move_he, s1_place_en, s1_place_he, s1_box,
       s2_move_en, s2_move_he, s2_place_en, s2_place_he, s2_box, s1_ref, s2_ref) as (values
  ('hormuz', 'hormuz', 26.35, 56.42, 26.95, 56.36,
   'into the Gulf', 'לתוך המפרץ', 'in the Gulf', 'במפרץ', array[25.0, 54.5, 26.9, 56.3],
   'out of the Gulf', 'אל מחוץ למפרץ', 'in the Gulf of Oman', 'במפרץ עומאן', array[24.8, 56.5, 26.3, 57.8], null::float8[], null::float8[]),
  ('bab_el_mandeb', 'bab_el_mandeb', 12.70, 43.50, 12.42, 43.30,
   'into the Red Sea', 'לים סוף', 'in the Red Sea', 'בים סוף', array[12.7, 42.6, 13.6, 43.6],
   'into the Gulf of Aden', 'למפרץ עדן', 'in the Gulf of Aden', 'במפרץ עדן', array[11.8, 43.4, 12.6, 45.2], null, null),
  ('suez_n', 'suez', 31.20, 32.28, 31.20, 32.42,
   'northbound', 'צפונה', 'off Port Said', 'מול פורט סעיד', array[31.2, 32.1, 31.6, 32.6],
   'southbound', 'דרומה', null, null, null, null, array[31.0, 32.35]),
  ('suez_s', 'suez', 29.92, 32.52, 29.92, 32.62,
   'northbound', 'צפונה', null, null, null,
   'southbound', 'דרומה', 'in the Gulf of Suez', 'במפרץ סואץ', array[29.6, 32.45, 29.92, 32.7], array[30.1, 32.57], null),
  ('bosphorus', 'bosphorus', 41.09, 29.04, 41.09, 29.08,
   'northbound (to the Black Sea)', 'צפונה (לים השחור)', 'in the Black Sea', 'בים השחור', array[41.2, 28.9, 41.45, 29.4],
   'southbound (to Marmara)', 'דרומה (לים מרמרה)', 'in the Sea of Marmara', 'בים מרמרה', array[40.85, 28.8, 41.0, 29.2], null, null),
  ('dardanelles', 'dardanelles', 40.14, 26.37, 40.16, 26.43,
   'into the Aegean', 'לים האגאי', 'in the Aegean', 'בים האגאי', array[39.9, 25.9, 40.1, 26.2],
   'into Marmara', 'לים מרמרה', 'in the Sea of Marmara', 'בים מרמרה', array[40.3, 26.6, 40.6, 27.2], null, null),
  ('tiran', 'tiran', 27.98, 34.41, 27.93, 34.52,
   'into the Gulf of Aqaba', 'למפרץ אילת', 'in the Gulf of Aqaba', 'במפרץ אילת', array[28.0, 34.4, 28.4, 34.8],
   'into the Red Sea', 'לים סוף', 'in the Red Sea', 'בים סוף', array[27.6, 34.2, 27.9, 34.6], null, null)
), r as (
  -- Reference point of each side: its box centre, or the explicit point when the side has no waiting box.
  select s.*,
    public.ais_side(a_lat, a_lng, b_lat, b_lng,
      coalesce(s1_ref[1], (s1_box[1] + s1_box[3]) / 2), coalesce(s1_ref[2], (s1_box[2] + s1_box[4]) / 2)) as s1_side
  from s
)
insert into public.ais_gates (id, chokepoint, a_lat, a_lng, b_lat, b_lng, pos_en, neg_en, pos_he, neg_he,
  wp_name_en, wp_name_he, wp_min_lat, wp_min_lng, wp_max_lat, wp_max_lng, wn_name_en, wn_name_he, wn_min_lat, wn_min_lng, wn_max_lat, wn_max_lng)
select id, chokepoint, a_lat, a_lng, b_lat, b_lng,
  case when s1_side > 0 then s1_move_en else s2_move_en end, case when s1_side > 0 then s2_move_en else s1_move_en end,
  case when s1_side > 0 then s1_move_he else s2_move_he end, case when s1_side > 0 then s2_move_he else s1_move_he end,
  case when s1_side > 0 then s1_place_en else s2_place_en end, case when s1_side > 0 then s1_place_he else s2_place_he end,
  (case when s1_side > 0 then s1_box else s2_box end)[1], (case when s1_side > 0 then s1_box else s2_box end)[2],
  (case when s1_side > 0 then s1_box else s2_box end)[3], (case when s1_side > 0 then s1_box else s2_box end)[4],
  case when s1_side > 0 then s2_place_en else s1_place_en end, case when s1_side > 0 then s2_place_he else s1_place_he end,
  (case when s1_side > 0 then s2_box else s1_box end)[1], (case when s1_side > 0 then s2_box else s1_box end)[2],
  (case when s1_side > 0 then s2_box else s1_box end)[3], (case when s1_side > 0 then s2_box else s1_box end)[4]
from r
on conflict (id) do nothing;

-- Pure geometry: which gates does the movement p0 → p1 cross, and in which direction (+1 = into the positive side).
create or replace function public.ais_gate_crossings(p0_lat float8, p0_lng float8, p1_lat float8, p1_lng float8)
returns table (gate text, dir smallint) language sql stable parallel safe set search_path = '' as $$
  select g.id, (case when public.ais_side(g.a_lat, g.a_lng, g.b_lat, g.b_lng, p1_lat, p1_lng) > 0 then 1 else -1 end)::smallint
  from public.ais_gates g
  where public.ais_side(g.a_lat, g.a_lng, g.b_lat, g.b_lng, p0_lat, p0_lng)
      * public.ais_side(g.a_lat, g.a_lng, g.b_lat, g.b_lng, p1_lat, p1_lng) < 0
    and public.ais_side(p0_lat, p0_lng, p1_lat, p1_lng, g.a_lat, g.a_lng)
      * public.ais_side(p0_lat, p0_lng, p1_lat, p1_lng, g.b_lat, g.b_lng) < 0;
$$;

create table if not exists public.ais_crossings (
  id        bigserial primary key,
  gate      text not null references public.ais_gates (id),
  mmsi      bigint not null,
  dir       smallint not null check (dir in (-1, 1)),
  at        timestamptz not null default now(),
  ship_type smallint,
  name      text
);
create index if not exists ais_crossings_gate_at_idx on public.ais_crossings (gate, at desc);
create index if not exists ais_crossings_mmsi_idx on public.ais_crossings (mmsi, gate, at desc);

alter table public.ais_gates enable row level security;
alter table public.ais_crossings enable row level security;
drop policy if exists "gates: anyone reads" on public.ais_gates;
create policy "gates: anyone reads" on public.ais_gates for select to anon, authenticated using (true);
drop policy if exists "crossings: anyone reads" on public.ais_crossings;
create policy "crossings: anyone reads" on public.ais_crossings for select to anon, authenticated using (true);
revoke all on public.ais_gates, public.ais_crossings from anon, authenticated;
grant select on public.ais_gates, public.ais_crossings to anon, authenticated;

-- ais_upsert: as before, plus crossings (before positions are overwritten) and longer retention.
create or replace function public.ais_upsert(p_rows jsonb)
returns integer language plpgsql security definer set search_path = '' as $$
declare v_n integer := 0; v_m integer := 0;
begin
  insert into public.ais_crossings (gate, mmsi, dir, at, ship_type, name)
  select g.gate, r.mmsi, g.dir, coalesce(r.at, now()), coalesce(r.ship_type, v.ship_type), coalesce(nullif(r.name, ''), v.name)
  from jsonb_to_recordset(p_rows) as r(mmsi bigint, lat float8, lng float8, at timestamptz, ship_type smallint, name text)
  join public.ais_vessels v on v.mmsi = r.mmsi
  cross join lateral public.ais_gate_crossings(v.lat, v.lng, r.lat, r.lng) g
  where r.lat is not null and r.lng is not null
    and v.updated_at > coalesce(r.at, now()) - interval '6 hours'
    and not exists (select 1 from public.ais_crossings c
                    where c.mmsi = r.mmsi and c.gate = g.gate and c.at > coalesce(r.at, now()) - interval '30 minutes');

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

  -- About once an hour: ships not heard from for 72 hours leave (24–72 h = "silent"), crossings after 60 days.
  if extract(minute from now()) < 1 then
    delete from public.ais_vessels where updated_at < now() - interval '72 hours';
    delete from public.ais_crossings where at < now() - interval '60 days';
  end if;
  return v_n + v_m;
end;
$$;
revoke execute on function public.ais_upsert(jsonb) from public, anon, authenticated;
grant execute on function public.ais_upsert(jsonb) to service_role;

-- Per chokepoint: crossings, tankers, averages, % of our own normal, waiting ships, last crossing.
create or replace function public.chokepoint_stats()
returns jsonb language sql stable security definer set search_path = '' as $$
  with cp(id, ord) as (values ('hormuz', 1), ('bab_el_mandeb', 2), ('suez', 3), ('tiran', 4), ('bosphorus', 5), ('dardanelles', 6)),
  c as (
    select g.chokepoint, x.*, case when x.dir > 0 then g.pos_en else g.neg_en end as dir_en,
           case when x.dir > 0 then g.pos_he else g.neg_he end as dir_he
    from public.ais_crossings x join public.ais_gates g on g.id = x.gate
    where x.at > now() - interval '29 days'
  ),
  agg as (
    select cp.id,
      count(c.id) filter (where c.at > now() - interval '24 hours') as crossings_24h,
      count(c.id) filter (where c.at > now() - interval '24 hours' and c.ship_type between 80 and 89) as tankers_24h,
      count(c.id) filter (where c.at <= now() - interval '24 hours') as past_n,
      count(distinct date_trunc('day', c.at)) filter (where c.at <= now() - interval '24 hours') as days,
      count(c.id) filter (where c.at > now() - interval '7 days') as week_n,
      count(distinct date_trunc('day', c.at)) filter (where c.at > now() - interval '7 days') as week_days
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
    'avg_7d', round(a.week_n::numeric / greatest(a.week_days, 1), 1),
    'days', a.days,
    'pct_normal', case when a.days >= 7 and a.past_n > 0 then round(100 * a.crossings_24h::numeric / (a.past_n::numeric / a.days)) end,
    'waiting', coalesce(w.waiting, '[]'::jsonb),
    'last', (select jsonb_build_object('mmsi', l.mmsi, 'name', l.name, 'ship_type', l.ship_type, 'dir_en', l.dir_en, 'dir_he', l.dir_he, 'at', l.at)
             from c l where l.chokepoint = a.id order by l.at desc limit 1)
  ) order by cp.ord), '[]'::jsonb)
  from agg a join cp on cp.id = a.id left join waits w on w.chokepoint = a.id;
$$;
revoke all on function public.chokepoint_stats() from public;
grant execute on function public.chokepoint_stats() to anon, authenticated;
grant execute on function public.ais_gate_crossings(float8, float8, float8, float8) to anon, authenticated;
grant execute on function public.ais_side(float8, float8, float8, float8, float8, float8) to anon, authenticated;
