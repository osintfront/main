-- One-time: add OpenStreetMap place names (Hebrew / Arabic / English) to geo_places.
-- 1. Download (inside the database, Overpass API, ODbL — credit "© OpenStreetMap contributors"):
--    insert into public.osm_places_stage (country, content)
--    select 'SY', content from extensions.http_get('https://overpass-api.de/api/interpreter?data=' || extensions.urlencode(
--      '[out:csv(::id,::lat,::lon,place,name,"name:ar","name:en","name:he",population;false;"\t")][timeout:100];'
--      'area["ISO3166-1"="SY"][admin_level=2]->.a;node(area.a)[place~"^(village|town|city|hamlet)$"];out;')) where status = 200;
-- 2. Merge (this file): a GeoNames place within 2.5 km sharing a name gets the OSM names
--    (OSM Hebrew beats an AI-written Hebrew name; OSM English replaces GeoNames' French-style
--    spellings); other OSM places are added with geonameid = -<osm node id>.
do $$
declare v_cc text := 'SY';
begin
  create temp table o on commit drop as
  select f[1]::bigint osm_id, f[2]::float8 lat, f[3]::float8 lng, f[4] place,
         nullif(f[5], '') name, nullif(f[6], '') name_ar, nullif(f[7], '') name_en, nullif(f[8], '') name_he,
         nullif(regexp_replace(coalesce(f[9], ''), '[^0-9]', '', 'g'), '')::bigint pop
  from public.osm_places_stage s, string_to_table(s.content, E'\n') l, lateral (select string_to_array(l, E'\t') f) x
  where s.country = v_cc and l <> '' and array_length(f, 1) >= 8 and f[1] ~ '^[0-9]+$';

  create temp table m on commit drop as
  select distinct on (o.osm_id) o.*, g.geonameid
  from o
  join public.geo_places g
    on g.country_code = v_cc
   and extensions.st_dwithin(g.geom::extensions.geography, extensions.st_setsrid(extensions.st_makepoint(o.lng, o.lat), 4326)::extensions.geography, 2500)
   and g.names && public.normalize_places(array[o.name, o.name_ar, o.name_en, o.name_he])
  order by o.osm_id, extensions.st_distance(g.geom::extensions.geography, extensions.st_setsrid(extensions.st_makepoint(o.lng, o.lat), 4326)::extensions.geography);

  update public.geo_places g set
    name_he = case when m.name_he is not null and (g.name_he is null or g.he_from_ai) then m.name_he else g.name_he end,
    he_from_ai = case when m.name_he is not null and (g.name_he is null or g.he_from_ai) then false else g.he_from_ai end,
    name_ar = coalesce(g.name_ar, m.name_ar),
    name_en = coalesce(m.name_en, g.name_en),
    names = (select array_agg(distinct x) from unnest(g.names || public.normalize_places(array[m.name, m.name_ar, m.name_en, m.name_he])) x)
  from m where g.geonameid = m.geonameid;

  insert into public.geo_places (geonameid, name, name_he, name_ar, name_en, names, country_code, feature_class, feature_code, population, geom)
  select -o.osm_id, coalesce(o.name, o.name_en, o.name_ar), o.name_he, o.name_ar, coalesce(o.name_en, o.name),
         public.normalize_places(array[o.name, o.name_ar, o.name_en, o.name_he]), v_cc, 'P',
         case o.place when 'city' then 'PPLA2' when 'town' then 'PPL' else 'PPL' end, coalesce(o.pop, 0),
         extensions.st_setsrid(extensions.st_makepoint(o.lng, o.lat), 4326)
  from o
  where not exists (select 1 from m where m.osm_id = o.osm_id) and coalesce(o.name, o.name_en, o.name_ar) is not null
  on conflict (geonameid) do update set name_he = coalesce(excluded.name_he, public.geo_places.name_he),
    name_ar = excluded.name_ar, name_en = excluded.name_en, names = excluded.names, geom = excluded.geom;

  delete from public.osm_places_stage where country = v_cc;
end $$;
