-- ════════════════════════════════════════════════════════════════════
-- Osintfront · Migration 31 — roles
--  super_admin  everything (incl. AI usage page, settings, managing admins).
--  admin        events: edit, review, publish, archive, delete; categories; creates
--               editors and users; receives editors' changes for approval. No AI usage page.
--  editor       back office: the events list only. Edits events (category, place,
--               text) and moves pins on the map; no create / publish / archive / delete.
--               Every edit goes to an admin: an unpublished event becomes "pending
--               review"; a published one stays live, flagged review_requested_at.
--  viewer       ("user") the public map with filters only; no back office.
-- New permissions: admin.access (enter the back office), ai.usage.view.
-- ════════════════════════════════════════════════════════════════════
create or replace function public.role_permissions(p_role public.app_role)
returns text[] language sql immutable set search_path = '' as $$
  select case p_role
    when 'super_admin' then array[
      'admin.access', 'dashboard.view', 'event.view.operational', 'event.view.internal',
      'event.create', 'event.edit.own', 'event.edit.any', 'event.review', 'event.publish',
      'event.archive', 'event.delete', 'category.manage',
      'user.invite', 'user.manage', 'user.manage.admins', 'role.manage',
      'audit.view', 'settings.manage', 'ai.usage.view']
    when 'admin' then array[
      'admin.access', 'dashboard.view', 'event.view.operational', 'event.view.internal',
      'event.create', 'event.edit.own', 'event.edit.any', 'event.review', 'event.publish',
      'event.archive', 'event.delete', 'category.manage',
      'user.invite', 'user.manage', 'audit.view']
    when 'editor' then array['admin.access', 'event.view.operational', 'event.view.internal', 'event.edit.any']
    when 'viewer' then array[]::text[]
    else array[]::text[]
  end;
$$;

alter table public.events add column if not exists review_requested_at timestamptz;
alter table public.events add column if not exists review_requested_by uuid references public.profiles(id) on delete set null;
create index if not exists events_review_requested_idx on public.events (review_requested_at) where review_requested_at is not null;

-- An editor's change waits for an admin.
create or replace function public.events_editor_review()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then return new; end if;
  if public.has_permission('event.publish') then
    -- Publishing (or rejecting / archiving) settles any editor change waiting for review.
    if new.status is distinct from old.status then
      new.review_requested_at := null;
      new.review_requested_by := null;
    end if;
    return new;
  end if;
  if not public.has_permission('event.edit.any') then return new; end if;
  if (new.title, new.description, new.category_id, new.severity, new.latitude, new.longitude, new.location_name,
      new.country, new.region, new.city, new.locations, new.location_precision, new.source_name, new.source_url,
      new.occurred_at, new.is_breaking, new.is_verified, new.original_report_text)
     is not distinct from
     (old.title, old.description, old.category_id, old.severity, old.latitude, old.longitude, old.location_name,
      old.country, old.region, old.city, old.locations, old.location_precision, old.source_name, old.source_url,
      old.occurred_at, old.is_breaking, old.is_verified, old.original_report_text) then
    return new;
  end if;
  if old.status in ('draft', 'rejected') and new.status = old.status then
    new.status := 'pending_review';
  end if;
  new.review_requested_at := now();
  new.review_requested_by := auth.uid();
  return new;
end;
$$;
drop trigger if exists events_aa_editor_review on public.events;
create trigger events_aa_editor_review before update on public.events
  for each row execute function public.events_editor_review();
revoke execute on function public.events_editor_review() from public, anon, authenticated;

-- An admin approves an editor's change on a live event (clears the flag).
create or replace function public.approve_event_review(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.has_permission('event.review') then
    raise exception 'You do not have permission to approve changes.' using errcode = '42501';
  end if;
  update public.events set review_requested_at = null, review_requested_by = null where id = p_id;
end;
$$;
revoke execute on function public.approve_event_review(uuid) from public, anon;
grant execute on function public.approve_event_review(uuid) to authenticated;

-- AI usage: super admin only.
drop policy if exists "ai usage: staff read" on public.ai_usage;
create policy "ai usage: staff read" on public.ai_usage for select to authenticated
  using ((select public.has_permission('ai.usage.view')));

-- Map "duplicate": keep the pin and add another one at the new position (same place name,
-- or the given one). p_from = index in events.locations of the pin copied (null = main pin).
create or replace function public.add_event_place(p_id uuid, p_lat double precision, p_lng double precision, p_from integer default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_ev record; v_src jsonb; v_locs jsonb;
begin
  if auth.uid() is null or not (public.has_permission('event.edit.any') or public.has_permission('event.edit.own')) then
    raise exception 'You do not have permission to edit events.' using errcode = '42501';
  end if;
  if p_lat is null or p_lng is null or p_lat not between -90 and 90 or p_lng not between -180 and 180 then
    raise exception 'Bad coordinates.' using errcode = '22023';
  end if;
  select locations, location_name, location_name_en into v_ev from public.events where id = p_id and deleted_at is null;
  if not found then raise exception 'Event not found.' using errcode = 'P0002'; end if;
  v_locs := case when jsonb_typeof(v_ev.locations) = 'array' then v_ev.locations else '[]'::jsonb end;
  v_src := case when p_from is not null and p_from >= 0 and p_from < jsonb_array_length(v_locs) then v_locs -> p_from
                else jsonb_build_object('name', coalesce(v_ev.location_name, ''), 'name_en', coalesce(v_ev.location_name_en, '')) end;
  update public.events
     set locations = v_locs || jsonb_build_array(jsonb_build_object(
           'name', coalesce(v_src ->> 'name', ''), 'name_en', coalesce(v_src ->> 'name_en', ''),
           'lat', p_lat, 'lng', p_lng, 'precision', 'exact', 'manual', true))
   where id = p_id;
end;
$$;
revoke execute on function public.add_event_place(uuid, double precision, double precision, integer) from public, anon;
grant execute on function public.add_event_place(uuid, double precision, double precision, integer) to authenticated;

-- Moving the main pin also moves the copy of it in events.locations (the first listed
-- place usually sits on the main pin) — so the old position does not stay on the map.
create or replace function public.move_event_pin(p_id uuid, p_lat double precision, p_lng double precision, p_location_name text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_old record; v_locs jsonb;
begin
  if auth.uid() is null or not (public.has_permission('event.edit.any') or public.has_permission('event.edit.own')) then
    raise exception 'You do not have permission to move events.' using errcode = '42501';
  end if;
  if p_lat is null or p_lng is null or p_lat not between -90 and 90 or p_lng not between -180 and 180 then
    raise exception 'Bad coordinates.' using errcode = '22023';
  end if;
  select latitude, longitude, locations into v_old from public.events where id = p_id and deleted_at is null;
  if not found then raise exception 'Event not found.' using errcode = 'P0002'; end if;
  v_locs := v_old.locations;
  if jsonb_typeof(v_locs) = 'array' and v_old.latitude is not null then
    select coalesce(jsonb_agg(case
             when jsonb_typeof(x -> 'lat') in ('number', 'string') and jsonb_typeof(x -> 'lng') in ('number', 'string')
                  and abs((x ->> 'lat')::float8 - v_old.latitude) < 0.003 and abs((x ->> 'lng')::float8 - v_old.longitude) < 0.003
             then x || jsonb_build_object('lat', p_lat, 'lng', p_lng, 'precision', 'exact', 'manual', true)
             else x end order by o), '[]'::jsonb)
      into v_locs
      from jsonb_array_elements(v_old.locations) with ordinality as e(x, o);
  end if;
  update public.events
     set latitude = p_lat, longitude = p_lng, location_precision = 'exact', geocoding_confidence = 1,
         location_name = coalesce(nullif(btrim(p_location_name), ''), location_name),
         locations = v_locs
   where id = p_id;
end;
$$;
