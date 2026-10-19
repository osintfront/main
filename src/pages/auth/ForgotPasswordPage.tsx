import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useI18n } from '@/i18n';
import { sendPasswordResetEmail } from '@/services/authService';
import { isValidEmail } from '@/utils/url';
import { AuthLayout } from '@/components/auth/AuthLayout';
import { SetupNotice } from '@/components/auth/SetupNotice';
import { Alert } from '@/components/common/Feedback';
import { Button, TextField } from '@/components/common/Form';

export function ForgotPasswordPage() {
  const { t } = useI18n();
  const { status } = useAuth();
  const [email, setEmail] = useState('');
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (status === 'unconfigured') return <SetupNotice />;

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    if (!email.trim()) return setFieldError(t('auth.errorEmailRequired'));
    if (!isValidEmail(email)) return setFieldError(t('auth.errorEmailInvalid'));
    setFieldError(null);
    setError(null);
    setSubmitting(true);
    const result = await sendPasswordResetEmail(email);
    setSubmitting(false);
    if (result.error === 'rate_limited') return setError(t('auth.errorRateLimited', { seconds: 60 }));
    if (result.error === 'network') return setError(t('auth.errorNetwork'));
    // Same confirmation whether or not the account exists (no account probing).
    setSentTo(email.trim());
  };

  return (
    <AuthLayout title={t('auth.forgotTitle')} subtitle={sentTo ? undefined : t('auth.forgotBody')}>
      {sentTo ? (
        <div className="flex flex-col gap-5">
          <Alert tone="success">{t('auth.linkSent', { email: sentTo })}</Alert>
          <Link to="/login" className="text-center text-sm font-semibold text-sky-700 hover:text-sky-600 dark:text-sky-400">
            {t('auth.backToSignIn')}
          </Link>
        </div>
      ) : (
        <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
          {error ? <Alert tone="error">{error}</Alert> : null}
          <TextField
            label={t('auth.email')}
            type="email"
            inputMode="email"
            autoComplete="username"
            dir="ltr"
            value={email}
            maxLength={254}
            onChange={(e) => setEmail(e.target.value)}
            error={fieldError}
            disabled={submitting}
            autoFocus
          />
          <Button type="submit" loading={submitting} className="w-full">
            {submitting ? t('auth.sending') : t('auth.sendLink')}
          </Button>
          <Link to="/login" className="text-center text-sm font-medium text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white">
            {t('auth.backToSignIn')}
          </Link>
        </form>
      )}
    </AuthLayout>
  );
}
