-- Country-only events that still name a place (cheap-mode Telegram posts, places the
-- gazetteer doesn't know) get looked up in OpenStreetMap:
--  * any event at country/region precision with a place name (not only gazetteer matches);
--  * the English name is tried first: ai_suggestions.place_en (from the classifier) or the
--    "(English)" part of the name, then the name as written;
--  * the country code comes from the resolution, else from the country name;
--  * 8 events per minute (Nominatim allows ~1 request/s).
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
          select h into v_hit
          from jsonb_array_elements(v_resp.content::jsonb) h
          where coalesce(h ->> 'addresstype', h ->> 'type') in
                ('city', 'town', 'village', 'hamlet', 'suburb', 'neighbourhood', 'quarter', 'municipality', 'locality', 'isolated_dwelling')
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
  end loop;
  return v_done;
end;
$function$;

select cron.alter_job((select jobid from cron.job where jobname = 'osintfront-refine-locations'),
                      schedule := '* * * * *', command := 'select public.refine_event_locations(8)');
