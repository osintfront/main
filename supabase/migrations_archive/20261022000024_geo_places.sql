-- ════════════════════════════════════════════════════════════════════
-- Osintfront · Migration 24 — local place database (GeoNames) + names per language
--
-- geo_places: every populated place, admin area, mountain/valley, wadi and
-- security-relevant site in IL SY LB IQ YE SA IR, with Hebrew, Arabic and
-- English names and a PostGIS point. Built once by
-- tools/geonames/build_places.py into data/geonames/*.tsv (in git); the
-- database loads those files itself from GitHub (load_geo_places_file), so
-- no data passes through an API or an AI.
--
-- Placing a report (automated writes only; a person's pin is never moved):
--   1. learned_places (editors' corrections)      — migration 23
--   2. geo_places (this table)                     — exact point + names
--   3. what the system did before (gazetteer, AI coordinates, OSM refine)
-- When a place is found only by its English name, the Hebrew name the AI
-- wrote is saved into geo_places, so next time it is found directly.
--
-- events.location_name_he / location_name_en: the place in each site language.
-- ════════════════════════════════════════════════════════════════════

create table public.geo_places (
  geonameid      bigint primary key,
  name           text not null,
  name_he        text,
  name_ar        text,
  name_en        text,
  names          text[] not null default '{}',        -- normalize_place() of every known name
  country_code   text not null check (country_code ~ '^[A-Z]{2}$'),
  feature_class  text,
  feature_code   text,
  admin1         text,
  population     bigint not null default 0,
  geom           extensions.geometry(Point, 4326) not null,
  he_from_ai     boolean not null default false         -- Hebrew name learned from the editor agent
);
create index geo_places_geom_gist on public.geo_places using gist (geom);
create index geo_places_names_gin on public.geo_places using gin (names);

alter table public.geo_places enable row level security;
revoke all on public.geo_places from anon, authenticated;
grant select on public.geo_places to authenticated;
create policy "geo places: staff read" on public.geo_places for select to authenticated
  using ((select public.has_permission('dashboard.view')));

alter table public.events
  add column location_name_he text check (char_length(location_name_he) <= 200),
  add column location_name_en text check (char_length(location_name_en) <= 200);
grant select (location_name_he, location_name_en) on public.events to anon;

-- ─── Loading (from the TSV files in git) ───────────────────────────
create or replace function public.load_geo_places_file(p_url text)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_status  integer;
  v_content text;
  v_rows    integer;
begin
  if p_url !~ '^https://raw\.githubusercontent\.com/osintfront/main/' then
    raise exception 'only files from the osintfront/main repository can be loaded';
  end if;
  perform extensions.http_set_curlopt('CURLOPT_TIMEOUT', '120');
  select status, content into v_status, v_content from extensions.http_get(p_url);
  if v_status <> 200 then raise exception 'HTTP % for %', v_status, p_url; end if;

  insert into public.geo_places as g (geonameid, name, name_he, name_ar, name_en, names, country_code,
                                      feature_class, feature_code, admin1, population, geom)
  select f[1]::bigint, f[2], nullif(f[3], ''), nullif(f[4], ''), nullif(f[5], ''),
         array_remove(string_to_array(f[6], '|'), ''), f[7], nullif(f[8], ''), nullif(f[9], ''), nullif(f[10], ''),
         coalesce(nullif(f[11], '')::bigint, 0),
         extensions.st_setsrid(extensions.st_makepoint(f[13]::float8, f[12]::float8), 4326)
  from (select string_to_array(l, E'\t') f from regexp_split_to_table(v_content, E'\n') l where l <> '') s
  where coalesce(array_length(f, 1), 0) >= 13
  on conflict (geonameid) do update set
    name = excluded.name,
    -- keep a Hebrew name learned from the editor agent when GeoNames has none
    name_he = coalesce(excluded.name_he, g.name_he),
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
revoke execute on function public.load_geo_places_file(text) from public, anon, authenticated;

-- Load every file listed in data/geonames/manifest.json (run once after the data is pushed).
create or replace function public.load_geo_places(p_ref text default 'main')
returns table (file text, loaded integer) language plpgsql security definer set search_path = '' as $$
declare
  v_base     text := 'https://raw.githubusercontent.com/osintfront/main/' || p_ref || '/data/geonames/';
  v_status   integer;
  v_manifest jsonb;
  v_file     jsonb;
begin
  perform extensions.http_set_curlopt('CURLOPT_TIMEOUT', '60');
  select status, content::jsonb into v_status, v_manifest from extensions.http_get(v_base || 'manifest.json');
  if v_status <> 200 then raise exception 'manifest: HTTP %', v_status; end if;
  for v_file in select value from jsonb_array_elements(v_manifest -> 'files') loop
    file := v_file ->> 'file';
    loaded := public.load_geo_places_file(v_base || file);
    return next;
  end loop;
end;
$$;
revoke execute on function public.load_geo_places(text) from public, anon, authenticated;

-- ─── Lookup ────────────────────────────────────────────────────────
create or replace function public.country_iso(p text)
returns text language sql immutable set search_path = '' as $$
  select case lower(btrim(coalesce(p, '')))
    when 'israel' then 'IL' when 'ישראל' then 'IL'
    when 'syria' then 'SY' when 'סוריה' then 'SY'
    when 'lebanon' then 'LB' when 'לבנון' then 'LB'
    when 'iraq' then 'IQ' when 'עיראק' then 'IQ'
    when 'yemen' then 'YE' when 'תימן' then 'YE'
    when 'saudi arabia' then 'SA' when 'סעודיה' then 'SA' when 'ערב הסעודית' then 'SA'
    when 'iran' then 'IR' when 'איראן' then 'IR'
  end;
$$;

-- Best match for a name: in the event's country when known; when the report already has a
-- position, the nearest match within 150 km (so a common name is not sent to the wrong
-- town); otherwise populated places first, then the largest.
create or replace function public.geo_lookup(p_name text, p_country text default null,
                                             p_lat double precision default null, p_lng double precision default null)
returns public.geo_places language plpgsql stable set search_path = '' as $$
declare
  v_norm  text := public.normalize_place(p_name);
  v_cc    text := public.country_iso(p_country);
  v_pt    extensions.geography;
  v_try   text;
  v_row   public.geo_places;
begin
  if char_length(v_norm) < 2 then return null; end if;
  if p_lat is not null and p_lng is not null then
    v_pt := extensions.st_setsrid(extensions.st_makepoint(p_lng, p_lat), 4326)::extensions.geography;
  end if;
  foreach v_try in array array[
    v_norm,
    case when v_norm ~ '^[הבלמו][א-ת]{2}' then substr(v_norm, 2) end,
    case when v_norm ~ '^(al|el|an|ad|ar|as|at|az) ' then regexp_replace(v_norm, '^(al|el|an|ad|ar|as|at|az) ', '') end
  ] loop
    continue when v_try is null or v_try = '';
    select g.* into v_row from public.geo_places g
    where g.names @> array[v_try]
      and coalesce(g.feature_code, '') not in ('PCL', 'PCLI', 'PCLD', 'PCLF', 'PCLS', 'TERR', 'CONT')
      and (v_cc is null or g.country_code = v_cc)
      and (v_pt is null or extensions.st_dwithin(g.geom::extensions.geography, v_pt, 150000))
    order by
      case when v_pt is null then 0 else extensions.st_distance(g.geom::extensions.geography, v_pt) end,
      case g.feature_class when 'P' then 1 when 'S' then 2 when 'A' then 3 else 4 end,
      g.population desc
    limit 1;
    if found then return v_row; end if;
  end loop;
  return null;
end;
$$;

-- Hebrew letters present?
create or replace function public.has_hebrew(p text)
returns boolean language sql immutable set search_path = '' as $$ select coalesce(p, '') ~ '[א-ת]'; $$;

-- ─── Apply on automated writes: learned → geo_places → (unchanged fallback) ──
create or replace function public.events_apply_learned_place()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_hit   public.learned_places;
  v_geo   public.geo_places;
  v_ids   uuid[] := '{}';
  v_items jsonb := '[]'::jsonb;
  v_item  jsonb;
  v_lp    public.learned_places;
  v_g     public.geo_places;
begin
  if auth.uid() is not null then return new; end if;              -- a person set this: keep it
  if cardinality(coalesce(new.hfc_areas, '{}')) > 0 then return new; end if;  -- red alerts are placed by area
  if tg_op = 'UPDATE'
     and new.location_name is not distinct from old.location_name
     and new.locations is not distinct from old.locations
     and (new.latitude, new.longitude) is not distinct from (old.latitude, old.longitude) then
    return new;
  end if;

  -- Every pin of the event.
  if jsonb_typeof(new.locations) = 'array' and jsonb_array_length(new.locations) > 0 then
    for v_item in select value from jsonb_array_elements(new.locations) loop
      v_lp := public.learned_place(v_item ->> 'name', v_item ->> 'name_en');
      if v_lp.id is not null then
        v_item := v_item || jsonb_build_object('lat', v_lp.latitude, 'lng', v_lp.longitude, 'precision', 'exact', 'learned', true);
        v_ids := v_ids || v_lp.id;
      else
        v_g := public.geo_lookup(v_item ->> 'name', new.country,
                                 case when jsonb_typeof(v_item -> 'lat') = 'number' then (v_item ->> 'lat')::float8 end,
                                 case when jsonb_typeof(v_item -> 'lng') = 'number' then (v_item ->> 'lng')::float8 end);
        if v_g.geonameid is null and coalesce(v_item ->> 'name_en', '') <> '' then
          v_g := public.geo_lookup(v_item ->> 'name_en', new.country,
                                   case when jsonb_typeof(v_item -> 'lat') = 'number' then (v_item ->> 'lat')::float8 end,
                                   case when jsonb_typeof(v_item -> 'lng') = 'number' then (v_item ->> 'lng')::float8 end);
          -- Found by its English name only: keep the editor's Hebrew name for next time.
          if v_g.geonameid is not null and v_g.name_he is null and public.has_hebrew(v_item ->> 'name') then
            update public.geo_places set name_he = left(v_item ->> 'name', 120), he_from_ai = true,
                   names = (select array_agg(distinct x) from unnest(names || public.normalize_place(v_item ->> 'name')) x)
            where geonameid = v_g.geonameid;
            v_g.name_he := v_item ->> 'name';
          end if;
        end if;
        if v_g.geonameid is not null then
          v_item := v_item || jsonb_build_object(
            'lat', round(extensions.st_y(v_g.geom)::numeric, 6), 'lng', round(extensions.st_x(v_g.geom)::numeric, 6),
            'precision', case when v_g.feature_class = 'A' then 'region' else 'exact' end,
            'geonameid', v_g.geonameid,
            'name', coalesce(v_g.name_he, v_item ->> 'name'),
            'name_en', coalesce(v_g.name_en, v_item ->> 'name_en', v_g.name));
        end if;
      end if;
      v_items := v_items || jsonb_build_array(v_item);
    end loop;
    new.locations := v_items;
  end if;

  -- The main pin.
  v_hit := public.learned_place(new.location_name, new.ai_suggestions ->> 'place_en');
  if v_hit.id is not null then
    new.latitude := v_hit.latitude;
    new.longitude := v_hit.longitude;
    new.location_precision := 'exact';
    new.geocoding_confidence := 0.95;
    if coalesce(new.country, '') = '' and v_hit.country <> '' then new.country := v_hit.country; end if;
    new.ai_suggestions := coalesce(new.ai_suggestions, '{}'::jsonb) || jsonb_build_object(
      'location_resolution', jsonb_build_object('method', 'learned', 'matched_on', new.location_name,
                                                 'place', v_hit.location_name, 'resolved_at', now()));
    v_ids := v_ids || v_hit.id;
  elsif coalesce(new.location_name, '') <> '' or coalesce(new.ai_suggestions ->> 'place_en', '') <> '' then
    v_geo := public.geo_lookup(new.location_name, new.country, new.latitude::float8, new.longitude::float8);
    if v_geo.geonameid is null and coalesce(new.ai_suggestions ->> 'place_en', '') <> '' then
      v_geo := public.geo_lookup(new.ai_suggestions ->> 'place_en', new.country, new.latitude::float8, new.longitude::float8);
      if v_geo.geonameid is not null and v_geo.name_he is null and public.has_hebrew(new.location_name) then
        update public.geo_places set name_he = left(new.location_name, 120), he_from_ai = true,
               names = (select array_agg(distinct x) from unnest(names || public.normalize_place(new.location_name)) x)
        where geonameid = v_geo.geonameid;
        v_geo.name_he := new.location_name;
      end if;
    end if;
    if v_geo.geonameid is not null then
      new.latitude := round(extensions.st_y(v_geo.geom)::numeric, 6);
      new.longitude := round(extensions.st_x(v_geo.geom)::numeric, 6);
      new.location_precision := case when v_geo.feature_class = 'A' then 'region' else 'exact' end;
      new.geocoding_confidence := 0.9;
      new.location_name_he := coalesce(v_geo.name_he, case when public.has_hebrew(new.location_name) then new.location_name end);
      new.location_name_en := coalesce(v_geo.name_en, v_geo.name);
      if coalesce(new.country, '') = '' then
        new.country := case v_geo.country_code when 'IL' then 'Israel' when 'SY' then 'Syria' when 'LB' then 'Lebanon'
          when 'IQ' then 'Iraq' when 'YE' then 'Yemen' when 'SA' then 'Saudi Arabia' when 'IR' then 'Iran' end;
      end if;
      new.ai_suggestions := coalesce(new.ai_suggestions, '{}'::jsonb) || jsonb_build_object(
        'location_resolution', jsonb_build_object('method', 'geonames', 'geonameid', v_geo.geonameid,
                                                   'matched_on', new.location_name, 'place', v_geo.name_en, 'resolved_at', now()));
    end if;
  end if;

  -- Names in both languages even when the place is not in the database (the AI wrote both).
  if new.location_name_he is null and public.has_hebrew(new.location_name) then
    new.location_name_he := left(new.location_name, 200);
  end if;
  if new.location_name_en is null and coalesce(new.ai_suggestions ->> 'place_en', '') <> '' then
    new.location_name_en := left(new.ai_suggestions ->> 'place_en', 200);
  end if;

  if cardinality(v_ids) > 0 then
    update public.learned_places set times_used = times_used + 1, last_used_at = now() where id = any (v_ids);
  end if;
  return new;
end;
$$;
revoke execute on function public.events_apply_learned_place() from public, anon, authenticated;

-- One-off: names in both languages for events already on the site (pins are not moved).
create or replace function public.backfill_place_names(p_limit integer default 5000)
returns integer language plpgsql security definer set search_path = '' as $$
declare v_n integer;
begin
  with todo as (
    select e.id, e.location_name, e.country, e.latitude, e.longitude, e.ai_suggestions ->> 'place_en' as place_en
    from public.events e
    where e.deleted_at is null and (e.location_name_he is null or e.location_name_en is null)
      and coalesce(e.location_name, '') <> ''
    order by e.created_at desc
    limit p_limit
  ), hit as (
    select t.id, t.location_name, t.place_en,
           coalesce(public.geo_lookup(t.location_name, t.country, t.latitude::float8, t.longitude::float8),
                    public.geo_lookup(t.place_en, t.country, t.latitude::float8, t.longitude::float8)) g
    from todo t
  )
  update public.events e set
    location_name_he = coalesce(e.location_name_he, (h.g).name_he, case when public.has_hebrew(h.location_name) then left(h.location_name, 200) end),
    location_name_en = coalesce(e.location_name_en, (h.g).name_en, nullif(left(h.place_en, 200), ''),
                                case when not public.has_hebrew(h.location_name) then left(h.location_name, 200) end)
  from hit h where e.id = h.id;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;
revoke execute on function public.backfill_place_names(integer) from public, anon, authenticated;

-- Public views gain the names (columns appended at the end).
create or replace view public.published_events with (security_invoker = true, security_barrier = true) as
 SELECT e.id, e.title, e.description, e.severity, e.latitude, e.longitude, e.location_name, e.country, e.region, e.city,
    e.source_name, e.source_url, e.source_type, e.occurred_at, e.published_at, e.updated_at, e.is_breaking, e.is_verified,
    e.translations, e.category_id, c.slug AS category_slug, c.name AS category_name, c.icon AS category_icon,
    c.color AS category_color, c.marker_color AS category_marker_color, e.location_precision, e.sources, e.locations,
    e.location_name_he, e.location_name_en
   FROM events e
     LEFT JOIN event_categories c ON c.id = e.category_id AND c.is_active
  WHERE e.status = 'published'::event_status AND e.deleted_at IS NULL AND e.latitude IS NOT NULL AND e.longitude IS NOT NULL
    AND cardinality(e.hfc_areas) = 0;

create or replace view public.archived_events with (security_invoker = true, security_barrier = true) as
 SELECT e.id, e.title, e.description, e.severity, e.latitude, e.longitude, e.location_name, e.country, e.region, e.city,
    e.source_name, e.source_url, e.source_type, e.occurred_at, e.published_at, e.updated_at, e.is_breaking, e.is_verified,
    e.translations, e.category_id, c.slug AS category_slug, c.name AS category_name, c.icon AS category_icon,
    c.color AS category_color, c.marker_color AS category_marker_color, e.location_precision, e.expired_at, e.sources,
    e.locations, e.location_name_he, e.location_name_en
   FROM events e
     LEFT JOIN event_categories c ON c.id = e.category_id AND c.is_active
  WHERE e.status = 'archived'::event_status AND e.expired_at IS NOT NULL AND e.deleted_at IS NULL
    AND e.latitude IS NOT NULL AND e.longitude IS NOT NULL;
