-- Weather: the right-click weather card and the weather layers are for registered users (Free and up).
insert into public.plan_features (feature_key, plan_id, enabled, limit_value, note) values
  ('weather', 'guest', false, null, 'weather layers and card'),
  ('weather', 'free',  true,  null, 'weather layers and card'),
  ('weather', 'pro',   true,  null, 'weather layers and card'),
  ('weather', 'max',   true,  null, 'weather layers and card'),
  ('weather', 'intel', true,  null, 'weather layers and card')
on conflict (feature_key, plan_id) do update
  set enabled = excluded.enabled, limit_value = excluded.limit_value, note = excluded.note;

-- The weather card's header: the nearest known place (populated places first) within 15 km, or nothing.
create or replace function public.geo_nearest_place(p_lat double precision, p_lng double precision)
returns table (name text, name_he text, name_en text, country_code text, km double precision)
language sql stable security definer set search_path = '' as $$
  select g.name, g.name_he, g.name_en, g.country_code,
         round((extensions.ST_Distance(g.geom::extensions.geography,
                extensions.ST_SetSRID(extensions.ST_MakePoint(p_lng, p_lat), 4326)::extensions.geography) / 1000)::numeric, 1)::double precision
  from public.geo_places g
  where extensions.ST_DWithin(g.geom::extensions.geography,
          extensions.ST_SetSRID(extensions.ST_MakePoint(p_lng, p_lat), 4326)::extensions.geography, 15000)
  order by (g.feature_class is distinct from 'P'),
           g.geom operator(extensions.<->) extensions.ST_SetSRID(extensions.ST_MakePoint(p_lng, p_lat), 4326)
  limit 1;
$$;
revoke all on function public.geo_nearest_place(double precision, double precision) from public, anon;
grant execute on function public.geo_nearest_place(double precision, double precision) to authenticated;
