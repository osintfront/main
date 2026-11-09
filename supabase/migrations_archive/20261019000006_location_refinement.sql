-- ════════════════════════════════════════════════════════════════════
-- Osintfront · Migration 6 — refine approximate locations via OpenStreetMap
--
-- Events placed only at region/country level by the gazetteer (because the
-- specific name, e.g. a small village, isn't in it) are looked up on
-- Nominatim every 5 minutes. A result is accepted only when it is a
-- settlement-level place inside the same country whose own name matches
-- the queried name (allowing small spelling differences such as
-- תבנית/תיבנית), so a bad match can't move a pin. Each event is tried once.
-- ════════════════════════════════════════════════════════════════════

create extension if not exists http with schema extensions;
create extension if not exists pg_cron;
create extension if not exists fuzzystrmatch with schema extensions;

create or replace function public.refine_event_locations(p_limit int default 5)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  r          record;
  v_query    text;
  v_resp     extensions.http_response;
  v_hit      jsonb;
  v_expected text;
  v_cc       text;
  v_type     text;
  v_lat      numeric;
  v_lng      numeric;
  v_done     int := 0;
begin
  perform extensions.http_set_curlopt('CURLOPT_TIMEOUT', '8');

  for r in
    select e.id, e.location_name, e.country, e.ai_suggestions
    from public.events e
    where e.deleted_at is null
      and e.location_precision in ('country', 'region')
      and e.ai_suggestions -> 'location_resolution' ->> 'method' = 'gazetteer'
      and not (e.ai_suggestions ? 'osm_checked')
      and btrim(coalesce(e.location_name, '')) <> ''
      -- Only when the specific name was NOT what matched (it fell back to a broader area).
      and public.normalize_place(e.location_name)
          <> public.normalize_place(e.ai_suggestions -> 'location_resolution' ->> 'matched_on')
    order by e.created_at desc
    limit greatest(1, least(p_limit, 20))
  loop
    v_expected := r.ai_suggestions -> 'location_resolution' ->> 'country_code';
    v_query := btrim(split_part(r.location_name, ',', 1));
    v_hit := null;

    begin
      select * into v_resp from extensions.http((
        'GET',
        'https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=3&accept-language=he,en'
          || coalesce('&countrycodes=' || v_expected, '')
          || '&q=' || extensions.urlencode(v_query),
        array[extensions.http_header('User-Agent', 'Osintfront/1.0 (+https://main-drab-chi.vercel.app)')],
        null, null)::extensions.http_request);

      if v_resp.status = 200 then
        select h into v_hit
        from jsonb_array_elements(v_resp.content::jsonb) h
        where coalesce(h ->> 'addresstype', h ->> 'type') in
              ('city', 'town', 'village', 'hamlet', 'suburb', 'neighbourhood', 'quarter', 'municipality', 'locality', 'isolated_dwelling')
          -- The place's own name must be (nearly) the name we searched for.
          and extensions.levenshtein(
                left(public.normalize_place(coalesce(h ->> 'name', split_part(h ->> 'display_name', ',', 1))), 255),
                left(public.normalize_place(v_query), 255))
              <= greatest(1, char_length(public.normalize_place(v_query)) / 5)
        limit 1;
      end if;
    exception when others then
      v_hit := null; -- network/parse problem: leave the approximate location in place
    end;

    v_cc := lower(v_hit -> 'address' ->> 'country_code');
    v_type := coalesce(v_hit ->> 'addresstype', v_hit ->> 'type');
    v_lat := (v_hit ->> 'lat')::numeric;
    v_lng := (v_hit ->> 'lon')::numeric;

    if v_hit is not null
       and (v_expected is null or v_cc = v_expected)
       and v_lat between 10 and 43 and v_lng between 25 and 63 then
      update public.events
         set latitude = round(v_lat, 6),
             longitude = round(v_lng, 6),
             location_precision = 'city',
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

    perform pg_sleep(1.1); -- Nominatim usage policy: at most 1 request per second
  end loop;

  return v_done;
end;
$$;

revoke execute on function public.refine_event_locations(int) from public, anon, authenticated;

-- One-off clean-up (no-op on fresh installs): an earlier version of this
-- function, without the name check, matched "Western border" to an unrelated
-- village. Clear such results so the resolver trigger places them again.
update public.events
   set latitude = null, longitude = null, location_precision = null,
       ai_suggestions = (ai_suggestions - 'location_resolution') || '{"osm_checked": true}'::jsonb
 where ai_suggestions -> 'location_resolution' ->> 'method' = 'nominatim'
   and ai_suggestions -> 'location_resolution' ->> 'query' = 'Western border';

select cron.schedule(
  'osintfront-refine-locations',
  '*/5 * * * *',
  $cron$select public.refine_event_locations(5)$cron$
);
