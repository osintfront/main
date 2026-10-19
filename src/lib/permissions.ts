import type { AppRole, Profile } from '@/types/user';

/**
 * Central permission matrix.
 *
 * This MUST stay in sync with `public.role_permissions()` in
 * supabase/migrations/20261019000001_initial_schema.sql. The database copy is
 * the one that actually protects data (RLS + triggers); this copy only drives
 * what the UI offers. Components ask `can('event.publish')` — they never
 * compare role names directly.
 */
export const PERMISSIONS = [
  'dashboard.view',
  'event.view.operational',
  'event.view.internal',
  'event.create',
  'event.edit.own',
  'event.edit.any',
  'event.review',
  'event.publish',
  'event.archive',
  'event.delete',
  'category.manage',
  'user.invite',
  'user.manage',
  'user.manage.admins',
  'role.manage',
  'audit.view',
  'settings.manage',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const ADMIN_PERMISSIONS: readonly Permission[] = [
  'dashboard.view',
  'event.view.operational',
  'event.view.internal',
  'event.create',
  'event.edit.own',
  'event.edit.any',
  'event.review',
  'event.publish',
  'event.archive',
  'event.delete',
  'category.manage',
  'user.invite',
  'user.manage',
  'audit.view',
];

const ROLE_PERMISSIONS: Record<AppRole, readonly Permission[]> = {
  super_admin: PERMISSIONS,
  admin: ADMIN_PERMISSIONS,
  editor: ['dashboard.view', 'event.create', 'event.edit.own'],
  viewer: ['dashboard.view', 'event.view.operational'],
};

type PermissionSubject = Pick<Profile, 'role' | 'status' | 'canPublish'> | null | undefined;

export function permissionsFor(subject: PermissionSubject): ReadonlySet<Permission> {
  if (!subject || subject.status !== 'active') return new Set();
  const granted = new Set<Permission>(ROLE_PERMISSIONS[subject.role] ?? []);
  if (subject.canPublish && granted.has('event.create')) granted.add('event.publish');
  return granted;
}

export function hasPermission(subject: PermissionSubject, permission: Permission): boolean {
  return permissionsFor(subject).has(permission);
}

/** Roles a user may assign to others, mirroring the profiles guard trigger. */
export function assignableRoles(subject: PermissionSubject): AppRole[] {
  const perms = permissionsFor(subject);
  if (perms.has('role.manage')) return ['super_admin', 'admin', 'editor', 'viewer'];
  if (perms.has('user.manage.admins')) return ['admin', 'editor', 'viewer'];
  if (perms.has('user.manage') || perms.has('user.invite')) return ['editor', 'viewer'];
  return [];
}
