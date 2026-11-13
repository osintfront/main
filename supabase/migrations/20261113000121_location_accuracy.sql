-- Wrong / duplicated locations (bug, Dani — "should be in Ramallah"):
--  1. refine_event_locations looked the expected country up with lookup_place(), which does not know
--     "Palestine" (the most common country): Nominatim then searched the whole world — a Bedouin community east
--     of Ramallah landed on a shop in Oman, a village on one in Turkey. Now: country_iso_set() (Israel and
--     Palestine search together: West Bank places are often labelled Israel), no country → no Nominatim
--     search at all, and a hit outside the expected countries is refused.
--  2. geo_lookup filtered by one country only, so a West Bank village on an event labelled "Israel" (Sinjil,
--     Abu Falah) was never found and stayed on a country-level pin. Israel and Palestine now search together.
--  3. Same-name places (three Burqas): reports say "east of Ramallah" / "מזרחית לרמאללה" / "شرق رام الله".
--     place_anchor() finds that reference town; the place is then the namesake nearest to it (≤ 40 km), both in
--     the insert-time lookup (events_apply_learned_place) and in the Nominatim search (bounded box around it).
--  4. repair_misplaced_events(): events Nominatim put outside their country are looked up again the same way,
--     or put back on their country's pin.

-- ── 1/2. Countries ────────────────────────────────────────────────────────────────────────────────────────
create or replace function public.country_iso_set(p_country text)
returns text[] language sql stable parallel safe set search_path = '' as $$
  select case
    when v.iso in ('IL', 'PS') then array['IL', 'PS']
    when v.iso is not null then array[v.iso]
  end
  from (select coalesce(public.country_iso(split_part(coalesce(p_country, ''), '/', 1)),
                        case when coalesce(p_country, '') ~ 'فلسطين|غزة|الضفة' then 'PS' end) as iso) v;
$$;

do $do$
declare v_def text;
begin
  v_def := pg_get_functiondef('public.geo_lookup(text, text, double precision, double precision)'::regprocedure);
  if position('v_cc    text := public.country_iso(p_country);' in v_def) = 0
     or position('($2::text is null or c.country_code = $2)' in v_def) = 0 then
    raise exception 'geo_lookup changed since this migration was written';
  end if;
  v_def := replace(v_def, 'v_cc    text := public.country_iso(p_country);', 'v_cc    text[] := public.country_iso_set(p_country);');
  v_def := replace(v_def, '($2::text is null or c.country_code = $2)', '($2::text[] is null or c.country_code = any($2::text[]))');
  execute v_def;
end $do$;

-- ── 3. "X east of Y" ─────────────────────────────────────────────────────────────────────────────────────
-- The reference town named after a direction word (Hebrew, Arabic, English), looked up in the place
-- database; the first one found in the texts given (location name first, then title, then report).
create or replace function public.place_anchor(p_texts text[], p_country text default null)
returns public.geo_places language plpgsql stable set search_path = '' as $$
declare
  t text; m text[]; w text[]; v_try text; g public.geo_places;
begin
  foreach t in array coalesce(p_texts, '{}') loop
    continue when t is null or btrim(t) = '';
    for m in select regexp_matches(t,
        '(?:(?:ש|ה)?(?:מזרחית|מערבית|צפונית|דרומית|ממזרח|ממערב|מצפון|מדרום|(?:מ?צפון|מ?דרום)-(?:מזרחית|מערבית|מזרח|מערב))(?:[ -](?:מזרחית|מערבית|מזרח|מערב))?\s+ל-?'
        || '|(?:شرق|غرب|شمال|جنوب)(?:ي|ى)?(?:\s+(?:شرق|غرب)(?:ي)?)?\s+(?:مدينة\s+|محافظة\s+|بلدة\s+|قرية\s+)?'
        || '|(?:north|south|east|west)(?:-?(?:east|west))?(?:ern)?\s+of\s+(?:the\s+)?(?:city\s+of\s+|town\s+of\s+)?)'
        || '([^\s,.;:()،"'']+(?:[\s-][^\s,.;:()،"'']+)?)', 'gi') loop
      w := regexp_split_to_array(m[1], '\s+');
      -- Two words first ("رام الله", "אל-בירה"), then the first word alone.
      foreach v_try in array array[m[1], w[1]] loop
        continue when v_try is null or char_length(v_try) < 2;
        g := public.geo_lookup(v_try, p_country);
        if g.geonameid is null then g := public.geo_lookup(v_try, null); end if;
        if g.geonameid is not null and g.feature_class in ('P', 'A') then return g; end if;
      end loop;
    end loop;
  end loop;
  return null;
end $$;

-- "برقة شرق رام الله" → "برقة"; "Burqa, east of Ramallah" → "Burqa"; a name without a direction is kept.
create or replace function public.place_before_anchor(p_name text)
returns text language sql immutable parallel safe set search_path = '' as $$
  select coalesce(nullif(btrim(regexp_replace(coalesce(p_name, ''),
    '[\s,،-]*(?:(?:ש|ה)?(?:מזרחית|מערבית|צפונית|דרומית|ממזרח|ממערב|מצפון|מדרום|(?:מ?צפון|מ?דרום)-(?:מזרחית|מערבית|מזרח|מערב))\s|(?:شرق|غرب|شمال|جنوب)(?:ي|ى)?\s|(?:north|south|east|west)(?:-?(?:east|west))?(?:ern)?\s+of\s).*$',
    '', 'i')), ''), p_name);
$$;

-- events_apply_learned_place: the main place is looked up near the reference town when the report names one.
do $do$
declare v_def text;
  v_old text := '    v_geo := public.geo_lookup(new.location_name, new.country, new.latitude::float8, new.longitude::float8);';
begin
  v_def := pg_get_functiondef('public.events_apply_learned_place()'::regprocedure);
  if position(v_old in v_def) = 0 or position('  v_g     public.geo_places;' in v_def) = 0 then
    raise exception 'events_apply_learned_place changed since this migration was written';
  end if;
  v_def := replace(v_def, '  v_g     public.geo_places;', '  v_g     public.geo_places;
  v_anchor public.geo_places;');
  v_def := replace(v_def, v_old, '    -- "Burqa east of Ramallah": the Burqa nearest to Ramallah (≤ 40 km), not the biggest one.
    v_anchor := public.place_anchor(array[new.location_name, new.title, left(new.original_report_text, 1500)], new.country);
    if v_anchor.geonameid is not null then
      v_geo := public.geo_lookup(public.place_before_anchor(new.location_name), new.country,
                                 extensions.st_y(v_anchor.geom), extensions.st_x(v_anchor.geom));
      if v_geo.geonameid is not null
         and extensions.st_distance(v_geo.geom::extensions.geography, v_anchor.geom::extensions.geography) > 40000 then
        v_geo := null;
      end if;
    end if;
    if v_geo.geonameid is null then
      v_geo := public.geo_lookup(new.location_name, new.country, new.latitude::float8, new.longitude::float8);
    end if;');
  execute v_def;
end $do$;

-- ── 1/3. Nominatim refinement ────────────────────────────────────────────────────────────────────────────
create or replace function public.refine_event_locations(p_limit integer default 5)
returns integer language plpgsql security definer set search_path = '' as $function$
declare
  r          record;
  v_queries  text[];
  v_query    text;
  v_resp     extensions.http_response;
  v_hit      jsonb;
  v_codes    text[];
  v_cc       text;
  v_type     text;
  v_lat      numeric;
  v_lng      numeric;
  v_done     int := 0;
  v_paren    text;
  v_anchor   public.geo_places;
  v_box      text;
begin
  perform extensions.http_set_curlopt('CURLOPT_TIMEOUT', '8');
  for r in
    select e.id, e.location_name, e.country, e.ai_suggestions, e.title, left(e.original_report_text, 1500) as orig
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
    -- Expected countries: the resolver's, else the event's. None known → no world-wide search.
    v_codes := case when nullif(r.ai_suggestions -> 'location_resolution' ->> 'country_code', '') is not null
                    then public.country_iso_set(public.country_name_from_code(r.ai_suggestions -> 'location_resolution' ->> 'country_code'))
               end;
    if v_codes is null then v_codes := public.country_iso_set(r.country); end if;
    if v_codes is null then
      update public.events set ai_suggestions = ai_suggestions || jsonb_build_object('osm_checked', true) where id = r.id;
      continue;
    end if;
    -- "… east of Ramallah": search only around Ramallah.
    v_anchor := public.place_anchor(array[r.location_name, r.title, r.orig], r.country);
    v_box := case when v_anchor.geonameid is not null then format('&viewbox=%s,%s,%s,%s&bounded=1',
               round((extensions.st_x(v_anchor.geom) - 0.35)::numeric, 3), round((extensions.st_y(v_anchor.geom) + 0.35)::numeric, 3),
               round((extensions.st_x(v_anchor.geom) + 0.35)::numeric, 3), round((extensions.st_y(v_anchor.geom) - 0.35)::numeric, 3)) end;
    v_paren := btrim(split_part(substring(coalesce(r.location_name, '') from '\(([^)]+)\)'), '/', 1));
    v_queries := array_remove(array[
      nullif(btrim(coalesce(r.ai_suggestions ->> 'place_en', '')), ''),
      nullif(v_paren, ''),
      nullif(btrim(public.place_before_anchor(split_part(regexp_replace(coalesce(r.location_name, ''), '\([^)]*\)', '', 'g'), ',', 1))), '')
    ], null);
    v_hit := null;
    foreach v_query in array v_queries loop
      begin
        select * into v_resp from extensions.http((
          'GET',
          'https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=3&accept-language=en,he,ar'
            || '&countrycodes=' || lower(array_to_string(v_codes, ','))
            || coalesce(v_box, '')
            || '&q=' || extensions.urlencode(v_query),
          array[extensions.http_header('User-Agent', 'Osintfront/1.0 (+https://osintfront.com)')],
          null, null)::extensions.http_request);
        if v_resp.status = 200 then
          select h into v_hit
          from jsonb_array_elements(v_resp.content::jsonb) h
          where coalesce(h ->> 'addresstype', h ->> 'type') not in ('country', 'continent')
            and upper(h -> 'address' ->> 'country_code') = any(v_codes)
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
    if v_hit is not null and upper(v_cc) = any(v_codes) and v_lat between 10 and 43 and v_lng between 25 and 63 then
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
               || jsonb_build_object('location_resolution', jsonb_strip_nulls(jsonb_build_object(
                    'method', 'nominatim', 'query', v_query, 'place', v_hit ->> 'display_name',
                    'type', v_type, 'country_code', v_cc, 'near', v_anchor.name, 'resolved_at', now())))
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
revoke execute on function public.refine_event_locations(integer) from public, anon, authenticated;

-- ── 4. Repair ────────────────────────────────────────────────────────────────────────────────────────────
-- Events Nominatim placed outside their own country (Palestine → Oman, Turkey…): looked up again in the place
-- database (near the reference town when the report names one); not found → back on the country's pin.
-- Staff-placed events and statements are not touched. p_apply = false only counts.
create or replace function public.repair_misplaced_events(p_apply boolean default false)
returns table (fixed int, to_country int) language plpgsql security definer set search_path = '' as $$
declare r record; g public.geo_places; a public.geo_places; c public.place_gazetteer; v_fixed int := 0; v_country int := 0;
begin
  for r in
    select e.id, e.location_name, e.country, e.title, left(e.original_report_text, 1500) orig, e.ai_suggestions ->> 'place_en' place_en
    from public.events e
    where e.deleted_at is null
      and e.ai_suggestions -> 'location_resolution' ->> 'method' = 'nominatim'
      -- Statements keep the speaker's country and may well be abroad (Abbas in Nicosia).
      and not exists (select 1 from public.event_categories ec where ec.id = e.category_id and ec.slug = 'statements')
      and public.country_iso_set(e.country) is not null
      and not (upper(coalesce(e.ai_suggestions -> 'location_resolution' ->> 'country_code', '')) = any(public.country_iso_set(e.country)))
  loop
    a := public.place_anchor(array[r.location_name, r.title, r.orig], r.country);
    g := null;
    if a.geonameid is not null then
      g := public.geo_lookup(public.place_before_anchor(r.location_name), r.country, extensions.st_y(a.geom), extensions.st_x(a.geom));
      if g.geonameid is null and coalesce(r.place_en, '') <> '' then
        g := public.geo_lookup(r.place_en, r.country, extensions.st_y(a.geom), extensions.st_x(a.geom));
      end if;
      if g.geonameid is not null and extensions.st_distance(g.geom::extensions.geography, a.geom::extensions.geography) > 40000 then g := null; end if;
    end if;
    if g.geonameid is null then g := public.geo_lookup(public.place_before_anchor(r.location_name), r.country); end if;
    if g.geonameid is null and coalesce(r.place_en, '') <> '' then g := public.geo_lookup(r.place_en, r.country); end if;
    if g.geonameid is not null then
      v_fixed := v_fixed + 1;
      if p_apply then
        update public.events set
          latitude = round(extensions.st_y(g.geom)::numeric, 6), longitude = round(extensions.st_x(g.geom)::numeric, 6),
          location_precision = case when g.feature_class = 'A' then 'region' else 'exact' end, geocoding_confidence = 0.85,
          location_name_he = coalesce(location_name_he, g.name_he), location_name_en = coalesce(location_name_en, g.name_en),
          ai_suggestions = ai_suggestions || jsonb_build_object('location_resolution', jsonb_strip_nulls(jsonb_build_object(
            'method', 'repair', 'geonameid', g.geonameid, 'place', coalesce(g.name_en, g.name), 'near', a.name, 'resolved_at', now())))
        where id = r.id;
      end if;
    else
      -- The country's own pin (West Bank / Gaza Strip for Palestine, by what the report says).
      select pg.* into c from public.place_gazetteer pg
       where pg.kind = 'country' and upper(pg.country_code) = (public.country_iso_set(r.country))[case when (public.country_iso_set(r.country))[1] = 'IL' and r.country !~* 'israel|ישראל' then 2 else 1 end]
       order by (pg.canonical = 'Gaza Strip') = (coalesce(r.title, '') || coalesce(r.orig, '') ~ 'עזה|غزة|Gaza') desc
       limit 1;
      if c.id is not null then
        v_country := v_country + 1;
        if p_apply then
          update public.events set latitude = c.latitude, longitude = c.longitude, location_precision = 'country', geocoding_confidence = 0.3,
            ai_suggestions = ai_suggestions || jsonb_build_object('location_resolution', jsonb_build_object(
              'method', 'repair_country', 'place', c.canonical, 'resolved_at', now()))
          where id = r.id;
        end if;
      end if;
    end if;
  end loop;
  return query select v_fixed, v_country;
end $$;
revoke execute on function public.repair_misplaced_events(boolean) from public, anon, authenticated;

-- Placed right, labelled wrong: south-Lebanon villages (Bar'ashit, al-Qantara) carried "Palestine".
update public.events e set country = 'Lebanon'
 where e.deleted_at is null and e.country = 'Palestine'
   and e.ai_suggestions -> 'location_resolution' ->> 'method' = 'nominatim'
   and e.ai_suggestions -> 'location_resolution' ->> 'country_code' = 'lb'
   and e.ai_suggestions -> 'location_resolution' ->> 'place' ~ 'Nabatieh Governorate|Bint Jbeil District';

select * from public.repair_misplaced_events(true);

-- ── Follow-up after the repair ───────────────────────────────────────────────────────────────────────────
-- Searching Israel and Palestine together let three West Bank places that the database lacks match Golan
-- namesakes. The event's own country now comes first (unless a candidate lies within 40 km of the hint).
create or replace function public.country_iso_set(p_country text)
returns text[] language sql stable parallel safe set search_path = '' as $$
  select case
    when v.iso = 'PS' then array['PS', 'IL']
    when v.iso = 'IL' then array['IL', 'PS']
    when v.iso is not null then array[v.iso]
  end
  from (select coalesce(public.country_iso(split_part(coalesce(p_country, ''), '/', 1)),
                        case when coalesce(p_country, '') ~ 'فلسطين|غزة|الضفة' then 'PS' end) as iso) v;
$$;

do $do$
declare v_def text;
  v_old text := '      order by
        case when $3::extensions.geography is null then 0 else extensions.st_distance(c.geom::extensions.geography, $3) end,';
begin
  v_def := pg_get_functiondef('public.geo_lookup(text, text, double precision, double precision)'::regprocedure);
  if position(v_old in v_def) = 0 then raise exception 'geo_lookup order clause not found'; end if;
  execute replace(v_def, v_old, '      order by
        -- Within 40 km of the hint first (the reference town / the model''s guess), then the event''s own
        -- country before the neighbour searched with it (Palestine before Israel and back), then distance.
        case when $3::extensions.geography is null then 0 when extensions.st_dwithin(c.geom::extensions.geography, $3, 40000) then 0 else 1 end,
        case when $2::text[] is null or c.country_code = ($2::text[])[1] then 0 else 1 end,
        case when $3::extensions.geography is null then 0 else extensions.st_distance(c.geom::extensions.geography, $3) end,');
end $do$;

update public.events e set latitude = 32.000000, longitude = 35.250000, location_precision = 'country', geocoding_confidence = 0.3,
  ai_suggestions = e.ai_suggestions || jsonb_build_object('location_resolution', jsonb_build_object('method', 'repair_country', 'place', 'West Bank', 'resolved_at', now()))
 where e.deleted_at is null and e.country = 'Palestine'
   and e.ai_suggestions -> 'location_resolution' ->> 'method' = 'geonames'
   and (e.ai_suggestions -> 'location_resolution' ->> 'resolved_at')::timestamptz > now() - interval '1 hour'
   and e.latitude between 32.6 and 33.4 and e.longitude between 35.6 and 35.95;
