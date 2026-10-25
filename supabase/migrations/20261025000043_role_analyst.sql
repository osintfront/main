-- ════════════════════════════════════════════════════════════════════
-- Osintfront · Migration 43 — role "editor" renamed "analyst"
-- The enum value is renamed in place (existing profiles and invitations follow), and the
-- functions that name the role are recreated. Mirrors src/lib/permissions.ts.
-- ════════════════════════════════════════════════════════════════════
alter type public.app_role rename value 'editor' to 'analyst';

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
    when 'analyst' then array['admin.access', 'event.view.operational', 'event.view.internal',
      'event.create', 'event.edit.own', 'event.edit.any', 'event.publish.draft']
    when 'viewer' then array[]::text[]
    else array[]::text[]
  end;
$$;

create or replace function public.has_permission(p_permission text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles pr
    where pr.id = auth.uid() and pr.status = 'active'
      and (
        p_permission = any (public.role_permissions(pr.role))
        or (p_permission = 'event.publish' and pr.can_publish and pr.role = 'analyst')
      )
  );
$$;

create or replace function public.my_permissions()
returns text[] language sql stable security definer set search_path = '' as $$
  select coalesce((
    select public.role_permissions(pr.role)
           || case when pr.can_publish and pr.role = 'analyst' then array['event.publish'] else array[]::text[] end
    from public.profiles pr
    where pr.id = auth.uid() and pr.status = 'active'
  ), array[]::text[]);
$$;
