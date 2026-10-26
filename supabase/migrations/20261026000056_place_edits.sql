-- Map: staff change the category or the place of ONE icon (a place of a multi-place report).
--  set_place_category: the icon's place moves to the report's event of that category (created
--    if there is none yet, linked to the same report); a single-icon event just changes category.
--  set_place_location: move one icon to a searched place (name + coordinates); learned like a
--    dragged pin.
-- p_index: index in events.locations; null = the event's main pin.

create or replace function public.set_place_category(p_id uuid, p_index integer, p_slug text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  e        public.events;
  v_cat    public.event_categories;
  v_locs   jsonb;
  v_idx    integer := p_index;
  v_item   jsonb;
  v_rest   jsonb;
  v_group  text;
  v_sib    uuid;
  v_new    uuid;
  v_first  jsonb;
  v_he     text;
  v_title  text;
  v_name   text;
  v_on_main boolean;
begin
  select * into e from public.events where id = p_id and deleted_at is null;
  if not found then raise exception 'Event not found.' using errcode = 'P0002'; end if;
  if auth.uid() is null or not (public.has_permission('event.edit.any')
       or (public.has_permission('event.edit.own') and e.created_by = auth.uid())) then
    raise exception 'You do not have permission to edit this event.' using errcode = '42501';
  end if;
  select * into v_cat from public.event_categories where slug = p_slug and is_active;
  if v_cat.id is null then raise exception 'Unknown category.' using errcode = '22023'; end if;

  v_locs := case when jsonb_typeof(e.locations) = 'array' then e.locations else '[]'::jsonb end;
  -- The main pin: the listed place standing on it (within ~300 m).
  if v_idx is null and e.latitude is not null then
    select (i - 1)::int into v_idx from jsonb_array_elements(v_locs) with ordinality as t(x, i)
    where jsonb_typeof(x -> 'lat') = 'number'
      and abs((x ->> 'lat')::numeric - e.latitude) < 0.003 and abs((x ->> 'lng')::numeric - e.longitude) < 0.003
    order by i limit 1;
  end if;

  -- One icon only (or the main pin of an event without a list): the whole event changes kind.
  if jsonb_array_length(v_locs) <= 1 or v_idx is null then
    update public.events set category_id = v_cat.id,
      locations = (select coalesce(jsonb_agg(case when x ? 'category_slug' then x || jsonb_build_object('category_slug', p_slug) else x end order by i), '[]'::jsonb)
                   from jsonb_array_elements(v_locs) with ordinality as t(x, i))
    where id = p_id;
    return p_id;
  end if;
  if v_idx < 0 or v_idx >= jsonb_array_length(v_locs) then raise exception 'Place not found.' using errcode = 'P0002'; end if;
  if v_cat.id = e.category_id and coalesce(v_locs -> v_idx ->> 'category_slug', p_slug) = p_slug then return p_id; end if;

  v_item := (v_locs -> v_idx) || jsonb_build_object('category_slug', p_slug);
  v_rest := v_locs - v_idx;
  v_group := coalesce(e.ai_suggestions ->> 'split_from', e.id::text);
  v_name := coalesce(nullif(v_item ->> 'name', ''), v_item ->> 'name_en', '');

  -- The report's event of that kind, if there is one.
  select s.id into v_sib from public.events s
  where s.deleted_at is null and s.id <> e.id and s.category_id = v_cat.id
    and (s.id::text = v_group or s.ai_suggestions ->> 'split_from' = v_group)
  order by s.created_at limit 1;

  if v_sib is not null then
    update public.events set locations = coalesce(locations, '[]'::jsonb) || jsonb_build_array(v_item) where id = v_sib;
  else
    v_he := case p_slug
      when 'airstrike' then 'תקיפה אווירית' when 'artillery-shelling' then 'הפגזה ארטילרית' when 'explosion' then 'פיצוץ'
      when 'uav' then 'כטב"מ' when 'drone' then 'רחפן' when 'shooting-gunfire' then 'ירי נשק קל'
      when 'missile-rocket-attack' then 'ירי רקטות וטילים' when 'assassination' then 'חיסול' when 'military-activity' then 'פעילות צבאית'
      when 'force-sighting' then 'זיהוי כוחות' when 'infiltration' then 'חדירה' when 'fire' then 'שריפה'
      when 'terror-security-incident' then 'אירוע טרור או ביטחוני' else v_cat.name end;
    v_title := left(v_he || ': ' || v_name, 200);
    insert into public.events (title, description, original_report_text, category_id, suggested_category_id, status, severity,
      latitude, longitude, location_name, location_precision, geocoding_confidence, country, region, city,
      source_name, source_url, source_type, occurred_at, published_at, created_by, approved_by,
      is_breaking, is_verified, classification_confidence, sources, whatsapp_text, translations, locations, ai_suggestions)
    values (v_title, e.description, e.original_report_text, v_cat.id, v_cat.id, e.status, e.severity,
      (v_item ->> 'lat')::numeric, (v_item ->> 'lng')::numeric, left(v_name, 200), coalesce(v_item ->> 'precision', 'exact'), 0.9,
      e.country, e.region, e.city, e.source_name, e.source_url, e.source_type, e.occurred_at, e.published_at, e.created_by, e.approved_by,
      e.is_breaking, e.is_verified, e.classification_confidence, e.sources, e.whatsapp_text,
      coalesce(e.translations, '{}'::jsonb)
        || jsonb_build_object('he', coalesce(e.translations -> 'he', '{}'::jsonb) || jsonb_build_object('title', v_title))
        || jsonb_build_object('en', coalesce(e.translations -> 'en', '{}'::jsonb) || jsonb_build_object('title',
             left(regexp_replace(v_cat.name, '\s*\(.*\)$', '') || ': ' || coalesce(nullif(v_item ->> 'name_en', ''), v_name), 200))),
      jsonb_build_array(v_item),
      (coalesce(e.ai_suggestions, '{}'::jsonb) - 'split_into') || jsonb_build_object('split_from', v_group, 'split_by_hand', true))
    returning id into v_sib;
    -- The report's first event now knows it was split (the map links the group).
    update public.events set ai_suggestions = coalesce(ai_suggestions, '{}'::jsonb)
      || jsonb_build_object('split_into', coalesce(ai_suggestions -> 'split_into', '[]'::jsonb) || to_jsonb(v_sib::text))
    where id::text = v_group;
  end if;

  -- The event keeps its other places; its main pin moves if it stood on the place that left.
  v_on_main := e.latitude is not null and jsonb_typeof(v_item -> 'lat') = 'number'
    and abs((v_item ->> 'lat')::numeric - e.latitude) < 0.003 and abs((v_item ->> 'lng')::numeric - e.longitude) < 0.003;
  select x into v_first from jsonb_array_elements(v_rest) with ordinality as t(x, i)
  where jsonb_typeof(x -> 'lat') = 'number' order by i limit 1;
  update public.events set locations = v_rest,
    latitude  = case when v_on_main and v_first is not null then (v_first ->> 'lat')::numeric else latitude end,
    longitude = case when v_on_main and v_first is not null then (v_first ->> 'lng')::numeric else longitude end,
    location_name = case when v_on_main and v_first is not null then left(coalesce(v_first ->> 'name', location_name), 200) else location_name end
  where id = p_id;
  return v_sib;
end;
$$;
revoke execute on function public.set_place_category(uuid, integer, text) from public, anon;
grant execute on function public.set_place_category(uuid, integer, text) to authenticated;

create or replace function public.set_place_location(p_id uuid, p_index integer, p_lat double precision, p_lng double precision, p_name text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_index is null then
    perform public.move_event_pin(p_id, p_lat, p_lng, p_name);
    return;
  end if;
  -- Checks the permission and learns the place.
  perform public.move_event_place(p_id, p_index, p_lat, p_lng);
  if coalesce(btrim(p_name), '') <> '' then
    update public.events set locations = jsonb_set(locations, array[p_index::text], (locations -> p_index) || jsonb_build_object('name', left(btrim(p_name), 120)))
    where id = p_id;
  end if;
end;
$$;
revoke execute on function public.set_place_location(uuid, integer, double precision, double precision, text) from public, anon;
grant execute on function public.set_place_location(uuid, integer, double precision, double precision, text) to authenticated;
