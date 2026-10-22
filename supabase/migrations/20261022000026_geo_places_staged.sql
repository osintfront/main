-- ════════════════════════════════════════════════════════════════════
-- Osintfront · Migration 26 — staged GeoNames import for big countries
-- An Edge Function has ~2 s of CPU per call: enough for small countries, not for
-- Iran. For those, geonames-import only streams the raw unzipped text into
-- geo_staging ({"country":"IR","stage":true}), and the database does the
-- filtering/merging set-based:  select public.import_staged_geonames('IR');
-- Same rules as geonames-import / tools/geonames/build_places.py.
-- ════════════════════════════════════════════════════════════════════
create table if not exists public.geo_staging (
  id bigserial primary key,
  country text not null,
  kind text not null check (kind in ('dump', 'alt')),
  content text not null
);
alter table public.geo_staging enable row level security; -- no policies: service role only
revoke all on public.geo_staging from anon, authenticated;

create or replace function public.import_staged_geonames(p_cc text)
returns integer language plpgsql security definer set search_path = '' as $$
declare v_rows integer;
begin
  with d as (
    select string_to_array(l, E'\t') f
    from public.geo_staging s, regexp_split_to_table(s.content, E'\n') l
    where s.country = p_cc and s.kind = 'dump' and l <> ''
  ), p as (
    select f[1]::bigint gid, f[2] nm, f[3] ascii, f[5]::float8 lat, f[6]::float8 lng, f[7] fc, f[8] fcode,
           f[11] admin1, coalesce(nullif(f[15], '')::bigint, 0) pop
    from d
    where coalesce(array_length(f, 1), 0) >= 19 and f[9] = p_cc
      and (f[7] in ('P', 'A', 'T', 'L') or f[8] in (
        'AIRB','AIRF','AIRH','AIRP','AIRQ','MILB','INSM','NVB','PRT','PS','PSH','PSN','PO',
        'DAM','BDG','CRSSNG','HSP','HSPC','CMP','CMPRF','CMPQ','TOWR','RSTN','OILR','OILT',
        'PRN','CSTL','FRT','MSQE','SHRN','UNIV','STDM','BRKS','ITTR','RESV',
        'WAD','STM','LK','RSV','BAY','GULF','STRT','SEA','CHN'))
  ), a as (
    select string_to_array(l, E'\t') f
    from public.geo_staging s, regexp_split_to_table(s.content, E'\n') l
    where s.country = p_cc and s.kind = 'alt' and split_part(l, E'\t', 3) in ('he', 'ar', 'en')
  ), an as (
    select f[2]::bigint gid, f[3] lang, btrim(f[4]) nm,
           case when f[5] = '1' then 0 when f[6] = '1' then 1 else 2 end rk
    from a
    where coalesce(f[7], '') <> '1' and coalesce(f[8], '') <> '1' and btrim(coalesce(f[4], '')) <> ''
      and f[2] ~ '^[0-9]+$'
  ), an2 as (
    select an.* from an join p using (gid)
  ), best as (
    select distinct on (gid, lang) gid, lang, nm from an2 order by gid, lang, rk, length(nm)
  ), allnames as (
    select gid, array_agg(nm) nms from an2 group by gid
  ), merged as (
    select p.gid,
           btrim(regexp_replace(p.nm, E'[֑-ׇ]', '', 'g')) nm,
           nullif(btrim(regexp_replace(he.nm, E'[֑-ׇ]', '', 'g')), '') he,
           nullif(btrim(ar.nm), '') ar,
           coalesce(nullif(btrim(en.nm), ''), p.nm) en,
           public.normalize_places(array[p.nm, p.ascii] || coalesce(x.nms, '{}')) names,
           p.fc, p.fcode, p.admin1, p.pop, p.lat, p.lng
    from p
    left join best he on he.gid = p.gid and he.lang = 'he'
    left join best ar on ar.gid = p.gid and ar.lang = 'ar'
    left join best en on en.gid = p.gid and en.lang = 'en'
    left join allnames x on x.gid = p.gid
  )
  insert into public.geo_places as g (geonameid, name, name_he, name_ar, name_en, names, country_code,
                                      feature_class, feature_code, admin1, population, geom)
  select gid, nm, he, ar, en, names, p_cc, nullif(fc, ''), nullif(fcode, ''), nullif(admin1, ''), pop,
         extensions.st_setsrid(extensions.st_makepoint(lng, lat), 4326)
  from merged
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
  delete from public.geo_staging where country = p_cc;
  return v_rows;
end;
$$;
revoke execute on function public.import_staged_geonames(text) from public, anon, authenticated;
grant execute on function public.import_staged_geonames(text) to service_role;
