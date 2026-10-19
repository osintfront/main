import { Link } from 'react-router-dom';
import { ShieldX } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useI18n } from '@/i18n';
import type { Permission } from '@/lib/permissions';
import { Button } from '@/components/common/Form';
import { AuthLayout } from './AuthLayout';

export type DenialReason = 'no_profile' | 'suspended' | 'pending' | 'profile_error' | 'mfa_required' | 'missing_permission';

interface AccessDeniedProps {
  reason: DenialReason;
  permission?: Permission;
  /** Render inside the admin layout instead of as a full page. */
  embedded?: boolean;
}

/** Friendly unauthorized-access screen. Explains why, never just "403". */
export function AccessDenied({ reason, permission, embedded = false }: AccessDeniedProps) {
  const { t } = useI18n();
  const { profile, profileError, signOut } = useAuth();

  const message = (() => {
    switch (reason) {
      case 'no_profile':
        return t('unauth.noProfile');
      case 'suspended':
        return t('unauth.suspended');
      case 'pending':
        return t('unauth.pending');
      case 'profile_error':
        return t('unauth.profileError', { message: profileError ?? '' });
      case 'mfa_required':
        return t('unauth.mfaRequired');
      case 'missing_permission':
        return t('unauth.missingPermission', {
          role: profile ? t(`role.${profile.role}`) : '—',
          permission: permission ? t(`perm.${permission}`) : '',
        });
    }
  })();

  const body = (
    <div className="flex flex-col gap-5">
      <p className="text-sm leading-relaxed text-slate-600 dark:text-slate-300">{message}</p>
      <div className="flex flex-wrap gap-2">
        {reason === 'missing_permission' && embedded ? (
          <Link
            to="/admin"
            className="inline-flex h-10 items-center rounded-lg bg-sky-600 px-4 text-sm font-semibold text-white hover:bg-sky-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500"
          >
            {t('unauth.backToDashboard')}
          </Link>
        ) : null}
        {reason !== 'missing_permission' ? (
          <Button variant="secondary" onClick={() => void signOut()}>
            {t('auth.signOut')}
          </Button>
        ) : null}
      </div>
    </div>
  );

  if (embedded) {
    return (
      <div className="mx-auto max-w-lg rounded-2xl border border-slate-200 bg-white p-8 text-center dark:border-slate-800 dark:bg-slate-900">
        <ShieldX className="mx-auto size-10 text-slate-400" aria-hidden />
        <h1 className="mt-4 text-lg font-bold text-slate-900 dark:text-white">{t('unauth.title')}</h1>
        <div className="mt-2 [&_div]:items-center">{body}</div>
      </div>
    );
  }
  return <AuthLayout title={t('unauth.title')}>{body}</AuthLayout>;
}
