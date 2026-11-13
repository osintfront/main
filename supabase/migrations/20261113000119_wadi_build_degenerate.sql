-- build_wadi_lines() failed once unnamed ways were imported: a degenerate way (e.g. two points that round to
-- the same spot) merges into an empty GeometryCollection, which the MultiLineString column rejects. Keep only the
-- line parts and skip courses that end up empty.

create or replace function public.build_wadi_lines()
returns integer language plpgsql security definer set search_path = '' as $$
declare v_n integer;
begin
  insert into public.wadi_lines (kind, name, name_ar, name_en, name_he, geom, length_km, way_ids)
  select kind, name, name_ar, name_en, name_he, geom, length_km, way_ids from (
    select (array_agg(kind order by extensions.st_length(geom) desc))[1] kind,
           name, max(name_ar) name_ar, max(name_en) name_en, max(name_he) name_he,
           extensions.st_multi(extensions.st_collectionextract(extensions.st_linemerge(extensions.st_collect(geom)), 2)) geom,
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
  where not extensions.st_isempty(n.geom)
    and not exists (select 1 from public.wadi_lines e where e.way_ids && n.way_ids);
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
