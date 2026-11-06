-- geo_nearest_place: a box test on the indexed geometry first (0.2° ≥ 15 km at these latitudes), so a
-- right-click no longer scans every place (was ~1 s per call over ~412k places).
create or replace function public.geo_nearest_place(p_lat double precision, p_lng double precision)
returns table (name text, name_he text, name_en text, country_code text, km double precision)
language sql stable security definer set search_path = '' as $$
  with pt as (select extensions.ST_SetSRID(extensions.ST_MakePoint(p_lng, p_lat), 4326) as g)
  select g.name, g.name_he, g.name_en, g.country_code,
         round((extensions.ST_Distance(g.geom::extensions.geography, pt.g::extensions.geography) / 1000)::numeric, 1)::double precision
  from public.geo_places g, pt
  where g.geom operator(extensions.&&) extensions.ST_Expand(pt.g, 0.2)
    and extensions.ST_DWithin(g.geom::extensions.geography, pt.g::extensions.geography, 15000)
  order by (g.feature_class is distinct from 'P'), g.geom operator(extensions.<->) pt.g
  limit 1;
$$;
revoke all on function public.geo_nearest_place(double precision, double precision) from public, anon;
grant execute on function public.geo_nearest_place(double precision, double precision) to authenticated;
