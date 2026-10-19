import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useI18n } from '@/i18n';
import { AuthLayout } from '@/components/auth/AuthLayout';
import { SetupNotice } from '@/components/auth/SetupNotice';
import { Alert, FullScreenLoader } from '@/components/common/Feedback';
import { PasswordForm } from '@/components/auth/PasswordForm';

/**
 * Landing page for the password-reset email. Supabase exchanges the link for
 * a short-lived recovery session (detectSessionInUrl), then the user picks a
 * new password here.
 */
export function ResetPasswordPage() {
  const { t } = useI18n();
  const { status, session } = useAuth();
  const [done, setDone] = useState(false);
  // Give the client a moment to consume the token in the URL before declaring it invalid.
  const [grace, setGrace] = useState(true);
  useEffect(() => {
    const id = window.setTimeout(() => setGrace(false), 2500);
    return () => window.clearTimeout(id);
  }, []);

  if (status === 'unconfigured') return <SetupNotice />;
  if ((status === 'loading' || (status === 'signed_out' && grace)) && !done) {
    return <FullScreenLoader label={t('auth.verifying')} />;
  }

  if (!session && !done) {
    return (
      <AuthLayout title={t('auth.resetTitle')}>
        <div className="flex flex-col gap-5">
          <Alert tone="error">{t('auth.resetLinkInvalid')}</Alert>
          <Link to="/forgot-password" className="text-center text-sm font-semibold text-sky-700 hover:text-sky-600 dark:text-sky-400">
            {t('auth.requestNewLink')}
          </Link>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title={t('auth.resetTitle')} subtitle={done ? undefined : t('auth.passwordRules')}>
      {done ? (
        <div className="flex flex-col gap-5">
          <Alert tone="success">{t('auth.passwordUpdated')}</Alert>
          <Link
            to="/admin"
            className="inline-flex h-10 items-center justify-center rounded-lg bg-sky-600 text-sm font-semibold text-white hover:bg-sky-500"
          >
            {t('auth.goToDashboard')}
          </Link>
        </div>
      ) : (
        <PasswordForm onSaved={() => setDone(true)} />
      )}
    </AuthLayout>
  );
}
