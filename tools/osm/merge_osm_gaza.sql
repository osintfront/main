-- One-time (done 23 Oct 2026): OpenStreetMap names for the Gaza Strip (ODbL, "© OpenStreetMap contributors").
-- 1. Download (from pg_cron: the Overpass call can take a minute; mirrors when overpass-api.de is busy):
--    node(31.21,34.2,31.6,34.58)[place~"^(village|town|city|hamlet|suburb|neighbourhood|quarter|locality)$"]
--    into public.osm_places_stage (country 'PS'), same CSV columns as merge_osm_places.sql.
-- 2. Merge — only points inside public.gaza_strip() (the box also covers Israeli communities).
--    Neighbourhoods / quarters are added as PPLX. One statement (no temp tables).
with o0 as (
  select f[1]::bigint osm_id, f[2]::float8 lat, f[3]::float8 lng, f[4] place,
         nullif(f[5], '') name, nullif(f[6], '') name_ar, nullif(f[7], '') name_en, nullif(f[8], '') name_he,
         nullif(regexp_replace(coalesce(f[9], ''), '[^0-9]', '', 'g'), '')::bigint pop
  from public.osm_places_stage s, string_to_table(s.content, E'\n') l, lateral (select string_to_array(l, E'\t') f) x
  where s.country = 'PS' and l <> '' and array_length(f, 1) >= 8 and f[1] ~ '^[0-9]+$'
), o as (
  select o0.*, public.normalize_places(array[name, name_ar, name_en, name_he]) nn,
         extensions.st_setsrid(extensions.st_makepoint(lng, lat), 4326) pt
  from o0 where extensions.st_within(extensions.st_setsrid(extensions.st_makepoint(lng, lat), 4326), public.gaza_strip())
), m as (
  select o.*, g.geonameid from o
  cross join lateral (
    select g.geonameid from public.geo_places g
    where extensions.st_dwithin(g.geom, o.pt, 0.025) and g.country_code = 'PS' and g.names && o.nn
    order by g.geom operator(extensions.<->) o.pt limit 1
  ) g
), upd as (
  update public.geo_places g set
    name_he = case when m.name_he is not null and (g.name_he is null or g.he_from_ai) then m.name_he else g.name_he end,
    he_from_ai = case when m.name_he is not null and (g.name_he is null or g.he_from_ai) then false else g.he_from_ai end,
    name_ar = coalesce(g.name_ar, m.name_ar),
    name_en = coalesce(m.name_en, g.name_en),
    names = (select array_agg(distinct x) from unnest(g.names || m.nn) x)
  from m where g.geonameid = m.geonameid
  returning g.geonameid
), ins as (
  insert into public.geo_places (geonameid, name, name_he, name_ar, name_en, names, country_code, feature_class, feature_code, population, geom)
  select -o.osm_id, coalesce(o.name, o.name_en, o.name_ar), o.name_he, o.name_ar, coalesce(o.name_en, o.name),
         o.nn, 'PS', 'P',
         case o.place when 'city' then 'PPLA2' when 'town' then 'PPL' when 'village' then 'PPL' when 'hamlet' then 'PPL' else 'PPLX' end,
         coalesce(o.pop, 0), o.pt
  from o
  where not exists (select 1 from m where m.osm_id = o.osm_id) and coalesce(o.name, o.name_en, o.name_ar) is not null
  on conflict (geonameid) do update set name_he = coalesce(excluded.name_he, public.geo_places.name_he),
    name_ar = excluded.name_ar, name_en = excluded.name_en, names = excluded.names, geom = excluded.geom
  returning geonameid
)
select (select count(*) from o) osm_in_gaza, (select count(*) from upd) updated, (select count(*) from ins) inserted;
-- Result 23 Oct 2026: 53 OSM places in the Strip, 33 merged, 19 added. Netiv HaAsara (Israel, on the
-- border) was set back to IL and the polygon tightened there.
