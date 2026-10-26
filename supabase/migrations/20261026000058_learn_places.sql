-- Teach the place database (geo_places, used by geo_lookup for every report) a list of places:
-- each place's names (Arabic, English, Hebrew) are added to the GeoNames place standing on it
-- (same name, or the nearest town or village within 1.5 km); a place GeoNames does not have is added.
-- Used for the villages of south Lebanon (Wikipedia, event-agent action "learn_south_lebanon").
create or replace function public.learn_places(p_rows jsonb, p_country text default 'LB')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  r        record;
  v_pt     extensions.geography;
  v_id     bigint;
  v_names  text[];
  v_new    integer := 0;
  v_known  integer := 0;
begin
  for r in select * from jsonb_to_recordset(p_rows) as x(name_ar text, name_en text, name_he text, lat float8, lng float8, source text) loop
    continue when r.lat is null or r.lng is null;
    v_pt := extensions.st_setsrid(extensions.st_makepoint(r.lng, r.lat), 4326)::extensions.geography;
    v_names := array(select distinct n from unnest(array[
      public.normalize_place(r.name_ar), public.normalize_place(r.name_en), public.normalize_place(r.name_he),
      public.normalize_place(regexp_replace(coalesce(r.name_en, ''), '\s*\(.*\)$|,.*$', ''))]) n where coalesce(n, '') <> '' and char_length(n) >= 2);
    continue when cardinality(v_names) = 0;
    -- The place itself: a GeoNames place with one of these names within 3 km, else the nearest
    -- town / village within 1.5 km.
    select g.geonameid into v_id from public.geo_places g
    where g.country_code = p_country and g.names && v_names
      and extensions.st_dwithin(g.geom::extensions.geography, v_pt, 3000)
    order by extensions.st_distance(g.geom::extensions.geography, v_pt) limit 1;
    if v_id is null then
      select g.geonameid into v_id from public.geo_places g
      where g.country_code = p_country and g.feature_class = 'P'
        and extensions.st_dwithin(g.geom::extensions.geography, v_pt, 1500)
      order by extensions.st_distance(g.geom::extensions.geography, v_pt) limit 1;
    end if;
    if v_id is not null then
      update public.geo_places g set
        names = (select array_agg(distinct n) from unnest(g.names || v_names) n),
        name_he = coalesce(g.name_he, nullif(r.name_he, '')),
        he_from_ai = case when g.name_he is null and coalesce(r.name_he, '') <> '' then false else g.he_from_ai end,
        name_ar = coalesce(g.name_ar, nullif(r.name_ar, '')),
        name_en = coalesce(g.name_en, nullif(regexp_replace(coalesce(r.name_en, ''), '\s*\(.*\)$|,.*$', ''), ''))
      where g.geonameid = v_id;
      v_known := v_known + 1;
    else
      insert into public.geo_places (geonameid, name, name_he, name_ar, name_en, names, country_code, feature_class, feature_code, population, geom)
      values ((select least(-1, coalesce(min(geonameid), 0)) - 1 from public.geo_places),
              coalesce(nullif(regexp_replace(coalesce(r.name_en, ''), '\s*\(.*\)$|,.*$', ''), ''), r.name_ar, r.name_he),
              nullif(r.name_he, ''), nullif(r.name_ar, ''), nullif(regexp_replace(coalesce(r.name_en, ''), '\s*\(.*\)$|,.*$', ''), ''),
              v_names, p_country, 'P', 'PPL', 0, extensions.st_setsrid(extensions.st_makepoint(r.lng, r.lat), 4326));
      v_new := v_new + 1;
    end if;
  end loop;
  return jsonb_build_object('matched', v_known, 'added', v_new);
end;
$$;
revoke execute on function public.learn_places(jsonb, text) from public, anon, authenticated;
grant execute on function public.learn_places(jsonb, text) to service_role;
