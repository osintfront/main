-- ════════════════════════════════════════════════════════════════════
-- Osintfront · Migration 1 — schema, permission model, workflow guards
-- Target: Supabase (PostgreSQL 15+). Run before 0002 and 0003.
-- ════════════════════════════════════════════════════════════════════

-- ─── Enumerations ──────────────────────────────────────────────────
create type public.app_role as enum ('super_admin', 'admin', 'editor', 'viewer');
create type public.user_status as enum ('active', 'pending', 'suspended');
create type public.event_status as enum ('draft', 'pending_review', 'published', 'rejected', 'archived');
create type public.event_severity as enum ('low', 'medium', 'high', 'critical');
create type public.event_source_type as enum (
  'manual_report', 'news_website', 'social_media', 'official_statement',
  'emergency_service', 'government_source', 'military_source', 'other'
);
create type public.invitation_status as enum ('pending', 'accepted', 'expired', 'revoked');

-- ─── Tables ────────────────────────────────────────────────────────

create table public.profiles (
  id             uuid primary key references auth.users (id) on delete cascade,
  full_name      text not null default '' check (char_length(full_name) <= 120),
  email          text not null check (char_length(email) <= 254),
  role           public.app_role not null default 'viewer',
  status         public.user_status not null default 'pending',
  -- Explicit publishing grant for editors ("unless granted explicit publishing permission").
  can_publish    boolean not null default false,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  last_login_at  timestamptz,
  invited_by     uuid references public.profiles (id) on delete set null
);
create unique index profiles_email_lower_key on public.profiles (lower(email));
create index profiles_role_status_idx on public.profiles (role, status);

create table public.event_categories (
  id            uuid primary key default gen_random_uuid(),
  name          text not null check (char_length(name) between 1 and 80),
  slug          text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  description   text not null default '' check (char_length(description) <= 500),
  icon          text not null default 'CircleDot' check (icon ~ '^[A-Za-z0-9]{1,40}$'),
  color         text not null check (color ~ '^#[0-9a-fA-F]{6}$'),
  marker_color  text not null check (marker_color ~ '^#[0-9a-fA-F]{6}$'),
  is_active     boolean not null default true,
  sort_order    integer not null default 100,
  -- Optional display-name overrides per language; canonical slug stays English.
  translations  jsonb not null default '{}'::jsonb check (jsonb_typeof(translations) = 'object'),
  created_at    timestamptz not null default now()
);

create table public.events (
  id                              uuid primary key default gen_random_uuid(),
  title                           text not null default '' check (char_length(title) <= 200),
  description                     text not null default '' check (char_length(description) <= 5000),
  original_report_text            text not null default '' check (char_length(original_report_text) <= 10000),
  category_id                     uuid references public.event_categories (id) on delete restrict,
  -- What the classifier proposed, kept separately from the final choice.
  suggested_category_id           uuid references public.event_categories (id) on delete set null,
  status                          public.event_status not null default 'draft',
  severity                        public.event_severity not null default 'medium',
  latitude                        numeric(9, 6) check (latitude between -90 and 90),
  longitude                       numeric(9, 6) check (longitude between -180 and 180),
  location_name                   text not null default '' check (char_length(location_name) <= 200),
  country                         text not null default '' check (char_length(country) <= 100),
  region                          text not null default '' check (char_length(region) <= 100),
  city                            text not null default '' check (char_length(city) <= 100),
  address                         text check (char_length(address) <= 300),
  source_name                     text check (char_length(source_name) <= 200),
  source_url                      text check (source_url is null or (char_length(source_url) <= 2048 and source_url ~* '^https?://[^\s<>"''`]+$')),
  source_type                     public.event_source_type not null default 'manual_report',
  occurred_at                     timestamptz not null,
  published_at                    timestamptz,
  created_at                      timestamptz not null default now(),
  updated_at                      timestamptz not null default now(),
  created_by                      uuid not null references public.profiles (id) on delete restrict,
  approved_by                     uuid references public.profiles (id) on delete set null,
  is_breaking                     boolean not null default false,
  is_verified                     boolean not null default false,
  geocoding_confidence            numeric(4, 3) check (geocoding_confidence between 0 and 1),
  classification_confidence       numeric(4, 3) check (classification_confidence between 0 and 1),
  coordinates_manually_corrected  boolean not null default false,
  -- Raw suggestions from extraction / geocoding / classification (staff-only).
  ai_suggestions                  jsonb not null default '{}'::jsonb check (jsonb_typeof(ai_suggestions) = 'object'),
  rejection_reason                text check (char_length(rejection_reason) <= 1000),
  duplicate_of_event_id           uuid references public.events (id) on delete set null,
  -- Prepared for future translated titles/summaries: {"he": {"title": "...", "description": "..."}}
  translations                    jsonb not null default '{}'::jsonb check (jsonb_typeof(translations) = 'object'),
  -- Soft deletion (default delete behaviour).
  deleted_at                      timestamptz,

  constraint events_publish_requirements check (
    status <> 'published' or (
      latitude is not null and longitude is not null
      and category_id is not null
      and char_length(btrim(title)) > 0
    )
  ),
  constraint events_rejection_reason_required check (
    status <> 'rejected' or char_length(btrim(coalesce(rejection_reason, ''))) > 0
  ),
  constraint events_not_own_duplicate check (duplicate_of_event_id is null or duplicate_of_event_id <> id),
  constraint events_occurred_at_sane check (occurred_at > timestamptz '1990-01-01' and occurred_at < now() + interval '1 day')
);
create index events_public_feed_idx on public.events (occurred_at desc) where status = 'published' and deleted_at is null;
create index events_status_idx on public.events (status, updated_at desc);
create index events_category_idx on public.events (category_id);
create index events_created_by_idx on public.events (created_by);
create index events_location_idx on public.events (latitude, longitude) where latitude is not null;
create index events_source_url_idx on public.events (source_url) where source_url is not null;

-- Internal notes live in their own table so no public query can ever reach them.
create table public.event_internal_notes (
  event_id    uuid primary key references public.events (id) on delete cascade,
  notes       text not null default '' check (char_length(notes) <= 5000),
  updated_by  uuid references public.profiles (id) on delete set null,
  updated_at  timestamptz not null default now()
);

create table public.event_history (
  id               uuid primary key default gen_random_uuid(),
  event_id         uuid not null references public.events (id) on delete cascade,
  action           text not null,
  previous_values  jsonb not null default '{}'::jsonb,
  new_values       jsonb not null default '{}'::jsonb,
  changed_by       uuid references public.profiles (id) on delete set null,
  created_at       timestamptz not null default now()
);
create index event_history_event_idx on public.event_history (event_id, created_at desc);

create table public.audit_logs (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid references public.profiles (id) on delete set null,
  action       text not null,
  entity_type  text not null,
  entity_id    uuid,
  metadata     jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now(),
  ip_address   text
);
create index audit_logs_created_idx on public.audit_logs (created_at desc);
create index audit_logs_entity_idx on public.audit_logs (entity_type, entity_id);
create index audit_logs_user_idx on public.audit_logs (user_id, created_at desc);

create table public.administrator_invitations (
  id             uuid primary key default gen_random_uuid(),
  email          text not null check (char_length(email) <= 254 and email ~ '^[^\s@]+@[^\s@]+\.[^\s@]+$'),
  full_name      text not null default '' check (char_length(full_name) <= 120),
  intended_role  public.app_role not null,
  message        text check (char_length(message) <= 1000),
  invited_by     uuid references public.profiles (id) on delete set null,
  token          text not null,
  status         public.invitation_status not null default 'pending',
  expires_at     timestamptz not null default (now() + interval '7 days'),
  created_at     timestamptz not null default now(),
  accepted_at    timestamptz
);
create unique index invitations_one_pending_per_email on public.administrator_invitations (lower(email)) where status = 'pending';
create unique index invitations_token_key on public.administrator_invitations (token);

-- ─── Permission model ──────────────────────────────────────────────
-- Mirror of src/lib/permissions.ts. This copy is authoritative.

create or replace function public.role_permissions(p_role public.app_role)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select case p_role
    when 'super_admin' then array[
      'dashboard.view', 'event.view.operational', 'event.view.internal',
      'event.create', 'event.edit.own', 'event.edit.any', 'event.review', 'event.publish',
      'event.archive', 'event.delete', 'category.manage',
      'user.invite', 'user.manage', 'user.manage.admins', 'role.manage',
      'audit.view', 'settings.manage']
    when 'admin' then array[
      'dashboard.view', 'event.view.operational', 'event.view.internal',
      'event.create', 'event.edit.own', 'event.edit.any', 'event.review', 'event.publish',
      'event.archive', 'event.delete', 'category.manage',
      'user.invite', 'user.manage', 'audit.view']
    when 'editor' then array['dashboard.view', 'event.create', 'event.edit.own']
    when 'viewer' then array['dashboard.view', 'event.view.operational']
    else array[]::text[]
  end;
$$;

-- True when the calling user has an ACTIVE profile granting the permission.
-- SECURITY DEFINER so RLS policies can consult profiles without recursion.
create or replace function public.has_permission(p_permission text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles pr
    where pr.id = auth.uid()
      and pr.status = 'active'
      and (
        p_permission = any (public.role_permissions(pr.role))
        or (p_permission = 'event.publish' and pr.can_publish and pr.role = 'editor')
      )
  );
$$;

-- Permissions of the current user, for the UI to display (never trusted for access).
create or replace function public.my_permissions()
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select public.role_permissions(pr.role)
           || case when pr.can_publish and pr.role = 'editor' then array['event.publish'] else array[]::text[] end
    from public.profiles pr
    where pr.id = auth.uid() and pr.status = 'active'
  ), array[]::text[]);
$$;

-- ─── Utilities ─────────────────────────────────────────────────────

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- Client IP as forwarded by the Supabase API gateway (null outside API requests).
create or replace function public.request_ip()
returns text
language sql
stable
set search_path = ''
as $$
  select nullif(btrim(split_part(
    coalesce(nullif(current_setting('request.headers', true), '')::json ->> 'x-forwarded-for', ''),
    ',', 1)), '');
$$;

-- Internal audit writer. Not callable by API roles; used by triggers and RPCs.
create or replace function public.write_audit(
  p_action text, p_entity_type text, p_entity_id uuid, p_metadata jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
begin
  insert into public.audit_logs (user_id, action, entity_type, entity_id, metadata, ip_address)
  values (
    case when exists (select 1 from public.profiles where id = v_actor) then v_actor else null end,
    p_action, p_entity_type, p_entity_id, coalesce(p_metadata, '{}'::jsonb), public.request_ip()
  );
end;
$$;

create or replace function public.generate_invite_token()
returns text
language sql
volatile
set search_path = ''
as $$
  -- 2 × UUIDv4 ≈ 244 bits of randomness, hex encoded.
  select replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
$$;

-- ─── Event workflow ────────────────────────────────────────────────

create or replace function public.is_valid_event_transition(p_from public.event_status, p_to public.event_status)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_from = p_to or (p_from, p_to) in (
    ('draft'::public.event_status,          'pending_review'::public.event_status),
    ('draft',          'published'),
    ('draft',          'archived'),
    ('pending_review', 'draft'),
    ('pending_review', 'published'),
    ('pending_review', 'rejected'),
    ('pending_review', 'archived'),
    ('rejected',       'draft'),
    ('rejected',       'pending_review'),
    ('rejected',       'archived'),
    ('published',      'archived'),
    ('archived',       'draft'),
    ('archived',       'published')
  );
$$;

-- BEFORE INSERT: server decides ownership, timestamps and publication metadata.
create or replace function public.events_before_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
begin
  if v_actor is not null then
    -- Ownership can never be chosen by the client.
    new.created_by  := v_actor;
    new.created_at  := now();
    new.approved_by := null;
    new.deleted_at  := null;
    if new.status not in ('draft', 'pending_review', 'published') then
      raise exception 'New events must start as draft, pending review or published (got %).', new.status
        using errcode = '22023';
    end if;
    if new.status = 'published' and not public.has_permission('event.publish') then
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

-- BEFORE UPDATE: immutable ownership, valid transitions, per-transition permissions.
create or replace function public.events_before_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
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
      if new.status = 'published' and not public.has_permission('event.publish') then
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

    -- Publication metadata is server-controlled.
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

-- AFTER INSERT/UPDATE/DELETE: event history + audit trail (cannot be skipped by clients).
create or replace function public.events_after_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor    uuid := auth.uid();
  v_prev     jsonb;
  v_next     jsonb;
  v_action   text;
  v_changed  text[];
begin
  if tg_op = 'INSERT' then
    insert into public.event_history (event_id, action, previous_values, new_values, changed_by)
    values (new.id, 'created', '{}'::jsonb, to_jsonb(new), (select id from public.profiles where id = v_actor));
    perform public.write_audit('event.created', 'event', new.id,
      jsonb_build_object('title', new.title, 'status', new.status));
    if new.status = 'published' then
      perform public.write_audit('event.published', 'event', new.id, jsonb_build_object('title', new.title));
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    perform public.write_audit('event.deleted_permanently', 'event', old.id,
      jsonb_build_object('title', old.title, 'status', old.status, 'snapshot', to_jsonb(old)));
    return old;
  end if;

  -- UPDATE: record only the fields that changed.
  select coalesce(jsonb_object_agg(o.key, o.value), '{}'::jsonb),
         coalesce(jsonb_object_agg(n.key, n.value), '{}'::jsonb),
         coalesce(array_agg(n.key order by n.key), array[]::text[])
    into v_prev, v_next, v_changed
  from jsonb_each(to_jsonb(new)) n
  join jsonb_each(to_jsonb(old)) o using (key)
  where n.value is distinct from o.value
    and n.key not in ('updated_at');

  if v_changed = array[]::text[] then
    return new;
  end if;

  v_action := case
    when new.deleted_at is not null and old.deleted_at is null then 'deleted'
    when new.deleted_at is null and old.deleted_at is not null then 'restored'
    when new.status <> old.status then case new.status
      when 'published'      then case when old.status = 'pending_review' then 'approved_and_published' else 'published' end
      when 'pending_review' then 'submitted_for_review'
      when 'rejected'       then 'rejected'
      when 'archived'       then 'archived'
      when 'draft'          then 'returned_to_draft'
    end
    when new.coordinates_manually_corrected and not old.coordinates_manually_corrected then 'coordinates_corrected'
    else 'edited'
  end;

  insert into public.event_history (event_id, action, previous_values, new_values, changed_by)
  values (new.id, v_action, v_prev, v_next, (select id from public.profiles where id = v_actor));

  perform public.write_audit('event.' || v_action, 'event', new.id,
    jsonb_build_object('title', new.title, 'from_status', old.status, 'to_status', new.status,
                       'changed_fields', to_jsonb(v_changed))
    || case when new.status = 'rejected' and old.status <> 'rejected'
            then jsonb_build_object('rejection_reason', new.rejection_reason) else '{}'::jsonb end);
  return new;
end;
$$;

create trigger events_before_insert before insert on public.events
  for each row execute function public.events_before_insert();
create trigger events_before_update before update on public.events
  for each row execute function public.events_before_update();
create trigger events_after_change after insert or update or delete on public.events
  for each row execute function public.events_after_change();

create trigger event_internal_notes_touch before insert or update on public.event_internal_notes
  for each row execute function public.set_updated_at();

create or replace function public.event_internal_notes_stamp()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if auth.uid() is not null then
    new.updated_by := auth.uid();
  end if;
  return new;
end;
$$;
create trigger event_internal_notes_stamp before insert or update on public.event_internal_notes
  for each row execute function public.event_internal_notes_stamp();

-- ─── Profiles: guards and audit ────────────────────────────────────

create or replace function public.profiles_before_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_other_active_supers integer;
begin
  new.updated_at := now();

  -- No user context: SQL editor, migrations, service role, auth.users hooks.
  if v_actor is null then
    return new;
  end if;

  if new.id <> old.id or lower(new.email) <> lower(old.email) or new.created_at <> old.created_at
     or new.invited_by is distinct from old.invited_by then
    raise exception 'Identity fields of a profile cannot be edited.' using errcode = '42501';
  end if;

  -- last_login_at can only be stamped by its owner with the current time (record_login).
  if new.last_login_at is distinct from old.last_login_at
     and (v_actor <> old.id or new.last_login_at is distinct from now()) then
    raise exception 'last_login_at is maintained by the server.' using errcode = '42501';
  end if;

  if v_actor = old.id then
    if new.role <> old.role or new.can_publish <> old.can_publish then
      raise exception 'You cannot change your own role, status or publishing permission.' using errcode = '42501';
    end if;
    if new.status <> old.status and not (
      old.status = 'pending' and new.status = 'active'
      and exists (select 1 from auth.users u where u.id = old.id and u.email_confirmed_at is not null)
    ) then
      raise exception 'You cannot change your own role, status or publishing permission.' using errcode = '42501';
    end if;
    return new;
  end if;

  if not public.has_permission('user.manage') then
    raise exception 'You do not have permission to manage users.' using errcode = '42501';
  end if;

  if (old.role in ('super_admin', 'admin') or new.role in ('super_admin', 'admin'))
     and not public.has_permission('user.manage.admins') then
    raise exception 'Only a super admin can manage administrator accounts.' using errcode = '42501';
  end if;

  if new.role = 'super_admin' and old.role <> 'super_admin' and not public.has_permission('role.manage') then
    raise exception 'Only a super admin can create another super admin.' using errcode = '42501';
  end if;

  if old.role = 'super_admin' and old.status = 'active'
     and (new.role <> 'super_admin' or new.status <> 'active') then
    perform pg_advisory_xact_lock(hashtext('osintfront.super_admins'));
    select count(*) into v_other_active_supers
    from public.profiles
    where role = 'super_admin' and status = 'active' and id <> old.id;
    if v_other_active_supers = 0 then
      raise exception 'The last active super admin cannot be demoted or suspended.' using errcode = '42501';
    end if;
  end if;

  return new;
end;
$$;

create or replace function public.profiles_before_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_other_active_supers integer;
begin
  if old.role = 'super_admin' and old.status = 'active' then
    perform pg_advisory_xact_lock(hashtext('osintfront.super_admins'));
    select count(*) into v_other_active_supers
    from public.profiles where role = 'super_admin' and status = 'active' and id <> old.id;
    if v_other_active_supers = 0 then
      raise exception 'The last active super admin cannot be removed.' using errcode = '42501';
    end if;
  end if;

  if v_actor is null then
    return old;
  end if;
  if v_actor = old.id then
    raise exception 'You cannot remove your own account.' using errcode = '42501';
  end if;
  if not public.has_permission('user.manage') then
    raise exception 'You do not have permission to remove users.' using errcode = '42501';
  end if;
  if old.role in ('super_admin', 'admin') and not public.has_permission('user.manage.admins') then
    raise exception 'Only a super admin can remove administrator accounts.' using errcode = '42501';
  end if;
  return old;
end;
$$;

create or replace function public.profiles_after_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    perform public.write_audit('user.removed', 'user', old.id,
      jsonb_build_object('email', old.email, 'role', old.role));
    return old;
  end if;

  if new.role <> old.role then
    perform public.write_audit('user.role_changed', 'user', new.id,
      jsonb_build_object('email', new.email, 'from', old.role, 'to', new.role));
  end if;
  if new.status <> old.status then
    perform public.write_audit(
      case new.status when 'suspended' then 'user.suspended'
                      when 'active' then case when old.status = 'suspended' then 'user.reactivated' else 'user.activated' end
                      else 'user.status_changed' end,
      'user', new.id, jsonb_build_object('email', new.email, 'from', old.status, 'to', new.status));
  end if;
  if new.can_publish <> old.can_publish then
    perform public.write_audit('user.publish_permission_changed', 'user', new.id,
      jsonb_build_object('email', new.email, 'can_publish', new.can_publish));
  end if;
  return new;
end;
$$;

create trigger profiles_before_update before update on public.profiles
  for each row execute function public.profiles_before_update();
create trigger profiles_before_delete before delete on public.profiles
  for each row execute function public.profiles_before_delete();
create trigger profiles_after_update after update on public.profiles
  for each row execute function public.profiles_after_change();
create trigger profiles_after_delete after delete on public.profiles
  for each row execute function public.profiles_after_change();

-- ─── Invitations ───────────────────────────────────────────────────

create or replace function public.invitations_before_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
begin
  new.email := lower(btrim(new.email));

  if v_actor is not null then
    if not public.has_permission('user.invite') then
      raise exception 'You do not have permission to invite users.' using errcode = '42501';
    end if;
    if new.intended_role = 'super_admin' and not public.has_permission('role.manage') then
      raise exception 'Only a super admin can invite another super admin.' using errcode = '42501';
    end if;
    if new.intended_role = 'admin' and not public.has_permission('user.manage.admins') then
      raise exception 'Only a super admin can invite administrators.' using errcode = '42501';
    end if;
    new.invited_by  := v_actor;
    new.status      := 'pending';
    new.created_at  := now();
    new.accepted_at := null;
    new.expires_at  := least(coalesce(new.expires_at, now() + interval '7 days'), now() + interval '14 days');
  end if;

  -- Server-generated token, always.
  new.token := public.generate_invite_token();

  if exists (select 1 from public.profiles where lower(email) = new.email) then
    raise exception 'A user with the email % is already registered.', new.email using errcode = '23505';
  end if;

  -- Expire stale pending invitations, then reject a live duplicate.
  update public.administrator_invitations
     set status = 'expired'
   where lower(email) = new.email and status = 'pending' and expires_at <= now();
  if exists (select 1 from public.administrator_invitations where lower(email) = new.email and status = 'pending') then
    raise exception 'A pending invitation already exists for %.', new.email using errcode = '23505';
  end if;

  return new;
end;
$$;

create or replace function public.invitations_before_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
begin
  if v_actor is null then
    return new;
  end if;
  if new.email <> old.email or new.intended_role <> old.intended_role or new.invited_by is distinct from old.invited_by
     or new.token <> old.token or new.created_at <> old.created_at or new.full_name <> old.full_name then
    raise exception 'Invitation details cannot be edited. Revoke it and send a new one.' using errcode = '42501';
  end if;
  if new.status <> old.status and not (old.status = 'pending' and new.status = 'revoked') then
    raise exception 'Only pending invitations can be revoked.' using errcode = '22023';
  end if;
  if old.intended_role in ('super_admin', 'admin') and not public.has_permission('user.manage.admins') then
    raise exception 'Only a super admin can manage administrator invitations.' using errcode = '42501';
  end if;
  new.accepted_at := old.accepted_at;
  return new;
end;
$$;

create or replace function public.invitations_after_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform public.write_audit('user.invited', 'invitation', new.id,
      jsonb_build_object('email', new.email, 'role', new.intended_role));
  elsif new.status <> old.status and new.status = 'revoked' then
    perform public.write_audit('user.invitation_revoked', 'invitation', new.id,
      jsonb_build_object('email', new.email, 'role', new.intended_role));
  end if;
  return new;
end;
$$;

create trigger invitations_before_insert before insert on public.administrator_invitations
  for each row execute function public.invitations_before_insert();
create trigger invitations_before_update before update on public.administrator_invitations
  for each row execute function public.invitations_before_update();
create trigger invitations_after_change after insert or update on public.administrator_invitations
  for each row execute function public.invitations_after_change();

-- ─── auth.users hooks: invitation-only profiles ────────────────────
-- A profile (and therefore any staff access) exists ONLY when a pending,
-- unexpired invitation matches the new user's email. Anyone who signs up
-- without one gets an auth account with zero permissions.

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inv public.administrator_invitations%rowtype;
begin
  select * into v_inv
  from public.administrator_invitations
  where lower(email) = lower(new.email) and status = 'pending' and expires_at > now()
  order by created_at desc
  limit 1
  for update;

  if not found then
    return new;
  end if;

  insert into public.profiles (id, full_name, email, role, status, invited_by)
  values (
    new.id,
    coalesce(nullif(v_inv.full_name, ''), new.raw_user_meta_data ->> 'full_name', ''),
    lower(new.email),
    v_inv.intended_role,
    case when new.email_confirmed_at is not null then 'active'::public.user_status else 'pending'::public.user_status end,
    v_inv.invited_by
  );

  update public.administrator_invitations
     set status = 'accepted', accepted_at = now()
   where id = v_inv.id;

  perform public.write_audit('user.invitation_accepted', 'user', new.id,
    jsonb_build_object('invitation_id', v_inv.id, 'role', v_inv.intended_role, 'email', lower(new.email)));
  return new;
end;
$$;

create or replace function public.handle_auth_user_updated()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.email_confirmed_at is not null and old.email_confirmed_at is null then
    update public.profiles set status = 'active' where id = new.id and status = 'pending';
  end if;
  if lower(new.email) is distinct from lower(old.email) then
    update public.profiles set email = lower(new.email) where id = new.id;
  end if;
  return new;
end;
$$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_auth_user();
create trigger on_auth_user_updated after update of email, email_confirmed_at on auth.users
  for each row execute function public.handle_auth_user_updated();

-- ─── RPCs callable by signed-in users ──────────────────────────────

-- Called by the app after a successful password sign-in.
create or replace function public.record_login()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_rows  integer;
begin
  if v_actor is null then
    raise exception 'Not signed in.' using errcode = '42501';
  end if;
  -- The profiles guard allows exactly this self-update: last_login_at = now(),
  -- and pending → active only once the email address is confirmed.
  update public.profiles
     set last_login_at = now(),
         status = case
           when status = 'pending'
                and exists (select 1 from auth.users u where u.id = v_actor and u.email_confirmed_at is not null)
           then 'active'::public.user_status
           else status
         end
   where id = v_actor and status <> 'suspended';
  get diagnostics v_rows = row_count;
  if v_rows > 0 then
    perform public.write_audit('user.login', 'user', v_actor, '{}'::jsonb);
  end if;
end;
$$;
