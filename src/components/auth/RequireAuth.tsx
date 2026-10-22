import type { ReactNode } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { usePermissions } from '@/hooks/usePermissions';
import { useI18n } from '@/i18n';
import type { Permission } from '@/lib/permissions';
import { FullScreenLoader } from '@/components/common/Feedback';
import { AccessDenied } from './AccessDenied';
import { SetupNotice } from './SetupNotice';

interface RequireAuthProps {
  /** The user needs at least one of these permissions. */
  anyOf?: readonly Permission[];
  /** Nested inside AdminLayout: render denials inline, skip full-screen states. */
  embedded?: boolean;
  children?: ReactNode;
}

/**
 * Route guard: configured → session verified → active staff profile →
 * MFA (when required) → permission. UI convenience only; the same rules
 * are enforced in the database.
 */
export function RequireAuth({ anyOf, embedded = false, children }: RequireAuthProps) {
  const { status, profile, profileError, sessionExpired, mfa } = useAuth();
  const { canAny } = usePermissions();
  const location = useLocation();
  const { t } = useI18n();

  if (status === 'unconfigured') return <SetupNotice />;
  if (status === 'loading') return <FullScreenLoader label={t('auth.verifying')} />;
  if (status === 'signed_out') {
    return (
      <Navigate
        to="/login"
        replace
        state={{ from: `${location.pathname}${location.search}`, reason: sessionExpired ? 'expired' : undefined }}
      />
    );
  }

  if (profileError) return <AccessDenied reason="profile_error" embedded={embedded} />;
  if (!profile) return <AccessDenied reason="no_profile" embedded={embedded} />;
  if (profile.status === 'suspended') return <AccessDenied reason="suspended" embedded={embedded} />;
  if (profile.status === 'pending') return <AccessDenied reason="pending" embedded={embedded} />;
  if (!mfa.satisfied) return <AccessDenied reason="mfa_required" embedded={embedded} />;
  // Plain users (no back office) go to the map.
  if (anyOf?.includes('admin.access') && !canAny(anyOf)) return <Navigate to="/" replace />;
  if (anyOf && anyOf.length > 0 && !canAny(anyOf)) {
    return <AccessDenied reason="missing_permission" permission={anyOf[0]} embedded={embedded} />;
  }

  return children ? <>{children}</> : <Outlet />;
}
