-- ════════════════════════════════════════════════════════════════════
-- Osintfront · Migration 62 — Lebanon: Hebrew names everywhere + wadi courses
-- 1. lebanon_missing_hebrew: villages (all of Lebanon) and wadis / streams / valleys
--    without a Hebrew name, in parts so several batches can run at once
--    (event-agent {action:"hebrew_lebanon", kind, part, parts}; Haiku, marked he_from_ai).
-- 2. osm_waterways: named waterways and valleys of Lebanon from OpenStreetMap, as lines
--    (event-agent {action:"osm_wadis"}). build_wadi_lines() joins the pieces of each
--    wadi into wadi_lines (one row per wadi course; only new courses are added) and takes the Hebrew name from the
--    place database where the names match nearby.
-- 3. wadi_lines_geojson(): the map layer "Wadis".
-- ════════════════════════════════════════════════════════════════════

-- Small index so the batches do not scan the whole place table (it overloaded the database).
create index if not exists geo_places_lb_no_he_idx on public.geo_places (geonameid) where country_code = 'LB' and name_he is null;

create or replace function public.lebanon_missing_hebrew(p_kind text, p_limit integer default 120, p_part integer default 0, p_parts integer default 1)
returns table (geonameid bigint, name_ar text, name text) language sql stable security definer set search_path = '' as $$
  select g.geonameid, g.name_ar, g.name from public.geo_places g
  where g.country_code = 'LB' and g.name_he is null
    and case p_kind when 'village' then g.feature_class = 'P'
                    when 'wadi' then g.feature_code in ('WAD', 'STM', 'VAL')
                    else false end
    and g.geonameid % greatest(p_parts, 1) = p_part
  -- The south first (the front), then by size.
  order by (extensions.st_y(g.geom) < 33.62) desc, g.population desc, g.geonameid
  limit p_limit
$$;
revoke execute on function public.lebanon_missing_hebrew(text, integer, integer, integer) from public, anon, authenticated;
grant execute on function public.lebanon_missing_hebrew(text, integer, integer, integer) to service_role;

-- ── OpenStreetMap waterways ────────────────────────────────────────────────────
create table if not exists public.osm_waterways (
  way_id     bigint primary key,
  kind       text not null,            -- waterway=* or valley
  name       text not null,
  name_ar    text,
  name_en    text,
  name_he    text,
  geom       extensions.geometry(LineString, 4326) not null,
  synced_at  timestamptz not null default now()
);
alter table public.osm_waterways enable row level security;
revoke all on public.osm_waterways from anon, authenticated;

create or replace function public.upsert_osm_waterways(p_rows jsonb)
returns integer language plpgsql security definer set search_path = '' as $$
declare v_n integer;
begin
  insert into public.osm_waterways (way_id, kind, name, name_ar, name_en, name_he, geom, synced_at)
  select r.way_id, r.kind, r.name, nullif(r.name_ar, ''), nullif(r.name_en, ''), nullif(r.name_he, ''),
         extensions.st_setsrid(extensions.st_geomfromgeojson(r.geometry::text), 4326), now()
  from jsonb_to_recordset(p_rows) as r(way_id bigint, kind text, name text, name_ar text, name_en text, name_he text, geometry jsonb)
  where r.way_id is not null and coalesce(r.name, '') <> ''
  on conflict (way_id) do update set kind = excluded.kind, name = excluded.name, name_ar = excluded.name_ar,
    name_en = excluded.name_en, name_he = excluded.name_he, geom = excluded.geom, synced_at = excluded.synced_at;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;
revoke execute on function public.upsert_osm_waterways(jsonb) from public, anon, authenticated;
grant execute on function public.upsert_osm_waterways(jsonb) to service_role;

-- One row per wadi course: the pieces with the same name that touch or lie within ~1 km.
create table if not exists public.wadi_lines (
  id          bigserial primary key,
  kind        text not null,
  name        text not null,
  name_ar     text,
  name_en     text,
  name_he     text,
  he_from_ai  boolean not null default false,
  geom        extensions.geometry(MultiLineString, 4326) not null,
  length_km   numeric(8, 2),
  way_ids     bigint[] not null default '{}'
);
create index if not exists wadi_lines_geom_gist on public.wadi_lines using gist (geom);
alter table public.wadi_lines enable row level security;
revoke all on public.wadi_lines from anon, authenticated;
grant select on public.wadi_lines to authenticated;
create policy "wadis: members read" on public.wadi_lines for select to authenticated using ((select public.is_member()));

create or replace function public.build_wadi_lines()
returns integer language plpgsql security definer set search_path = '' as $$
declare v_n integer;
begin
  -- New courses only: a course whose pieces are already in wadi_lines stays as it is
  -- (with its Hebrew name), so running it again after a refresh only adds what is new.
  insert into public.wadi_lines (kind, name, name_ar, name_en, name_he, geom, length_km, way_ids)
  select kind, name, name_ar, name_en, name_he, geom, length_km, way_ids from (
    select (array_agg(kind order by extensions.st_length(geom) desc))[1] kind,
           name, max(name_ar) name_ar, max(name_en) name_en, max(name_he) name_he,
           extensions.st_multi(extensions.st_linemerge(extensions.st_collect(geom))) geom,
           round((sum(extensions.st_length(geom::extensions.geography)) / 1000)::numeric, 2) length_km,
           array_agg(way_id) way_ids
    from (
      select w.*, extensions.st_clusterdbscan(w.geom, 0.01, 1) over (partition by lower(w.name)) c
      from public.osm_waterways w
    ) x
    group by name, c
  ) n
  where not exists (select 1 from public.wadi_lines e where e.way_ids && n.way_ids);
  get diagnostics v_n = row_count;
  -- The place database's Hebrew name for a wadi of the same name within 3 km.
  with m as (
    select l.id, (
      select array[p.name_he, coalesce(p.he_from_ai, false)::text] from public.geo_places p
      where p.country_code = 'LB' and p.feature_code in ('WAD', 'STM', 'VAL') and p.name_he is not null
        and extensions.st_dwithin(p.geom, l.geom, 0.03)
        and (public.normalize_place(p.name_ar) = public.normalize_place(l.name_ar)
             or public.normalize_place(p.name) = public.normalize_place(coalesce(l.name_en, l.name)))
      order by extensions.st_distance(p.geom, l.geom) limit 1) he
    from public.wadi_lines l where l.name_he is null
  )
  update public.wadi_lines l set name_he = m.he[1], he_from_ai = m.he[2]::boolean
    from m where m.id = l.id and m.he is not null;
  return v_n;
end;
$$;
revoke execute on function public.build_wadi_lines() from public, anon, authenticated;
grant execute on function public.build_wadi_lines() to service_role;

create or replace function public.wadi_lines_missing_hebrew(p_limit integer default 120)
returns table (id bigint, name_ar text, name text) language sql stable security definer set search_path = '' as $$
  select l.id, l.name_ar, coalesce(l.name_en, l.name) from public.wadi_lines l
  where l.name_he is null order by (extensions.st_y(extensions.st_centroid(l.geom)) < 33.62) desc, l.length_km desc nulls last, l.id limit p_limit
$$;
create or replace function public.set_hebrew_wadi_names(p_rows jsonb)
returns integer language plpgsql security definer set search_path = '' as $$
declare v_n integer;
begin
  update public.wadi_lines l set name_he = r.name_he, he_from_ai = true
  from jsonb_to_recordset(p_rows) as r(geonameid bigint, name_he text)
  where l.id = r.geonameid and l.name_he is null and coalesce(r.name_he, '') <> '';
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;
revoke execute on function public.wadi_lines_missing_hebrew(integer), public.set_hebrew_wadi_names(jsonb) from public, anon, authenticated;
grant execute on function public.wadi_lines_missing_hebrew(integer), public.set_hebrew_wadi_names(jsonb) to service_role;

-- Map layer: every wadi course of Lebanon, simplified (~20 m), as one GeoJSON collection.
create or replace function public.wadi_lines_geojson()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('type', 'FeatureCollection', 'features', coalesce(jsonb_agg(jsonb_build_object(
    'type', 'Feature',
    'geometry', extensions.st_asgeojson(extensions.st_simplify(l.geom, 0.0002), 5)::jsonb,
    'properties', jsonb_build_object('id', l.id, 'kind', l.kind, 'name', l.name, 'ar', l.name_ar, 'en', l.name_en,
                                     'he', l.name_he, 'ai', l.he_from_ai, 'km', l.length_km)
  )), '[]'::jsonb))
  from public.wadi_lines l
  where (select public.is_member())
$$;
revoke execute on function public.wadi_lines_geojson() from public, anon;
grant execute on function public.wadi_lines_geojson() to authenticated;
