-- Pins for events stuck on their country.
-- 1. The editor's list of places arrives after the event was already pinned on its country:
--    the first listed place now replaces a country-level main pin (insert and update).
-- 2. The OpenStreetMap lookup accepts any hit smaller than a country (airports, border
--    crossings, bases, districts, straits…), not only towns; precision follows the type.
-- 3. Backfill: live events at country level that already list a place.

create or replace function public.promote_listed_place()
returns trigger
language plpgsql
set search_path to ''
as $$
declare
  v_first jsonb;
begin
  if new.location_precision = 'country'
     and jsonb_typeof(new.locations) = 'array' and jsonb_array_length(new.locations) > 0 then
    v_first := new.locations -> 0;
    if jsonb_typeof(v_first -> 'lat') = 'number' and jsonb_typeof(v_first -> 'lng') = 'number' then
      new.latitude := (v_first ->> 'lat')::numeric;
      new.longitude := (v_first ->> 'lng')::numeric;
      new.location_precision := coalesce(nullif(v_first ->> 'precision', ''), 'exact');
      if coalesce(new.location_name, '') = '' then new.location_name := left(v_first ->> 'name', 200); end if;
      new.geocoding_confidence := 0.7;
      new.ai_suggestions := coalesce(new.ai_suggestions, '{}'::jsonb) || jsonb_build_object(
        'location_resolution', jsonb_build_object('method', 'locations_list', 'place', v_first ->> 'name', 'resolved_at', now()));
    end if;
  end if;
  return new;
end;
$$;

-- Runs after events_resolve_location (trigger names fire in alphabetical order).
drop trigger if exists events_zz_promote_listed_place on public.events;
create trigger events_zz_promote_listed_place
  before insert or update on public.events
  for each row execute function public.promote_listed_place();

create or replace function public.refine_event_locations(p_limit integer default 5)
returns integer
language plpgsql
security definer
set search_path to ''
as $function$
declare
  r          record;
  v_queries  text[];
  v_query    text;
  v_resp     extensions.http_response;
  v_hit      jsonb;
  v_expected text;
  v_cc       text;
  v_type     text;
  v_lat      numeric;
  v_lng      numeric;
  v_done     int := 0;
  v_paren    text;
begin
  perform extensions.http_set_curlopt('CURLOPT_TIMEOUT', '8');
  for r in
    select e.id, e.location_name, e.country, e.ai_suggestions
    from public.events e
    where e.deleted_at is null
      and e.status in ('published', 'draft')
      and e.created_at > now() - interval '3 days'
      and e.location_precision in ('country', 'region')
      and not (e.ai_suggestions ? 'osm_checked')
      and (btrim(coalesce(e.location_name, '')) <> '' or coalesce(e.ai_suggestions ->> 'place_en', '') <> '')
      and (coalesce(e.ai_suggestions -> 'location_resolution' ->> 'method', '') <> 'gazetteer'
           or public.normalize_place(coalesce(e.location_name, ''))
              <> public.normalize_place(coalesce(e.ai_suggestions -> 'location_resolution' ->> 'matched_on', '')))
    order by e.created_at desc
    limit greatest(1, least(p_limit, 20))
  loop
    v_expected := nullif(r.ai_suggestions -> 'location_resolution' ->> 'country_code', '');
    if v_expected is null and coalesce(r.country, '') <> '' then
      v_expected := nullif((public.lookup_place(split_part(r.country, '/', 1))).country_code, '');
    end if;
    v_paren := btrim(split_part(substring(coalesce(r.location_name, '') from '\(([^)]+)\)'), '/', 1));
    v_queries := array_remove(array[
      nullif(btrim(coalesce(r.ai_suggestions ->> 'place_en', '')), ''),
      nullif(v_paren, ''),
      nullif(btrim(split_part(regexp_replace(coalesce(r.location_name, ''), '\([^)]*\)', '', 'g'), ',', 1)), '')
    ], null);
    v_hit := null;
    foreach v_query in array v_queries loop
      begin
        select * into v_resp from extensions.http((
          'GET',
          'https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=3&accept-language=en,he,ar'
            || coalesce('&countrycodes=' || lower(v_expected), '')
            || '&q=' || extensions.urlencode(v_query),
          array[extensions.http_header('User-Agent', 'Osintfront/1.0 (+https://main-drab-chi.vercel.app)')],
          null, null)::extensions.http_request);
        if v_resp.status = 200 then
          -- Any hit smaller than a country: towns, sites (airports, crossings, bases, ports),
          -- districts, straits… (precision is set from the type below).
          select h into v_hit
          from jsonb_array_elements(v_resp.content::jsonb) h
          where coalesce(h ->> 'addresstype', h ->> 'type') not in ('country', 'continent')
          limit 1;
        end if;
      exception when others then
        v_hit := null;
      end;
      perform pg_sleep(1.1);
      exit when v_hit is not null;
    end loop;
    v_cc := lower(v_hit -> 'address' ->> 'country_code');
    v_type := coalesce(v_hit ->> 'addresstype', v_hit ->> 'type');
    v_lat := (v_hit ->> 'lat')::numeric;
    v_lng := (v_hit ->> 'lon')::numeric;
    if v_hit is not null
       and (v_expected is null or v_cc = lower(v_expected))
       and v_lat between 10 and 43 and v_lng between 25 and 63 then
      update public.events
         set latitude = round(v_lat, 6),
             longitude = round(v_lng, 6),
             location_precision = case
               when v_type in ('state', 'province', 'region', 'county', 'state_district', 'district', 'governorate',
                               'sea', 'strait', 'bay', 'mountain_range', 'island', 'archipelago') then 'region'
               when v_type in ('city', 'town', 'village', 'hamlet', 'suburb', 'neighbourhood', 'quarter',
                               'municipality', 'locality', 'isolated_dwelling') then 'city'
               else 'exact' end,
             geocoding_confidence = 0.7,
             ai_suggestions = ai_suggestions
               || jsonb_build_object('osm_checked', true)
               || jsonb_build_object('location_resolution', jsonb_build_object(
                    'method', 'nominatim', 'query', v_query, 'place', v_hit ->> 'display_name',
                    'type', v_type, 'country_code', v_cc, 'resolved_at', now()))
       where id = r.id;
      v_done := v_done + 1;
    else
      update public.events
         set ai_suggestions = ai_suggestions || jsonb_build_object('osm_checked', true)
       where id = r.id;
    end if;
  end loop;
  return v_done;
end;
$function$;


-- Backfill: any update re-runs the trigger.
update public.events
   set location_precision = 'country'
 where deleted_at is null
   and location_precision = 'country'
   and jsonb_typeof(locations) = 'array' and jsonb_array_length(locations) > 0
   and created_at > now() - interval '3 days';

-- Let country-level events with a place name be looked up again with the wider rule.
update public.events
   set ai_suggestions = ai_suggestions - 'osm_checked'
 where deleted_at is null
   and location_precision in ('country', 'region')
   and ai_suggestions ? 'osm_checked'
   and created_at > now() - interval '3 days';
