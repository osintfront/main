-- ════════════════════════════════════════════════════════════════════
-- Osintfront · Migration 25 — load geo_places from TSV text
-- Used by the geonames-import Edge Function (server-side import, one country
-- per call) — same columns as tools/geonames/build_places.py writes.
-- ════════════════════════════════════════════════════════════════════
create or replace function public.load_geo_places_tsv(p_content text)
returns integer language plpgsql security definer set search_path = '' as $$
declare v_rows integer;
begin
  insert into public.geo_places as g (geonameid, name, name_he, name_ar, name_en, names, country_code,
                                      feature_class, feature_code, admin1, population, geom)
  select f[1]::bigint, f[2], nullif(f[3], ''), nullif(f[4], ''), nullif(f[5], ''),
         array_remove(string_to_array(f[6], '|'), ''), f[7], nullif(f[8], ''), nullif(f[9], ''), nullif(f[10], ''),
         coalesce(nullif(f[11], '')::bigint, 0),
         extensions.st_setsrid(extensions.st_makepoint(f[13]::float8, f[12]::float8), 4326)
  from (select string_to_array(l, E'\t') f from regexp_split_to_table(p_content, E'\n') l where l <> '') s
  where coalesce(array_length(f, 1), 0) >= 13
  on conflict (geonameid) do update set
    name = excluded.name,
    name_he = coalesce(excluded.name_he, g.name_he),       -- keep a Hebrew name learned from the editor
    he_from_ai = g.he_from_ai and excluded.name_he is null,
    name_ar = excluded.name_ar, name_en = excluded.name_en,
    names = (select array_agg(distinct x) from unnest(excluded.names || g.names) x),
    country_code = excluded.country_code, feature_class = excluded.feature_class,
    feature_code = excluded.feature_code, admin1 = excluded.admin1,
    population = excluded.population, geom = excluded.geom;
  get diagnostics v_rows = row_count;
  return v_rows;
end;
$$;
revoke execute on function public.load_geo_places_tsv(text) from public, anon, authenticated;
grant execute on function public.load_geo_places_tsv(text) to service_role;
