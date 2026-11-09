-- ════════════════════════════════════════════════════════════════════
-- Osintfront · Migration 2 — privileges, Row Level Security, public view
--
-- Defence in depth for unpublished data:
--   1. anon has NO table privileges except listed public columns,
--   2. RLS restricts anon to published, non-deleted rows,
--   3. the public site reads only the `published_events` view,
--      which filters again and exposes no internal columns.
-- Helper calls are wrapped as (select fn()) so Postgres evaluates them
-- once per statement instead of once per row.
-- ════════════════════════════════════════════════════════════════════

-- ─── Privileges ────────────────────────────────────────────────────
revoke all on all tables in schema public from anon;
revoke truncate, references, trigger on all tables in schema public from authenticated;

-- Public read surface
grant select on public.event_categories to anon;
grant select (
  id, title, description, category_id, status, severity, latitude, longitude,
  location_name, country, region, city, source_name, source_url, source_type,
  occurred_at, published_at, updated_at, is_breaking, is_verified, translations, deleted_at
) on public.events to anon;

-- Logs are written only by SECURITY DEFINER triggers/functions.
revoke insert, update, delete on public.audit_logs from authenticated;
revoke insert, update, delete on public.event_history from authenticated;

-- Invitation tokens are never readable through the API.
revoke select on public.administrator_invitations from authenticated;
grant select (id, email, full_name, intended_role, message, invited_by, status, expires_at, created_at, accepted_at)
  on public.administrator_invitations to authenticated;
revoke delete on public.administrator_invitations from authenticated;

-- Functions: internal helpers are not part of the API.
revoke execute on function public.write_audit(text, text, uuid, jsonb) from public, anon, authenticated;
revoke execute on function public.generate_invite_token() from public, anon, authenticated;
revoke execute on function public.record_login() from public, anon;
grant execute on function public.record_login() to authenticated;
revoke execute on function public.my_permissions() from public, anon;
grant execute on function public.my_permissions() to authenticated;
-- has_permission is used inside policies evaluated for authenticated users.
revoke execute on function public.has_permission(text) from public, anon;
grant execute on function public.has_permission(text) to authenticated;

-- ─── Enable RLS everywhere ─────────────────────────────────────────
alter table public.profiles                   enable row level security;
alter table public.event_categories           enable row level security;
alter table public.events                     enable row level security;
alter table public.event_internal_notes       enable row level security;
alter table public.event_history              enable row level security;
alter table public.audit_logs                 enable row level security;
alter table public.administrator_invitations  enable row level security;

-- ─── profiles ──────────────────────────────────────────────────────
-- Public users: no access (no anon privileges, no anon policy).
create policy "profiles: read own or managed"
  on public.profiles for select to authenticated
  using (
    id = (select auth.uid())
    or (select public.has_permission('user.manage'))
    or (select public.has_permission('user.invite'))
  );

-- Self: only full_name (enforced by profiles_before_update).
-- Managers: role/status rules enforced by the same trigger.
create policy "profiles: update own or managed"
  on public.profiles for update to authenticated
  using (id = (select auth.uid()) or (select public.has_permission('user.manage')))
  with check (id = (select auth.uid()) or (select public.has_permission('user.manage')));

create policy "profiles: remove managed users"
  on public.profiles for delete to authenticated
  using ((select public.has_permission('user.manage')) and id <> (select auth.uid()));

-- No INSERT policy: profiles are created only by the invitation trigger on auth.users.

-- ─── event_categories ──────────────────────────────────────────────
create policy "categories: public reads active"
  on public.event_categories for select to anon
  using (is_active);

create policy "categories: staff read"
  on public.event_categories for select to authenticated
  using (is_active or (select public.has_permission('category.manage')));

create policy "categories: managers insert"
  on public.event_categories for insert to authenticated
  with check ((select public.has_permission('category.manage')));

create policy "categories: managers update"
  on public.event_categories for update to authenticated
  using ((select public.has_permission('category.manage')))
  with check ((select public.has_permission('category.manage')));

create policy "categories: managers delete"
  on public.event_categories for delete to authenticated
  using ((select public.has_permission('category.manage')));

-- ─── events ────────────────────────────────────────────────────────
create policy "events: public reads published"
  on public.events for select to anon
  using (status = 'published' and deleted_at is null);

create policy "events: staff read"
  on public.events for select to authenticated
  using (
    (status = 'published' and deleted_at is null)
    or (select public.has_permission('event.view.internal'))
    or (deleted_at is null and created_by = (select auth.uid()) and (select public.has_permission('event.edit.own')))
    or (deleted_at is null and status <> 'draft' and (select public.has_permission('event.view.operational')))
  );

create policy "events: reporters create"
  on public.events for insert to authenticated
  with check (
    (select public.has_permission('event.create'))
    and created_by = (select auth.uid())
    and (
      status in ('draft', 'pending_review')
      or (status = 'published' and (select public.has_permission('event.publish')))
    )
  );

-- Editors: only their own drafts/rejected items, and only into draft/pending
-- (or published when they hold an explicit publishing grant).
-- Admins: any event. Per-transition rules live in events_before_update.
create policy "events: edit own drafts or any with permission"
  on public.events for update to authenticated
  using (
    (select public.has_permission('event.edit.any'))
    or (
      created_by = (select auth.uid())
      and (select public.has_permission('event.edit.own'))
      and status in ('draft', 'rejected')
      and deleted_at is null
    )
  )
  with check (
    (select public.has_permission('event.edit.any'))
    or (
      created_by = (select auth.uid())
      and (select public.has_permission('event.edit.own'))
      and deleted_at is null
      and (
        status in ('draft', 'pending_review')
        or (status = 'published' and (select public.has_permission('event.publish')))
      )
    )
  );

-- Permanent deletion. The UI soft-deletes by default (deleted_at).
create policy "events: permanent delete"
  on public.events for delete to authenticated
  using ((select public.has_permission('event.delete')));

-- ─── event_internal_notes (never public) ───────────────────────────
create policy "notes: read"
  on public.event_internal_notes for select to authenticated
  using (
    (select public.has_permission('event.view.internal'))
    or exists (
      select 1 from public.events e
      where e.id = event_id and e.created_by = (select auth.uid()) and (select public.has_permission('event.edit.own'))
    )
  );

create policy "notes: write"
  on public.event_internal_notes for insert to authenticated
  with check (
    (select public.has_permission('event.edit.any'))
    or exists (
      select 1 from public.events e
      where e.id = event_id and e.created_by = (select auth.uid())
        and e.status in ('draft', 'rejected') and (select public.has_permission('event.edit.own'))
    )
  );

create policy "notes: update"
  on public.event_internal_notes for update to authenticated
  using (
    (select public.has_permission('event.edit.any'))
    or exists (
      select 1 from public.events e
      where e.id = event_id and e.created_by = (select auth.uid())
        and e.status in ('draft', 'rejected') and (select public.has_permission('event.edit.own'))
    )
  )
  with check (
    (select public.has_permission('event.edit.any'))
    or exists (
      select 1 from public.events e
      where e.id = event_id and e.created_by = (select auth.uid())
        and e.status in ('draft', 'rejected') and (select public.has_permission('event.edit.own'))
    )
  );

-- ─── event_history (read-only to staff who can see the event) ──────
create policy "history: read"
  on public.event_history for select to authenticated
  using (
    (select public.has_permission('event.view.internal'))
    or exists (
      select 1 from public.events e
      where e.id = event_id and e.created_by = (select auth.uid()) and (select public.has_permission('event.edit.own'))
    )
  );

-- ─── audit_logs (read-only, append via triggers) ───────────────────
create policy "audit: read"
  on public.audit_logs for select to authenticated
  using ((select public.has_permission('audit.view')));

-- ─── administrator_invitations ─────────────────────────────────────
create policy "invitations: read"
  on public.administrator_invitations for select to authenticated
  using ((select public.has_permission('user.invite')));

create policy "invitations: create"
  on public.administrator_invitations for insert to authenticated
  with check ((select public.has_permission('user.invite')));

create policy "invitations: revoke"
  on public.administrator_invitations for update to authenticated
  using ((select public.has_permission('user.invite')))
  with check ((select public.has_permission('user.invite')));

-- ─── Public view ───────────────────────────────────────────────────
-- security_invoker: the caller's privileges and RLS apply underneath,
-- and the WHERE clause guarantees only published rows even for staff.
create view public.published_events
with (security_invoker = true, security_barrier = true)
as
select
  e.id,
  e.title,
  e.description,
  e.severity,
  e.latitude,
  e.longitude,
  e.location_name,
  e.country,
  e.region,
  e.city,
  e.source_name,
  e.source_url,
  e.source_type,
  e.occurred_at,
  e.published_at,
  e.updated_at,
  e.is_breaking,
  e.is_verified,
  e.translations,
  e.category_id,
  c.slug          as category_slug,
  c.name          as category_name,
  c.icon          as category_icon,
  c.color         as category_color,
  c.marker_color  as category_marker_color
from public.events e
left join public.event_categories c on c.id = e.category_id and c.is_active
where e.status = 'published'
  and e.deleted_at is null
  and e.latitude is not null
  and e.longitude is not null;

revoke all on public.published_events from anon, authenticated;
grant select on public.published_events to anon, authenticated;
