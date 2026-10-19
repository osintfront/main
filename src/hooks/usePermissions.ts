import { useCallback, useMemo } from 'react';
import { permissionsFor, type Permission } from '@/lib/permissions';
import { useAuth } from './useAuth';

/**
 * The one way components ask "may I?". It only shapes the UI — the
 * database (RLS + guard triggers) independently enforces every rule.
 */
export function usePermissions() {
  const { profile } = useAuth();
  const granted = useMemo(() => permissionsFor(profile), [profile]);
  const can = useCallback((permission: Permission) => granted.has(permission), [granted]);
  const canAny = useCallback((list: readonly Permission[]) => list.some((p) => granted.has(p)), [granted]);
  return { can, canAny, granted };
}
