-- ════════════════════════════════════════════════════════════════════
-- Osintfront · Migration 29 — quick edits (map "change location", events list)
-- move_event_pin: staff (editor or admin) moves an event's pin from the public map
--   or the events list. Runs as the person, so the learning trigger
--   (events_learn_from_correction) learns the place for the next reports.
-- set_event_category: change the category from the events list (learned too).
-- ════════════════════════════════════════════════════════════════════
create or replace function public.move_event_pin(p_id uuid, p_lat double precision, p_lng double precision, p_location_name text default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or not (public.has_permission('event.edit.any') or public.has_permission('event.edit.own')) then
    raise exception 'You do not have permission to move events.' using errcode = '42501';
  end if;
  if p_lat is null or p_lng is null or p_lat not between -90 and 90 or p_lng not between -180 and 180 then
    raise exception 'Bad coordinates.' using errcode = '22023';
  end if;
  update public.events
     set latitude = p_lat, longitude = p_lng, location_precision = 'exact', geocoding_confidence = 1,
         location_name = coalesce(nullif(btrim(p_location_name), ''), location_name)
   where id = p_id and deleted_at is null;
  if not found then raise exception 'Event not found.' using errcode = 'P0002'; end if;
end;
$$;
revoke execute on function public.move_event_pin(uuid, double precision, double precision, text) from public, anon;
grant execute on function public.move_event_pin(uuid, double precision, double precision, text) to authenticated;

create or replace function public.set_event_category(p_id uuid, p_slug text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_cat uuid; v_owner uuid;
begin
  select created_by into v_owner from public.events where id = p_id and deleted_at is null;
  if not found then raise exception 'Event not found.' using errcode = 'P0002'; end if;
  if auth.uid() is null or not (public.has_permission('event.edit.any')
       or (public.has_permission('event.edit.own') and v_owner = auth.uid())) then
    raise exception 'You do not have permission to edit this event.' using errcode = '42501';
  end if;
  select id into v_cat from public.event_categories where slug = p_slug and is_active;
  if v_cat is null then raise exception 'Unknown category.' using errcode = '22023'; end if;
  update public.events set category_id = v_cat where id = p_id;
end;
$$;
revoke execute on function public.set_event_category(uuid, text) from public, anon;
grant execute on function public.set_event_category(uuid, text) to authenticated;
