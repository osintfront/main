-- ════════════════════════════════════════════════════════════════════
-- 0016 · Country fallback and several pins per event
--
-- 1. Country fallback: an event with no usable place is pinned on the
--    country it refers to (location_precision = 'country', shown as
--    "Approx. location"). More countries in the gazetteer, and the
--    countries the editor agent listed (ai_suggestions.countries) are
--    tried when location / city / region / country did not match.
-- 2. Several places: events.locations holds every specific place the
--    report mentions ([{name, name_en, lat, lng, precision}]). Places
--    without coordinates are looked up in the gazetteer (city/region
--    level only — a whole country is never an extra pin). The public
--    views expose the list; the map draws one pin per place.
-- 3. Auto-publish never publishes an 'uncategorized' draft (those wait
--    for a person, as intended for unclear WhatsApp reports).
-- ════════════════════════════════════════════════════════════════════

-- ─── 1. More countries (points inside each country) ─────────────────
insert into public.place_gazetteer (kind, canonical, country_code, latitude, longitude, names)
select v.kind, v.canonical, v.cc, v.lat, v.lng, v.names
from (values
  ('country','United States','us',39.500000,-98.350000,array['ארצות הברית','ארה"ב','ארה״ב','ארהב','אמריקה','united states','usa','us','united states of america','america']),
  ('country','Russia','ru',55.750000,37.620000,'{רוסיה,russia,russian federation}'::text[]),
  ('country','United Kingdom','gb',52.500000,-1.500000,'{בריטניה,הממלכה המאוחדת,אנגליה,united kingdom,uk,britain,great britain,england}'::text[]),
  ('country','France','fr',46.600000,2.400000,'{צרפת,france}'::text[]),
  ('country','Germany','de',51.100000,10.400000,'{גרמניה,germany}'::text[]),
  ('country','Italy','it',42.800000,12.600000,'{איטליה,italy}'::text[]),
  ('country','Spain','es',40.300000,-3.700000,'{ספרד,spain}'::text[]),
  ('country','Greece','gr',39.300000,22.000000,'{יוון,greece}'::text[]),
  ('country','Bulgaria','bg',42.700000,25.300000,'{בולגריה,bulgaria}'::text[]),
  ('country','Ukraine','ua',49.000000,31.300000,'{אוקראינה,ukraine}'::text[]),
  ('country','Belgium','be',50.600000,4.600000,'{בלגיה,belgium}'::text[]),
  ('country','Netherlands','nl',52.200000,5.500000,'{הולנד,netherlands,holland}'::text[]),
  ('country','Switzerland','ch',46.800000,8.200000,'{שווייץ,שוויץ,switzerland}'::text[]),
  ('country','Austria','at',47.500000,14.500000,'{אוסטריה,austria}'::text[]),
  ('country','China','cn',35.000000,104.000000,'{סין,china}'::text[]),
  ('country','India','in',22.000000,79.000000,'{הודו,india}'::text[]),
  ('country','Pakistan','pk',30.000000,70.000000,'{פקיסטן,pakistan}'::text[]),
  ('country','Afghanistan','af',33.900000,67.700000,'{אפגניסטן,afghanistan}'::text[]),
  ('country','Azerbaijan','az',40.300000,47.700000,'{אזרבייג׳ן,אזרבייג''ן,אזרבייגן,azerbaijan}'::text[]),
  ('country','Armenia','am',40.200000,45.000000,'{ארמניה,armenia}'::text[]),
  ('country','Libya','ly',27.000000,17.000000,'{לוב,libya}'::text[]),
  ('country','Sudan','sd',15.500000,30.000000,'{סודן,sudan}'::text[]),
  ('country','Tunisia','tn',34.000000,9.500000,'{תוניסיה,tunisia}'::text[]),
  ('country','Algeria','dz',28.000000,2.600000,'{אלג׳יריה,אלג''יריה,אלגיריה,algeria}'::text[]),
  ('country','Morocco','ma',31.800000,-7.100000,'{מרוקו,morocco}'::text[]),
  ('country','Somalia','so',5.200000,46.200000,'{סומליה,somalia}'::text[]),
  ('country','Djibouti','dj',11.800000,42.600000,'{ג׳יבוטי,ג''יבוטי,גיבוטי,djibouti}'::text[]),
  ('country','Eritrea','er',15.200000,39.000000,'{אריתריאה,eritrea}'::text[]),
  ('country','Ethiopia','et',9.100000,40.500000,'{אתיופיה,ethiopia}'::text[]),
  ('country','Japan','jp',36.200000,138.200000,'{יפן,japan}'::text[]),
  ('country','North Korea','kp',40.000000,127.000000,'{קוריאה הצפונית,צפון קוריאה,north korea}'::text[]),
  ('country','Venezuela','ve',7.000000,-66.000000,'{ונצואלה,venezuela}'::text[])
) as v(kind, canonical, cc, lat, lng, names)
where not exists (select 1 from public.place_gazetteer g where g.kind = v.kind and g.canonical = v.canonical);

-- ─── 2. Places list on events ────────────────────────────────────────
alter table public.events
  add column if not exists locations jsonb not null default '[]'::jsonb;
alter table public.events drop constraint if exists events_locations_is_array;
alter table public.events
  add constraint events_locations_is_array check (jsonb_typeof(locations) = 'array' and jsonb_array_length(locations) <= 8);

-- Resolve a list of places: keep those with coordinates, look the rest up
-- (city / region only), drop what cannot be placed. At most 8.
create or replace function public.resolve_event_locations(p_locations jsonb, p_seed uuid)
returns jsonb language plpgsql stable set search_path = '' as $$
declare
  v_out   jsonb := '[]'::jsonb;
  v_item  jsonb;
  v_lat   numeric;
  v_lng   numeric;
  v_hit   public.place_gazetteer;
  v_name  text;
  v_en    text;
  v_i     int := 0;
begin
  if p_locations is null or jsonb_typeof(p_locations) <> 'array' then return '[]'::jsonb; end if;
  for v_item in select value from jsonb_array_elements(p_locations) loop
    exit when jsonb_array_length(v_out) >= 8;
    continue when jsonb_typeof(v_item) <> 'object';
    v_i := v_i + 1;
    v_name := left(btrim(coalesce(v_item ->> 'name', '')), 120);
    v_en   := left(btrim(coalesce(v_item ->> 'name_en', '')), 120);
    v_lat := case when jsonb_typeof(v_item -> 'lat') = 'number' then (v_item ->> 'lat')::numeric end;
    v_lng := case when jsonb_typeof(v_item -> 'lng') = 'number' then (v_item ->> 'lng')::numeric end;
    if v_lat between -90 and 90 and v_lng between -180 and 180 then
      v_out := v_out || jsonb_build_array(jsonb_build_object(
        'name', v_name, 'name_en', v_en, 'lat', round(v_lat, 6), 'lng', round(v_lng, 6),
        'precision', coalesce(nullif(v_item ->> 'precision', ''), 'exact')));
      continue;
    end if;
    v_hit := public.lookup_place(v_name);
    if v_hit.id is null and v_en <> '' then v_hit := public.lookup_place(v_en); end if;
    continue when v_hit.id is null or v_hit.kind = 'country';
    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'name', coalesce(nullif(v_name, ''), v_hit.canonical), 'name_en', coalesce(nullif(v_en, ''), v_hit.canonical),
      'lat', round(v_hit.latitude + public.place_jitter(p_seed, v_hit.kind, 10 + v_i), 6),
      'lng', round(v_hit.longitude + public.place_jitter(p_seed, v_hit.kind, 20 + v_i), 6),
      'precision', v_hit.kind));
  end loop;
  return v_out;
end;
$$;
revoke execute on function public.resolve_event_locations(jsonb, uuid) from public, anon, authenticated;

-- ─── 3. Location trigger: places list, country fallback, auto-publish ─
create or replace function public.events_resolve_location()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_place     public.place_gazetteer;
  v_place_id  uuid;
  v_matched   text;
  v_settings  jsonb;
  v_prefix    text;
  v_imported  boolean := false;
  v_country   text;
  v_first     jsonb;
begin
  -- Places list: resolve on insert, or when the list changed.
  if tg_op = 'INSERT' or new.locations is distinct from old.locations then
    new.locations := public.resolve_event_locations(new.locations, new.id);
  end if;

  if new.latitude is not null and new.longitude is not null then
    if new.location_precision is null then
      new.location_precision := 'exact';
    elsif tg_op = 'UPDATE'
          and (new.latitude, new.longitude) is distinct from (old.latitude, old.longitude)
          and new.location_precision is not distinct from old.location_precision
          and old.location_precision <> 'exact' then
      -- Someone moved an approximate pin without stating a precision: treat as exact.
      new.location_precision := 'exact';
    end if;
  elsif new.latitude is null and new.longitude is null then
    -- a) the event's own place fields
    select r.place_id, r.matched_on into v_place_id, v_matched
    from public.resolve_event_place(new.location_name, new.city, new.region, new.country) r;

    -- A country-level match gives way to a specific place from the list.
    if v_place_id is not null and jsonb_array_length(new.locations) > 0
       and (select g.kind from public.place_gazetteer g where g.id = v_place_id) = 'country' then
      v_place_id := null;
    end if;

    -- b) the first place in the list that has a point
    if v_place_id is null and jsonb_array_length(new.locations) > 0 then
      v_first := new.locations -> 0;
      new.latitude  := (v_first ->> 'lat')::numeric;
      new.longitude := (v_first ->> 'lng')::numeric;
      new.location_precision := coalesce(v_first ->> 'precision', 'exact');
      if coalesce(new.location_name, '') = '' then new.location_name := left(v_first ->> 'name', 200); end if;
      new.geocoding_confidence := 0.7;
      new.ai_suggestions := coalesce(new.ai_suggestions, '{}'::jsonb) || jsonb_build_object(
        'location_resolution', jsonb_build_object('method', 'locations_list', 'place', v_first ->> 'name', 'resolved_at', now()));
    end if;

    -- c) country fallback: the countries the editor agent listed
    if v_place_id is null and new.latitude is null
       and jsonb_typeof(new.ai_suggestions -> 'countries') = 'array' then
      for v_country in select jsonb_array_elements_text(new.ai_suggestions -> 'countries') loop
        v_place := public.lookup_place(v_country);
        if v_place.id is not null then v_place_id := v_place.id; v_matched := v_country; exit; end if;
      end loop;
    end if;

    if v_place_id is not null then
      select * into v_place from public.place_gazetteer where id = v_place_id;
      new.latitude  := round(v_place.latitude + public.place_jitter(new.id, v_place.kind, 1), 6);
      new.longitude := round(v_place.longitude + public.place_jitter(new.id, v_place.kind, 2), 6);
      new.location_precision := v_place.kind;
      new.geocoding_confidence := case v_place.kind when 'city' then 0.8 when 'region' then 0.5 else 0.3 end;
      if coalesce(new.country, '') = '' and v_place.kind = 'country' then
        new.country := v_place.canonical;
      end if;
      new.ai_suggestions := coalesce(new.ai_suggestions, '{}'::jsonb) || jsonb_build_object(
        'location_resolution', jsonb_build_object(
          'method', 'gazetteer', 'matched_on', v_matched, 'place', v_place.canonical,
          'kind', v_place.kind, 'country_code', v_place.country_code, 'resolved_at', now()));
    end if;
  end if;

  -- Auto-publish imported drafts once they have everything publishing needs
  -- (never an 'uncategorized' one — those wait for a person).
  if tg_op = 'INSERT' and new.status = 'draft' then
    select value into v_settings from public.app_settings where key = 'auto_publish';
    if coalesce((v_settings ->> 'enabled')::boolean, false) then
      for v_prefix in select jsonb_array_elements_text(coalesce(v_settings -> 'source_prefixes', '[]'::jsonb)) loop
        if coalesce(new.source_name, '') ilike v_prefix || '%' then v_imported := true; end if;
      end loop;
      if v_imported and new.latitude is not null and new.category_id is not null and btrim(new.title) <> ''
         and not exists (select 1 from public.event_categories c where c.id = new.category_id and c.slug = 'uncategorized') then
        new.status := 'published';
        new.ai_suggestions := coalesce(new.ai_suggestions, '{}'::jsonb) || jsonb_build_object('auto_published', true);
      end if;
    end if;
  end if;
  return new;
end;
$$;
revoke execute on function public.events_resolve_location() from public, anon, authenticated;

-- ─── 4. Public views expose the places list (new column at the end) ──
create or replace view public.published_events
with (security_invoker = true, security_barrier = true)
as
select
  e.id, e.title, e.description, e.severity, e.latitude, e.longitude,
  e.location_name, e.country, e.region, e.city,
  e.source_name, e.source_url, e.source_type,
  e.occurred_at, e.published_at, e.updated_at,
  e.is_breaking, e.is_verified, e.translations, e.category_id,
  c.slug as category_slug, c.name as category_name, c.icon as category_icon,
  c.color as category_color, c.marker_color as category_marker_color,
  e.location_precision,
  e.sources,
  e.locations
from public.events e
left join public.event_categories c on c.id = e.category_id and c.is_active
where e.status = 'published'
  and e.deleted_at is null
  and e.latitude is not null
  and e.longitude is not null
  and cardinality(e.hfc_areas) = 0;
grant select on public.published_events to anon, authenticated;

create or replace view public.archived_events
with (security_invoker = true, security_barrier = true)
as
select
  e.id, e.title, e.description, e.severity, e.latitude, e.longitude,
  e.location_name, e.country, e.region, e.city,
  e.source_name, e.source_url, e.source_type,
  e.occurred_at, e.published_at, e.updated_at,
  e.is_breaking, e.is_verified, e.translations, e.category_id,
  c.slug as category_slug, c.name as category_name, c.icon as category_icon,
  c.color as category_color, c.marker_color as category_marker_color,
  e.location_precision,
  e.expired_at,
  e.sources,
  e.locations
from public.events e
left join public.event_categories c on c.id = e.category_id and c.is_active
where e.status = 'archived'
  and e.expired_at is not null
  and e.deleted_at is null
  and e.latitude is not null
  and e.longitude is not null;
grant select on public.archived_events to anon, authenticated;
