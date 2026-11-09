-- Teach the place database (geo_places, used by geo_lookup for every report) a list of places:
-- each place's names (Arabic, English, Hebrew) are added to the GeoNames place standing on it
-- (same name, or the nearest town or village within 1.5 km); a place GeoNames does not have is added.
-- Used for the villages of south Lebanon (Wikipedia, event-agent action "learn_south_lebanon").
create or replace function public.learn_places(p_rows jsonb, p_country text default 'LB')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  r        record;
  v_pt     extensions.geography;
  v_geom   extensions.geometry;
  v_id     bigint;
  v_names  text[];
  v_new    integer := 0;
  v_known  integer := 0;
begin
  for r in select * from jsonb_to_recordset(p_rows) as x(name_ar text, name_en text, name_he text, lat float8, lng float8, source text) loop
    continue when r.lat is null or r.lng is null;
    v_geom := extensions.st_setsrid(extensions.st_makepoint(r.lng, r.lat), 4326);
    v_pt := v_geom::extensions.geography;
    v_names := array(select distinct n from unnest(array[
      public.normalize_place(r.name_ar), public.normalize_place(r.name_en), public.normalize_place(r.name_he),
      public.normalize_place(regexp_replace(coalesce(r.name_en, ''), '\s*\(.*\)$|,.*$', ''))]) n where coalesce(n, '') <> '' and char_length(n) >= 2);
    continue when cardinality(v_names) = 0;
    -- The place itself: a GeoNames place with one of these names within 3 km, else the nearest
    -- town / village within 1.5 km.
    select g.geonameid into v_id from public.geo_places g
    where g.geom operator(extensions.&&) extensions.st_expand(v_geom, 0.03)
      and g.country_code = p_country and g.names && v_names
      and extensions.st_dwithin(g.geom::extensions.geography, v_pt, 3000)
    order by extensions.st_distance(g.geom::extensions.geography, v_pt) limit 1;
    if v_id is null then
      select g.geonameid into v_id from public.geo_places g
      where g.geom operator(extensions.&&) extensions.st_expand(v_geom, 0.015)
        and g.country_code = p_country and g.feature_class = 'P'
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
              v_names, p_country, 'P', 'PPL', 0, v_geom);
      v_new := v_new + 1;
    end if;
  end loop;
  return jsonb_build_object('matched', v_known, 'added', v_new);
end;
$$;
revoke execute on function public.learn_places(jsonb, text) from public, anon, authenticated;
grant execute on function public.learn_places(jsonb, text) to service_role;

-- Places waiting to be taught (filled by the agent; processed in the database, which has no
-- 8-second limit there): select public.learn_places_queue();
create table if not exists public.place_learn_queue (
  key        text primary key,          -- source + title
  row        jsonb not null,
  country    text not null default 'LB',
  added_at   timestamptz not null default now(),
  done_at    timestamptz
);
alter table public.place_learn_queue enable row level security;
revoke all on public.place_learn_queue from anon, authenticated;

create or replace function public.learn_places_queue(p_limit integer default 1000)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_rows jsonb; v_keys text[]; v_out jsonb;
begin
  select jsonb_agg(row), array_agg(key) into v_rows, v_keys
  from (select key, row from public.place_learn_queue where done_at is null order by added_at limit p_limit) q;
  if v_rows is null then return jsonb_build_object('matched', 0, 'added', 0, 'left', 0); end if;
  v_out := public.learn_places(v_rows, 'LB');
  update public.place_learn_queue set done_at = now() where key = any (v_keys);
  return v_out || jsonb_build_object('left', (select count(*) from public.place_learn_queue where done_at is null));
end;
$$;
revoke execute on function public.learn_places_queue(integer) from public, anon, authenticated;

-- Villages of south Lebanon still without a Hebrew name (for the AI transliteration batch).
create or replace function public.south_lebanon_missing_hebrew(p_limit integer default 120)
returns table (geonameid bigint, name_ar text, name text) language sql stable security definer set search_path = '' as $$
  select g.geonameid, g.name_ar, g.name from public.geo_places g
  where g.country_code = 'LB' and g.feature_class = 'P' and g.name_he is null
    and extensions.st_y(g.geom) between 33.04 and 33.62 and extensions.st_x(g.geom) between 35.1 and 35.95
  order by g.population desc, g.geonameid limit p_limit
$$;
create or replace function public.set_hebrew_place_names(p_rows jsonb)
returns integer language plpgsql security definer set search_path = '' as $$
declare v_n integer;
begin
  update public.geo_places g set name_he = r.name_he, he_from_ai = true,
    names = (select array_agg(distinct n) from unnest(g.names || public.normalize_place(r.name_he)) n)
  from jsonb_to_recordset(p_rows) as r(geonameid bigint, name_he text)
  where g.geonameid = r.geonameid and g.name_he is null and coalesce(r.name_he, '') <> '';
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;
revoke execute on function public.south_lebanon_missing_hebrew(integer) from public, anon, authenticated;
revoke execute on function public.set_hebrew_place_names(jsonb) from public, anon, authenticated;
grant execute on function public.south_lebanon_missing_hebrew(integer), public.set_hebrew_place_names(jsonb) to service_role;
