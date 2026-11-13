-- Wadis and streams not shown on the map (bug, Ben):
-- the layer only held OpenStreetMap waterways that carry a name tag (567 ways → 89 courses), so most of
-- Lebanon's streams and wadis never appeared. Unnamed rivers / streams / wadis / valleys are now kept too:
--  · osm_waterways.name and wadi_lines.name may be null;
--  · build_wadi_lines(): named pieces are still joined into one course per name (as before); every unnamed
--    way is its own course (joining them by proximity would chain a whole catchment into one line);
--  · wadi_lines_missing_hebrew() skips unnamed courses (nothing to transliterate).
-- The extract (GitHub workflow "OSM wadis") and the import (event-agent osm_wadis band "file") were changed to
-- pass unnamed ways through; run both, then band "build".

alter table public.osm_waterways alter column name drop not null;
alter table public.wadi_lines alter column name drop not null;

create or replace function public.upsert_osm_waterways(p_rows jsonb)
returns integer language plpgsql security definer set search_path = '' as $$
declare v_n integer;
begin
  insert into public.osm_waterways (way_id, kind, name, name_ar, name_en, name_he, geom, synced_at)
  select r.way_id, r.kind, nullif(r.name, ''), nullif(r.name_ar, ''), nullif(r.name_en, ''), nullif(r.name_he, ''),
         extensions.st_setsrid(extensions.st_geomfromgeojson(r.geometry::text), 4326), now()
  from jsonb_to_recordset(p_rows) as r(way_id bigint, kind text, name text, name_ar text, name_en text, name_he text, geometry jsonb)
  where r.way_id is not null and r.geometry is not null
  on conflict (way_id) do update set kind = excluded.kind, name = excluded.name, name_ar = excluded.name_ar,
    name_en = excluded.name_en, name_he = excluded.name_he, geom = excluded.geom, synced_at = excluded.synced_at;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;
revoke execute on function public.upsert_osm_waterways(jsonb) from public, anon, authenticated;
grant execute on function public.upsert_osm_waterways(jsonb) to service_role;

create or replace function public.build_wadi_lines()
returns integer language plpgsql security definer set search_path = '' as $$
declare v_n integer;
begin
  insert into public.wadi_lines (kind, name, name_ar, name_en, name_he, geom, length_km, way_ids)
  select kind, name, name_ar, name_en, name_he, geom, length_km, way_ids from (
    select (array_agg(kind order by extensions.st_length(geom) desc))[1] kind,
           name, max(name_ar) name_ar, max(name_en) name_en, max(name_he) name_he,
           extensions.st_multi(extensions.st_linemerge(extensions.st_collect(geom))) geom,
           round((sum(extensions.st_length(geom::extensions.geography)) / 1000)::numeric, 2) length_km,
           array_agg(way_id) way_ids
    from (
      -- Named: pieces of the same name within ~1 km form one course. Unnamed: one course per way.
      select w.*, case when w.name is null then -w.way_id
                       else extensions.st_clusterdbscan(w.geom, 0.01, 1) over (partition by lower(w.name)) end c
      from public.osm_waterways w
    ) x
    group by name, c
  ) n
  where not exists (select 1 from public.wadi_lines e where e.way_ids && n.way_ids);
  get diagnostics v_n = row_count;
  with m as (
    select l.id, (
      select array[p.name_he, coalesce(p.he_from_ai, false)::text] from public.geo_places p
      where p.country_code = 'LB' and p.feature_code in ('WAD', 'STM', 'VAL') and p.name_he is not null
        and extensions.st_dwithin(p.geom, l.geom, 0.03)
        and (public.normalize_place(p.name_ar) = public.normalize_place(l.name_ar)
             or public.normalize_place(p.name) = public.normalize_place(coalesce(l.name_en, l.name)))
      order by extensions.st_distance(p.geom, l.geom) limit 1) he
    from public.wadi_lines l where l.name_he is null and l.name is not null
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
  where l.name_he is null and l.name is not null
  order by (extensions.st_y(extensions.st_centroid(l.geom)) < 33.62) desc, l.length_km desc nulls last, l.id limit p_limit
$$;
revoke execute on function public.wadi_lines_missing_hebrew(integer) from public, anon, authenticated;
grant execute on function public.wadi_lines_missing_hebrew(integer) to service_role;
