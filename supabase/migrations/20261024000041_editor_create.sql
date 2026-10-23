-- ════════════════════════════════════════════════════════════════════
-- Osintfront · Migration 41 — editors report events
-- Editors get the "Report event" page like admins (event.create, event.edit.own).
-- Publishing stays with admins (or an editor whose profile has can_publish): an editor's
-- report is saved as a draft or sent for review; an admin publishes it.
-- Mirrors src/lib/permissions.ts.
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
    when 'editor' then array['admin.access', 'event.view.operational', 'event.view.internal',
      'event.create', 'event.edit.own', 'event.edit.any']
    when 'viewer' then array[]::text[]
    else array[]::text[]
  end;
$$;
