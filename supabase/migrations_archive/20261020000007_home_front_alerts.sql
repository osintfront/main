-- ════════════════════════════════════════════════════════════════════
-- Osintfront · Migration 7 — Home Front Command (Pikud HaOref) alerts
--
-- Source: the free public feed of the Tzofar / "Tzeva Adom" app
-- (api.tzevaadom.co.il), which relays Home Front Command alerts and is
-- reachable from outside Israel. The official oref.org.il feed blocks
-- non-Israeli servers, so it can't be called from this project's region.
--
--   hfc_areas      every alert area (≈1,450) with its official polygon
--   hfc_alerts     every alert received: one row per area per siren
--   hfc_clusters   what the map shows: alerts of the same threat type that
--                  are close in space (merge_km) and time (ttl_minutes) are
--                  merged into one growing polygon. Each new alert in the
--                  cluster restarts its timer; it disappears ttl_minutes
--                  after the last alert.
--   hfc_pulse      one-row table the site listens to over Realtime
--
-- pg_cron polls the live feed every 5 seconds and the history feed every
-- 20 seconds (to catch anything missed), and refreshes the area list weekly.
-- ════════════════════════════════════════════════════════════════════

create extension if not exists postgis with schema extensions;
create extension if not exists http with schema extensions;
create extension if not exists pg_cron;

-- ─── Settings ──────────────────────────────────────────────────────
insert into public.app_settings (key, value) values
  ('hfc_alerts', '{"enabled": true, "ttl_minutes": 10, "merge_km": 15, "include_drills": false}')
on conflict (key) do nothing;

-- ─── Category (shown in legend and on alert cards) ─────────────────
insert into public.event_categories (slug, name, description, icon, color, marker_color, sort_order, translations)
values ('home-front-alerts', 'Home Front Command Alerts',
        'Live red alerts from the Home Front Command, added automatically.',
        'Siren', '#ff2d2d', '#ff2d2d', 5, '{"he": "התרעות פיקוד העורף"}')
on conflict (slug) do nothing;

-- ─── Tables ────────────────────────────────────────────────────────
create table public.hfc_areas (
  name         text primary key,             -- Hebrew name exactly as used in alerts
  name_en      text,
  name_ar      text,
  name_ru      text,
  tzofar_id    integer,
  zone_id      integer,
  zone_he      text,
  zone_en      text,
  countdown_s  integer,                      -- seconds to reach shelter
  latitude     double precision,
  longitude    double precision,
  has_polygon  boolean not null default false,
  geom         extensions.geometry(MultiPolygon, 4326),
  updated_at   timestamptz not null default now()
);
create index hfc_areas_geom_idx on public.hfc_areas using gist (geom);

create table public.hfc_clusters (
  id             uuid primary key default gen_random_uuid(),
  threat         smallint not null,
  started_at     timestamptz not null,
  last_alert_at  timestamptz not null,
  expires_at     timestamptz not null,
  areas          text[] not null default '{}',
  areas_en       text[] not null default '{}',
  zones_he       text[] not null default '{}',
  zones_en       text[] not null default '{}',
  alert_count    integer not null default 0,
  geom           extensions.geometry(MultiPolygon, 4326),
  geojson        jsonb,                      -- simplified polygon for the browser
  center_lat     double precision,
  center_lng     double precision,
  merged_into    uuid references public.hfc_clusters (id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index hfc_clusters_active_idx on public.hfc_clusters (expires_at) where merged_into is null;
create index hfc_clusters_threat_idx on public.hfc_clusters (threat, last_alert_at desc) where merged_into is null;

create table public.hfc_alerts (
  id           bigserial primary key,
  alerted_at   timestamptz not null,
  area_name    text not null,
  threat       smallint not null,
  is_drill     boolean not null default false,
  source       text not null,
  cluster_id   uuid references public.hfc_clusters (id) on delete set null,
  received_at  timestamptz not null default now(),
  unique (area_name, threat, alerted_at)
);
create index hfc_alerts_time_idx on public.hfc_alerts (alerted_at desc);
create index hfc_alerts_cluster_idx on public.hfc_alerts (cluster_id);

create table public.hfc_ingest_status (
  source         text primary key,
  last_ok_at     timestamptz,
  last_error     text,
  last_error_at  timestamptz
);

create table public.hfc_pulse (
  id          integer primary key check (id = 1),
  changed_at  timestamptz not null default now()
);
insert into public.hfc_pulse (id) values (1);

-- ─── Access ────────────────────────────────────────────────────────
alter table public.hfc_areas         enable row level security;
alter table public.hfc_clusters      enable row level security;
alter table public.hfc_alerts        enable row level security;
alter table public.hfc_ingest_status enable row level security;
alter table public.hfc_pulse         enable row level security;

revoke all on public.hfc_areas, public.hfc_clusters, public.hfc_alerts,
              public.hfc_ingest_status, public.hfc_pulse from anon, authenticated;

-- Staff can inspect everything (read-only); only the server writes.
grant select on public.hfc_areas, public.hfc_alerts, public.hfc_ingest_status to authenticated;
create policy "hfc areas: staff read" on public.hfc_areas for select to authenticated
  using ((select public.has_permission('dashboard.view')));
create policy "hfc alerts: staff read" on public.hfc_alerts for select to authenticated
  using ((select public.has_permission('dashboard.view')));
create policy "hfc status: staff read" on public.hfc_ingest_status for select to authenticated
  using ((select public.has_permission('dashboard.view')));

-- Public: active clusters only, without the raw geometry column.
grant select (id, threat, started_at, last_alert_at, expires_at, areas, areas_en, zones_he, zones_en,
              alert_count, geojson, center_lat, center_lng, merged_into)
  on public.hfc_clusters to anon, authenticated;
create policy "hfc clusters: public active" on public.hfc_clusters for select to anon, authenticated
  using (merged_into is null and expires_at > now() - interval '1 minute');

grant select on public.hfc_pulse to anon, authenticated;
create policy "hfc pulse: public read" on public.hfc_pulse for select to anon, authenticated using (true);

create view public.active_hfc_alerts
with (security_invoker = true, security_barrier = true)
as
select id, threat, started_at, last_alert_at, expires_at, areas, areas_en, zones_he, zones_en,
       alert_count, geojson, center_lat, center_lng
from public.hfc_clusters
where merged_into is null and expires_at > now();
grant select on public.active_hfc_alerts to anon, authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.hfc_pulse;
  end if;
end $$;

-- ─── Geometry helpers ──────────────────────────────────────────────
-- Tzofar ring: [[lat, lng], …] → valid MultiPolygon (null if unusable).
create or replace function public.hfc_ring_to_geom(p jsonb)
returns extensions.geometry
language plpgsql immutable set search_path = '' as $$
declare
  v_wkt text;
  v_g   extensions.geometry;
begin
  if jsonb_typeof(p) is distinct from 'array' or jsonb_array_length(p) < 3
     or jsonb_typeof(p -> 0) is distinct from 'array' or jsonb_typeof(p -> 0 -> 0) is distinct from 'number' then
    return null;
  end if;
  select string_agg((pt ->> 1) || ' ' || (pt ->> 0), ',' order by ord) into v_wkt
  from jsonb_array_elements(p) with ordinality x(pt, ord);
  v_wkt := 'POLYGON((' || v_wkt || ',' || (p -> 0 ->> 1) || ' ' || (p -> 0 ->> 0) || '))';
  v_g := extensions.st_collectionextract(extensions.st_makevalid(extensions.st_geomfromtext(v_wkt, 4326)), 3);
  if v_g is null or extensions.st_isempty(v_g) then return null; end if;
  return extensions.st_multi(v_g);
exception when others then
  return null;
end;
$$;

-- Load / refresh all alert areas and their polygons.
create or replace function public.hfc_sync_areas()
returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_resp   extensions.http_response;
  v_cities jsonb;
  v_polys  jsonb;
  v_n      integer;
begin
  perform extensions.http_set_curlopt('CURLOPT_TIMEOUT', '30');
  select * into v_resp from extensions.http_get('https://www.tzevaadom.co.il/static/cities.json');
  if v_resp.status <> 200 then raise exception 'cities.json returned HTTP %', v_resp.status; end if;
  v_cities := v_resp.content::jsonb;
  select * into v_resp from extensions.http_get('https://www.tzevaadom.co.il/static/polygons.json');
  if v_resp.status <> 200 then raise exception 'polygons.json returned HTTP %', v_resp.status; end if;
  v_polys := v_resp.content::jsonb;

  with src as (
    select e.key as name, e.value as v,
           public.hfc_ring_to_geom(v_polys -> (e.value ->> 'id')) as poly
    from jsonb_each(v_cities -> 'cities') e
    where btrim(e.key) <> ''
  )
  insert into public.hfc_areas as a
    (name, name_en, name_ar, name_ru, tzofar_id, zone_id, zone_he, zone_en, countdown_s,
     latitude, longitude, has_polygon, geom, updated_at)
  select s.name, s.v ->> 'en', s.v ->> 'ar', s.v ->> 'ru',
         nullif(s.v ->> 'id', '')::integer, nullif(s.v ->> 'area', '')::integer,
         v_cities -> 'areas' -> (s.v ->> 'area') ->> 'he',
         v_cities -> 'areas' -> (s.v ->> 'area') ->> 'en',
         nullif(s.v ->> 'countdown', '')::integer,
         nullif(s.v ->> 'lat', '')::double precision, nullif(s.v ->> 'lng', '')::double precision,
         s.poly is not null,
         coalesce(s.poly,
           -- No polygon published: a 1.5 km circle around the locality.
           case when s.v ->> 'lat' is not null and s.v ->> 'lng' is not null then
             extensions.st_multi(extensions.st_buffer(
               extensions.st_setsrid(extensions.st_makepoint((s.v ->> 'lng')::float8, (s.v ->> 'lat')::float8), 4326)::extensions.geography,
               1500)::extensions.geometry)
           end),
         now()
  from src s
  on conflict (name) do update set
    name_en = excluded.name_en, name_ar = excluded.name_ar, name_ru = excluded.name_ru,
    tzofar_id = excluded.tzofar_id, zone_id = excluded.zone_id, zone_he = excluded.zone_he,
    zone_en = excluded.zone_en, countdown_s = excluded.countdown_s,
    latitude = excluded.latitude, longitude = excluded.longitude,
    has_polygon = excluded.has_polygon, geom = excluded.geom, updated_at = now();
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

-- Rebuild a cluster's merged polygon, centre and display names.
create or replace function public.hfc_refresh_cluster(p_id uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_areas    text[];
  v_geom     extensions.geometry;
  v_names_en text[];
  v_zones_he text[];
  v_zones_en text[];
  v_pt       extensions.geometry;
begin
  select areas into v_areas from public.hfc_clusters where id = p_id;
  if v_areas is null then return; end if;

  -- A small buffer closes the hairline gaps between neighbouring areas.
  select extensions.st_multi(extensions.st_collectionextract(
           extensions.st_union(extensions.st_buffer(a.geom, 0.0004)), 3))
    into v_geom
  from public.hfc_areas a
  where a.name = any (v_areas) and a.geom is not null;

  select array_agg(coalesce(a.name_en, u.n) order by u.o) into v_names_en
  from unnest(v_areas) with ordinality u(n, o)
  left join public.hfc_areas a on a.name = u.n;

  select coalesce(array_agg(z.zone_he order by z.first_o), '{}'), coalesce(array_agg(z.zone_en order by z.first_o), '{}')
    into v_zones_he, v_zones_en
  from (
    select a.zone_he, max(a.zone_en) as zone_en, min(u.o) as first_o
    from unnest(v_areas) with ordinality u(n, o)
    join public.hfc_areas a on a.name = u.n
    where a.zone_he is not null
    group by a.zone_he
  ) z;

  if v_geom is not null and not extensions.st_isempty(v_geom) then
    v_pt := extensions.st_pointonsurface(v_geom);
  else
    v_geom := null;
  end if;

  update public.hfc_clusters set
    geom       = v_geom,
    geojson    = case when v_geom is null then null
                      else extensions.st_asgeojson(extensions.st_simplifypreservetopology(v_geom, 0.0002), 5)::jsonb end,
    center_lat = extensions.st_y(v_pt),
    center_lng = extensions.st_x(v_pt),
    areas_en   = coalesce(v_names_en, '{}'),
    zones_he   = v_zones_he,
    zones_en   = v_zones_en,
    updated_at = now()
  where id = p_id;
end;
$$;

-- ─── Recording one alert (one area, one siren) ─────────────────────
-- Returns true when the alert is new.
create or replace function public.hfc_record_alert(
  p_area text, p_threat integer, p_at timestamptz, p_drill boolean, p_source text
)
returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  v_settings       jsonb;
  v_ttl            interval;
  v_merge_m        double precision;
  v_include_drills boolean;
  v_area           text := btrim(coalesce(p_area, ''));
  v_alert_id       bigint;
  v_geom           extensions.geometry;
  v_ids            uuid[];
  v_target         uuid;
begin
  if v_area = '' or p_at is null then return false; end if;

  select value into v_settings from public.app_settings where key = 'hfc_alerts';
  v_ttl := make_interval(mins => greatest(1, coalesce((v_settings ->> 'ttl_minutes')::integer, 10)));
  v_merge_m := greatest(0, coalesce((v_settings ->> 'merge_km')::numeric, 15)) * 1000;
  v_include_drills := coalesce((v_settings ->> 'include_drills')::boolean, false);

  insert into public.hfc_alerts (alerted_at, area_name, threat, is_drill, source)
  values (p_at, v_area, coalesce(p_threat, 8), coalesce(p_drill, false), p_source)
  on conflict (area_name, threat, alerted_at) do nothing
  returning id into v_alert_id;
  if v_alert_id is null then return false; end if;           -- already have it
  if coalesce(p_drill, false) and not v_include_drills then return true; end if;

  select geom into v_geom from public.hfc_areas where name = v_area;

  -- Live clusters of the same threat that this alert continues: same area,
  -- or within merge distance, and within the timer window.
  select array_agg(c.id order by c.started_at, c.id) into v_ids
  from public.hfc_clusters c
  where c.threat = coalesce(p_threat, 8)
    and c.merged_into is null
    and p_at between c.started_at - v_ttl and c.last_alert_at + v_ttl
    and (v_area = any (c.areas)
         or (v_geom is not null and c.geom is not null
             and extensions.st_dwithin(c.geom::extensions.geography, v_geom::extensions.geography, v_merge_m)));

  if v_ids is null then
    insert into public.hfc_clusters (threat, started_at, last_alert_at, expires_at, areas, alert_count)
    values (coalesce(p_threat, 8), p_at, p_at, p_at + v_ttl, array[v_area], 1)
    returning id into v_target;
  else
    v_target := v_ids[1];
    if array_length(v_ids, 1) > 1 then
      -- This alert bridges several live clusters: fold them into the oldest.
      update public.hfc_clusters t set
        areas         = (select array_agg(distinct x) from public.hfc_clusters c, unnest(c.areas) x where c.id = any (v_ids)),
        alert_count   = (select sum(c.alert_count) from public.hfc_clusters c where c.id = any (v_ids)),
        started_at    = (select min(c.started_at) from public.hfc_clusters c where c.id = any (v_ids)),
        last_alert_at = (select max(c.last_alert_at) from public.hfc_clusters c where c.id = any (v_ids))
      where t.id = v_target;
      update public.hfc_clusters set merged_into = v_target, updated_at = now() where id = any (v_ids[2:]);
      update public.hfc_alerts set cluster_id = v_target where cluster_id = any (v_ids[2:]);
    end if;
    update public.hfc_clusters set
      areas         = case when v_area = any (areas) then areas else areas || v_area end,
      alert_count   = alert_count + 1,
      started_at    = least(started_at, p_at),
      last_alert_at = greatest(last_alert_at, p_at)
    where id = v_target;
  end if;

  -- Every alert in the cluster restarts its timer.
  update public.hfc_clusters set expires_at = last_alert_at + v_ttl where id = v_target;
  update public.hfc_alerts set cluster_id = v_target where id = v_alert_id;
  perform public.hfc_refresh_cluster(v_target);
  update public.hfc_pulse set changed_at = now() where id = 1;
  return true;
end;
$$;

-- ─── Polling the feed ──────────────────────────────────────────────
-- p_mode 'live': current alerts (every 5 s). 'history': recent alert
-- groups (every 20 s) — a safety net for anything the live poll missed.
create or replace function public.hfc_ingest(p_mode text default 'live')
returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_settings jsonb;
  v_resp     extensions.http_response;
  v_body     jsonb;
  v_items    jsonb := '[]'::jsonb;
  v_n        integer := 0;
  r          record;
begin
  select value into v_settings from public.app_settings where key = 'hfc_alerts';
  if not coalesce((v_settings ->> 'enabled')::boolean, false) then return 0; end if;
  -- Live and history polls never run over each other.
  if not pg_try_advisory_xact_lock(hashtext('osintfront.hfc_ingest')) then return 0; end if;

  begin
    perform extensions.http_set_curlopt('CURLOPT_TIMEOUT', '4');
    select * into v_resp from extensions.http((
      'GET',
      case p_mode when 'history' then 'https://api.tzevaadom.co.il/alerts-history'
                  else 'https://api.tzevaadom.co.il/notifications' end,
      array[extensions.http_header('User-Agent', 'Osintfront/1.0 (+https://main-drab-chi.vercel.app)')],
      null, null)::extensions.http_request);
    if v_resp.status <> 200 then raise exception 'HTTP %', v_resp.status; end if;
    v_body := v_resp.content::jsonb;
  exception when others then
    insert into public.hfc_ingest_status as s (source, last_error, last_error_at)
    values (p_mode, left(sqlerrm, 300), now())
    on conflict (source) do update set last_error = excluded.last_error, last_error_at = excluded.last_error_at;
    return 0;
  end;

  if jsonb_typeof(v_body) = 'array' then
    if p_mode = 'history' then
      select coalesce(jsonb_agg(a), '[]'::jsonb) into v_items
      from jsonb_array_elements(v_body) g, jsonb_array_elements(coalesce(g -> 'alerts', '[]'::jsonb)) a
      where jsonb_typeof(g -> 'alerts') = 'array';
    else
      v_items := v_body;
    end if;
  end if;

  for r in
    select to_timestamp((a ->> 'time')::double precision) as t,
           coalesce(nullif(a ->> 'threat', '')::integer, 8) as threat,
           coalesce((a ->> 'isDrill')::boolean, false) as drill,
           city
    from jsonb_array_elements(v_items) a,
         jsonb_array_elements_text(case when jsonb_typeof(a -> 'cities') = 'array' then a -> 'cities' else '[]'::jsonb end) city
    where (a ->> 'time') ~ '^\d{9,11}(\.\d+)?$'
      and to_timestamp((a ->> 'time')::double precision) > now() - interval '30 minutes'
      and to_timestamp((a ->> 'time')::double precision) < now() + interval '5 minutes'
    order by 1, 4
  loop
    if public.hfc_record_alert(r.city, r.threat, r.t, r.drill, 'tzofar:' || p_mode) then
      v_n := v_n + 1;
    end if;
  end loop;

  insert into public.hfc_ingest_status as s (source, last_ok_at) values (p_mode, now())
  on conflict (source) do update set last_ok_at = excluded.last_ok_at;
  return v_n;
end;
$$;

revoke execute on function public.hfc_ring_to_geom(jsonb) from public, anon, authenticated;
revoke execute on function public.hfc_sync_areas() from public, anon, authenticated;
revoke execute on function public.hfc_refresh_cluster(uuid) from public, anon, authenticated;
revoke execute on function public.hfc_record_alert(text, integer, timestamptz, boolean, text) from public, anon, authenticated;
revoke execute on function public.hfc_ingest(text) from public, anon, authenticated;

-- ─── Initial load + schedules ──────────────────────────────────────
select public.hfc_sync_areas();

select cron.schedule('osintfront-hfc-live',    '5 seconds',   $c$select public.hfc_ingest('live')$c$);
select cron.schedule('osintfront-hfc-history', '20 seconds',  $c$select public.hfc_ingest('history')$c$);
select cron.schedule('osintfront-hfc-areas',   '17 3 * * 0',  $c$select public.hfc_sync_areas()$c$);
-- A 5-second job writes ~17k run records a day: keep only the last few hours.
select cron.schedule('osintfront-cron-cleanup', '23 * * * *',
  $c$delete from cron.job_run_details where end_time < now() - interval '6 hours'$c$);

-- Live-project note: rows used to test clustering (source = 'test', dated
-- 2020, never visible) can be removed with:
--   update public.hfc_alerts set cluster_id = null where source = 'test';
--   delete from public.hfc_clusters where started_at < '2021-01-01';
--   delete from public.hfc_alerts where source = 'test';
