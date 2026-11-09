-- ════════════════════════════════════════════════════════════════════
-- Osintfront · Migration 42 — editors publish drafts
-- New permission event.publish.draft (editors): publish a report that is still a draft
-- or waiting for review (including a new report). Changes to an event that is already
-- live still go to an admin for review (events_editor_review). Mirrors src/lib/permissions.ts.
-- ════════════════════════════════════════════════════════════════════
create or replace function public.role_permissions(p_role public.app_role)
returns text[] language sql immutable set search_path = '' as $$
  select case p_role
    when 'super_admin' then array[
      'admin.access', 'dashboard.view', 'event.view.operational', 'event.view.internal',
      'event.create', 'event.edit.own', 'event.edit.any', 'event.review', 'event.publish', 'event.publish.draft',
      'event.archive', 'event.delete', 'category.manage',
      'user.invite', 'user.manage', 'user.manage.admins', 'role.manage',
      'audit.view', 'settings.manage', 'ai.usage.view']
    when 'admin' then array[
      'admin.access', 'dashboard.view', 'event.view.operational', 'event.view.internal',
      'event.create', 'event.edit.own', 'event.edit.any', 'event.review', 'event.publish', 'event.publish.draft',
      'event.archive', 'event.delete', 'category.manage',
      'user.invite', 'user.manage', 'audit.view']
    when 'editor' then array['admin.access', 'event.view.operational', 'event.view.internal',
      'event.create', 'event.edit.own', 'event.edit.any', 'event.publish.draft']
    when 'viewer' then array[]::text[]
    else array[]::text[]
  end;
$$;

-- May the current user publish an event that is now in this status?
create or replace function public.can_publish_from(p_status public.event_status)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.has_permission('event.publish')
      or (p_status in ('draft', 'pending_review') and public.has_permission('event.publish.draft'));
$$;
revoke execute on function public.can_publish_from(public.event_status) from public, anon;
grant execute on function public.can_publish_from(public.event_status) to authenticated;

create or replace function public.events_before_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid();
begin
  if v_actor is not null then
    new.created_by  := v_actor;
    new.created_at  := now();
    new.approved_by := null;
    new.deleted_at  := null;
    if new.status not in ('draft', 'pending_review', 'published') then
      raise exception 'New events must start as draft, pending review or published (got %).', new.status
        using errcode = '22023';
    end if;
    if new.status = 'published' and not public.can_publish_from('draft') then
      raise exception 'You do not have permission to publish events.' using errcode = '42501';
    end if;
  end if;
  new.updated_at := now();
  if new.status = 'published' then
    new.published_at := case when v_actor is null then coalesce(new.published_at, now()) else now() end;
    new.approved_by  := coalesce(new.approved_by, v_actor);
  elsif v_actor is not null then
    new.published_at := null;
  end if;
  return new;
end;
$$;

create or replace function public.events_before_update()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid();
begin
  new.updated_at := now();
  if v_actor is not null then
    if new.created_by is distinct from old.created_by then
      raise exception 'Event ownership cannot be changed.' using errcode = '42501';
    end if;
    new.created_at := old.created_at;
    if new.status <> old.status then
      if not public.is_valid_event_transition(old.status, new.status) then
        raise exception 'An event cannot move from % to %.', old.status, new.status using errcode = '22023';
      end if;
      if new.status = 'published' and not public.can_publish_from(old.status) then
        raise exception 'You do not have permission to publish events.' using errcode = '42501';
      end if;
      if new.status = 'rejected' and not public.has_permission('event.review') then
        raise exception 'You do not have permission to reject events.' using errcode = '42501';
      end if;
      if new.status = 'archived' and not public.has_permission('event.archive') then
        raise exception 'You do not have permission to archive events.' using errcode = '42501';
      end if;
    end if;
    if new.deleted_at is distinct from old.deleted_at and not public.has_permission('event.delete') then
      raise exception 'You do not have permission to delete or restore events.' using errcode = '42501';
    end if;
    if new.status = 'published' and old.status <> 'published' then
      new.published_at := now();
      new.approved_by  := v_actor;
    else
      new.published_at := old.published_at;
      new.approved_by  := old.approved_by;
    end if;
  elsif new.status = 'published' and old.status <> 'published' then
    new.published_at := coalesce(new.published_at, now());
  end if;
  return new;
end;
$$;

-- Editor review: publishing a draft is the editor's own decision (no review flag);
-- a change to a live event still waits for an admin.
create or replace function public.events_editor_review()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then return new; end if;
  if public.has_permission('event.publish')
     or (new.status = 'published' and old.status in ('draft', 'pending_review') and public.has_permission('event.publish.draft')) then
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

-- Insert: a new report may start published with either permission.
alter policy "events: reporters create" on public.events with check (
  (select public.has_permission('event.create')) AND (created_by = (select auth.uid()))
  AND ((status = ANY (ARRAY['draft'::public.event_status, 'pending_review'::public.event_status]))
       OR ((status = 'published'::public.event_status) AND (select public.can_publish_from('draft'))))
);
