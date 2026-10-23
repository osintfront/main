-- ════════════════════════════════════════════════════════════════════
-- Osintfront · Migration 37 — remove a pin from the map (editors and admins)
-- remove_event_pin(id, index):
--   index = a place in events.locations → that place is removed.
--   index null = the main pin → the next listed place becomes the main pin; with no other
--     place, the event stays (feed, archive) but is not drawn on the map
--     (location_precision = 'country', places list emptied).
-- Only event.edit.any (editors, admins). An editor's change to a published event is
-- flagged for review by the existing trigger (events_aa_editor_review).
-- ════════════════════════════════════════════════════════════════════
create or replace function public.remove_event_pin(p_id uuid, p_index integer default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_ev record; v_rest jsonb; v_first jsonb; v_name text;
begin
  if auth.uid() is null or not public.has_permission('event.edit.any') then
    raise exception 'You do not have permission to remove pins.' using errcode = '42501';
  end if;
  select latitude, longitude, coalesce(locations, '[]'::jsonb) as locations into v_ev
  from public.events where id = p_id and deleted_at is null;
  if not found then raise exception 'Event not found.' using errcode = 'P0002'; end if;
  if jsonb_typeof(v_ev.locations) <> 'array' then v_ev.locations := '[]'::jsonb; end if;

  if p_index is not null then
    if p_index < 0 or p_index >= jsonb_array_length(v_ev.locations) then
      raise exception 'Place not found.' using errcode = 'P0002';
    end if;
    update public.events set locations = v_ev.locations - p_index where id = p_id;
    return;
  end if;

  -- Main pin: leave out the listed places sitting on it (same rule as the site: ~300 m).
  select coalesce(jsonb_agg(x.value order by x.ord), '[]'::jsonb) into v_rest
  from jsonb_array_elements(v_ev.locations) with ordinality x(value, ord)
  where not (jsonb_typeof(x.value -> 'lat') = 'number' and jsonb_typeof(x.value -> 'lng') = 'number'
             and v_ev.latitude is not null
             and abs((x.value ->> 'lat')::float8 - v_ev.latitude) < 0.003
             and abs((x.value ->> 'lng')::float8 - v_ev.longitude) < 0.003);
  select x.value into v_first from jsonb_array_elements(v_rest) x
  where jsonb_typeof(x.value -> 'lat') = 'number' and jsonb_typeof(x.value -> 'lng') = 'number' limit 1;

  if v_first is null then
    update public.events
       set location_precision = 'country', locations = v_rest
     where id = p_id;
  else
    v_name := coalesce(nullif(v_first ->> 'name', ''), v_first ->> 'name_en');
    update public.events
       set latitude = (v_first ->> 'lat')::numeric, longitude = (v_first ->> 'lng')::numeric,
           location_precision = coalesce(nullif(v_first ->> 'precision', ''), 'exact'),
           location_name = left(coalesce(v_name, ''), 200),
           location_name_he = case when public.has_hebrew(v_first ->> 'name') then left(v_first ->> 'name', 200) end,
           location_name_en = nullif(left(coalesce(v_first ->> 'name_en', ''), 200), ''),
           locations = v_rest,
           coordinates_manually_corrected = true
     where id = p_id;
  end if;
end;
$$;
revoke execute on function public.remove_event_pin(uuid, integer) from public, anon;
grant execute on function public.remove_event_pin(uuid, integer) to authenticated;
