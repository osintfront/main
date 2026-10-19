import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { Eye, EyeOff } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useI18n } from '@/i18n';
import { loginLockRemaining, type SignInFailure } from '@/services/authService';
import { isValidEmail, safeRedirectPath } from '@/utils/url';
import { AuthLayout } from '@/components/auth/AuthLayout';
import { SetupNotice } from '@/components/auth/SetupNotice';
import { Alert, FullScreenLoader } from '@/components/common/Feedback';
import { Button, TextField } from '@/components/common/Form';

interface LocationState {
  from?: string;
  reason?: 'expired' | 'signed_out';
}

export function LoginPage() {
  const { t } = useI18n();
  const { status, signIn, sessionExpired, acknowledgeSessionExpired } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const state = (location.state ?? {}) as LocationState;
  const redirectTo = safeRedirectPath(state.from);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<{ email?: string; password?: string }>({});
  const [failure, setFailure] = useState<SignInFailure | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [lockSeconds, setLockSeconds] = useState(() => loginLockRemaining());
  const emailRef = useRef<HTMLInputElement>(null);

  // Count down an active lockout.
  useEffect(() => {
    if (lockSeconds <= 0) return;
    const id = window.setInterval(() => setLockSeconds(loginLockRemaining()), 1000);
    return () => window.clearInterval(id);
  }, [lockSeconds]);

  useEffect(() => emailRef.current?.focus(), []);

  if (status === 'unconfigured') return <SetupNotice />;
  if (status === 'loading' && !submitting) return <FullScreenLoader label={t('auth.verifying')} />;
  if (status === 'signed_in') return <Navigate to={redirectTo} replace />;

  const expired = sessionExpired || state.reason === 'expired';

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    const errors: typeof fieldErrors = {};
    if (!email.trim()) errors.email = t('auth.errorEmailRequired');
    else if (!isValidEmail(email)) errors.email = t('auth.errorEmailInvalid');
    if (!password) errors.password = t('auth.errorPasswordRequired');
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;

    setSubmitting(true);
    setFailure(null);
    const result = await signIn(email, password);
    setSubmitting(false);
    if (result) {
      setFailure(result);
      if (result.code === 'rate_limited') setLockSeconds(result.retryAfterSeconds);
      setPassword('');
      return;
    }
    acknowledgeSessionExpired();
    navigate(redirectTo, { replace: true });
  };

  const failureMessage = (() => {
    if (!failure) return null;
    switch (failure.code) {
      case 'invalid_credentials':
        return t('auth.errorInvalid');
      case 'email_not_confirmed':
        return t('auth.errorUnconfirmed');
      case 'rate_limited':
        return t('auth.errorRateLimited', { seconds: Math.max(lockSeconds, 1) });
      case 'network':
        return t('auth.errorNetwork');
      case 'not_configured':
        return t('setup.title');
      case 'other':
        return t('auth.errorGeneric', { message: failure.message });
    }
  })();

  const locked = lockSeconds > 0;

  return (
    <AuthLayout title={t('auth.signInTitle')} subtitle={t('auth.signInSubtitle')}>
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        {expired && !failure ? <Alert tone="warning">{t('auth.sessionExpired')}</Alert> : null}
        {failureMessage ? <Alert tone="error">{failureMessage}</Alert> : null}

        <TextField
          ref={emailRef}
          label={t('auth.email')}
          type="email"
          inputMode="email"
          autoComplete="username"
          dir="ltr"
          value={email}
          maxLength={254}
          onChange={(e) => setEmail(e.target.value)}
          error={fieldErrors.email}
          disabled={submitting}
        />
        <TextField
          label={t('auth.password')}
          type={showPassword ? 'text' : 'password'}
          autoComplete="current-password"
          dir="ltr"
          value={password}
          maxLength={256}
          onChange={(e) => setPassword(e.target.value)}
          error={fieldErrors.password}
          disabled={submitting}
          trailing={
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              aria-label={showPassword ? t('auth.hidePassword') : t('auth.showPassword')}
              aria-pressed={showPassword}
              className="inline-flex size-8 items-center justify-center rounded-md text-slate-500 hover:text-slate-800 focus-visible:outline-2 focus-visible:outline-sky-500 dark:hover:text-slate-200"
            >
              {showPassword ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
            </button>
          }
        />

        <div className="flex justify-end">
          <Link
            to="/forgot-password"
            className="rounded text-sm font-medium text-sky-700 hover:text-sky-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500 dark:text-sky-400 dark:hover:text-sky-300"
          >
            {t('auth.forgot')}
          </Link>
        </div>

        <Button type="submit" loading={submitting} disabled={locked} className="w-full">
          {submitting ? t('auth.signingIn') : t('auth.signIn')}
        </Button>

        <p className="border-t border-slate-100 pt-4 text-xs leading-relaxed text-slate-500 dark:border-slate-800 dark:text-slate-400">
          {t('auth.inviteOnly')}
        </p>
      </form>
    </AuthLayout>
  );
}
