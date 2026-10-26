-- A report's places that are not in the small place gazetteer were dropped before the
-- GeoNames lookup (the learned-place trigger, which runs later) could pin them: a summary
-- naming 21 villages in south Lebanon kept only one. Now:
--  1. resolve_event_locations keeps an unknown place (name + category, no coordinates);
--  2. events_apply_learned_place looks it up in GeoNames and drops it only if still unknown;
--  3. events_resolve_location takes the first place that HAS coordinates as the fallback pin.

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
  v_cat   jsonb;
  v_i     int := 0;
begin
  if p_locations is null or jsonb_typeof(p_locations) <> 'array' then return '[]'::jsonb; end if;
  for v_item in select value from jsonb_array_elements(p_locations) loop
    exit when jsonb_array_length(v_out) >= 30;
    continue when jsonb_typeof(v_item) <> 'object';
    v_i := v_i + 1;
    v_name := left(btrim(coalesce(v_item ->> 'name', '')), 120);
    v_en   := left(btrim(coalesce(v_item ->> 'name_en', '')), 120);
    v_cat  := case when coalesce(v_item ->> 'category_slug', '') ~ '^[a-z0-9-]{1,60}$'
                   then jsonb_build_object('category_slug', v_item ->> 'category_slug') else '{}'::jsonb end;
    v_lat := case when jsonb_typeof(v_item -> 'lat') = 'number' then (v_item ->> 'lat')::numeric end;
    v_lng := case when jsonb_typeof(v_item -> 'lng') = 'number' then (v_item ->> 'lng')::numeric end;
    if v_lat between -90 and 90 and v_lng between -180 and 180 then
      v_out := v_out || jsonb_build_array(jsonb_build_object(
        'name', v_name, 'name_en', v_en, 'lat', round(v_lat, 6), 'lng', round(v_lng, 6),
        'precision', coalesce(nullif(v_item ->> 'precision', ''), 'exact')) || v_cat);
      continue;
    end if;
    v_hit := public.lookup_place(v_name);
    if v_hit.id is null and v_en <> '' then v_hit := public.lookup_place(v_en); end if;
    continue when v_hit.kind = 'country';
    if v_hit.id is null then
      -- Unknown here: kept for the GeoNames lookup (events_apply_learned_place).
      continue when v_name = '' and v_en = '';
      v_out := v_out || jsonb_build_array(jsonb_build_object('name', v_name, 'name_en', v_en, 'lat', null, 'lng', null) || v_cat);
      continue;
    end if;
    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'name', coalesce(nullif(v_name, ''), v_hit.canonical), 'name_en', coalesce(nullif(v_en, ''), v_hit.canonical),
      'lat', round(v_hit.latitude + public.place_jitter(p_seed, v_hit.kind, 10 + v_i), 6),
      'lng', round(v_hit.longitude + public.place_jitter(p_seed, v_hit.kind, 20 + v_i), 6),
      'precision', v_hit.kind) || v_cat);
  end loop;
  return v_out;
end;
$$;

create or replace function public.events_apply_learned_place()
returns trigger language plpgsql security definer set search_path = '' as $function$
declare
  v_hit   public.learned_places;
  v_geo   public.geo_places;
  v_ids   uuid[] := '{}';
  v_items jsonb := '[]'::jsonb;
  v_item  jsonb;
  v_lp    public.learned_places;
  v_g     public.geo_places;
begin
  if auth.uid() is not null then
    -- A person's edit: places still without coordinates never stay in the list.
    if jsonb_typeof(new.locations) = 'array' then
      new.locations := (select coalesce(jsonb_agg(x order by i), '[]'::jsonb)
                        from jsonb_array_elements(new.locations) with ordinality as t(x, i)
                        where jsonb_typeof(x -> 'lat') = 'number' and jsonb_typeof(x -> 'lng') = 'number');
    end if;
    return new;
  end if;
  if cardinality(coalesce(new.hfc_areas, '{}')) > 0 then return new; end if;
  if tg_op = 'UPDATE'
     and new.location_name is not distinct from old.location_name
     and new.locations is not distinct from old.locations
     and (new.latitude, new.longitude) is not distinct from (old.latitude, old.longitude) then
    return new;
  end if;

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
            'name_en', coalesce(nullif(v_item ->> 'name_en', ''), v_g.name_en, v_g.name));
        end if;
      end if;
      -- Still not found anywhere: left out (no pin can be shown for it).
      continue when jsonb_typeof(v_item -> 'lat') <> 'number' or jsonb_typeof(v_item -> 'lng') <> 'number';
      v_items := v_items || jsonb_build_array(v_item);
    end loop;
    new.locations := v_items;
    -- No main pin yet, or only the country's: the first place that was found.
    if (new.latitude is null or new.location_precision = 'country') and jsonb_array_length(v_items) > 0 then
      new.latitude := (v_items -> 0 ->> 'lat')::numeric;
      new.longitude := (v_items -> 0 ->> 'lng')::numeric;
      new.location_precision := coalesce(nullif(v_items -> 0 ->> 'precision', ''), 'exact');
      if coalesce(new.location_name, '') = '' then new.location_name := left(v_items -> 0 ->> 'name', 200); end if;
      new.geocoding_confidence := 0.7;
    end if;
  end if;

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
      new.location_name_en := coalesce(nullif(new.ai_suggestions ->> 'place_en', ''),
        case when tg_op = 'UPDATE' and new.location_name is not distinct from old.location_name then new.location_name_en end,
        v_geo.name_en, v_geo.name);
      if coalesce(new.country, '') = '' then
        new.country := case v_geo.country_code when 'IL' then 'Israel' when 'SY' then 'Syria' when 'LB' then 'Lebanon'
          when 'IQ' then 'Iraq' when 'YE' then 'Yemen' when 'SA' then 'Saudi Arabia' when 'IR' then 'Iran' end;
      end if;
      new.ai_suggestions := coalesce(new.ai_suggestions, '{}'::jsonb) || jsonb_build_object(
        'location_resolution', jsonb_build_object('method', 'geonames', 'geonameid', v_geo.geonameid,
                                                   'matched_on', new.location_name, 'place', v_geo.name_en, 'resolved_at', now()));
    end if;
  end if;

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
$function$;

create or replace function public.events_resolve_location()
returns trigger language plpgsql security definer set search_path = '' as $function$
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
      new.location_precision := 'exact';
    end if;
  elsif new.latitude is null and new.longitude is null then
    select r.place_id, r.matched_on into v_place_id, v_matched
    from public.resolve_event_place(new.location_name, new.city, new.region, new.country) r;

    -- The first listed place that already has coordinates (others wait for the GeoNames lookup).
    select x into v_first from jsonb_array_elements(new.locations) with ordinality as t(x, i)
    where jsonb_typeof(x -> 'lat') = 'number' and jsonb_typeof(x -> 'lng') = 'number' order by i limit 1;

    if v_place_id is not null and jsonb_array_length(new.locations) > 0
       and (select g.kind from public.place_gazetteer g where g.id = v_place_id) = 'country' then
      v_place_id := null;
    end if;

    if v_place_id is null and v_first is not null then
      new.latitude  := (v_first ->> 'lat')::numeric;
      new.longitude := (v_first ->> 'lng')::numeric;
      new.location_precision := coalesce(v_first ->> 'precision', 'exact');
      if coalesce(new.location_name, '') = '' then new.location_name := left(v_first ->> 'name', 200); end if;
      new.geocoding_confidence := 0.7;
      new.ai_suggestions := coalesce(new.ai_suggestions, '{}'::jsonb) || jsonb_build_object(
        'location_resolution', jsonb_build_object('method', 'locations_list', 'place', v_first ->> 'name', 'resolved_at', now()));
    end if;

    -- Only the country is known: its pin (a listed place found later by GeoNames replaces it).
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
$function$;
