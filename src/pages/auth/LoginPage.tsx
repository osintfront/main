import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { Eye, EyeOff, Lock } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { wasKickedOut } from '@/lib/session';
import { useI18n } from '@/i18n';
import { loginLockRemaining, type SignInFailure } from '@/services/authService';
import { isValidEmail, safeRedirectPath } from '@/utils/url';
import { LiveBadge, LoginGlobe, LoginTicker } from '@/components/auth/LoginShowcase';
import { LanguageToggle, ThemeToggle } from '@/components/common/Toggles';
import { InstallAppButton } from '@/components/install/InstallAppButton';
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
  // The site is members-only: after signing in, back to where they were going (the map by default).
  const redirectTo = safeRedirectPath(state.from, '/');

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

  const [kicked] = useState(wasKickedOut);
  const expired = !kicked && (sessionExpired || state.reason === 'expired');

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
    <div className="ofm-login relative flex min-h-dvh flex-col overflow-hidden bg-slate-950 text-white">
      {/* Backdrop: dark map grid and glow (decorative). */}
      <div className="ofm-login__grid pointer-events-none absolute inset-0" aria-hidden />
      <div className="ofm-login__glow pointer-events-none absolute inset-0" aria-hidden />
      <LoginGlobe className="pointer-events-none absolute start-1/2 top-[38%] size-[120vmin] -translate-x-1/2 -translate-y-1/2 opacity-50 rtl:translate-x-1/2 lg:hidden" />

      <header className="relative z-10 flex h-14 items-center justify-end gap-0.5 px-4 [&_button]:text-slate-300 [&_button:hover]:bg-white/10 [&_button:hover]:text-white">
        <InstallAppButton />
        <LanguageToggle />
        <ThemeToggle />
      </header>

      <main className="relative z-10 mx-auto grid w-full max-w-6xl flex-1 items-center gap-10 px-4 pb-16 lg:grid-cols-[1.15fr_1fr]">
        {/* Showcase: what members get. */}
        <section className="hidden flex-col items-center lg:flex">
          <div className="relative aspect-square w-full max-w-[520px]">
            <LoginGlobe className="absolute inset-0 size-full" />
            <div className="absolute top-4 start-4"><LiveBadge label={t('login.live')} /></div>
          </div>
          <div className="-mt-10 flex w-full flex-col items-center gap-4">
            <LoginTicker />
            <p className="text-[11px] text-slate-500">{t('login.demoNote')}</p>
          </div>
        </section>

        <div className="mx-auto w-full max-w-sm">
          <div className="mb-6 flex flex-col items-center text-center">
            <img src="/logo-mark.png" alt="" aria-hidden className="ofm-login__mark h-24 w-auto drop-shadow-[0_0_30px_rgba(56,189,248,0.55)]" />
            <h1 className="mt-2 text-4xl font-black tracking-tight" dir="ltr">
              <span className="text-white">OSINT</span><span className="bg-gradient-to-r from-sky-400 to-cyan-300 bg-clip-text text-transparent">Front</span>
            </h1>
            <p className="mt-1 text-sm font-medium text-sky-200/80">{t('login.tagline')}</p>
            <ul className="mt-4 flex flex-wrap justify-center gap-2 text-[11px] font-semibold text-slate-300">
              {(['login.perk1', 'login.perk2', 'login.perk3'] as const).map((k) => (
                <li key={k} className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1">{t(k)}</li>
              ))}
            </ul>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/95 p-6 text-slate-900 shadow-2xl shadow-sky-950/50 backdrop-blur sm:p-7 dark:bg-slate-900/90 dark:text-white">
            <h2 className="text-lg font-bold tracking-tight">{t('login.title')}</h2>
            <p className="mb-5 mt-1 text-sm text-slate-600 dark:text-slate-400">{t('login.subtitle')}</p>
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        {kicked && !failure ? <Alert tone="warning">התחברת ממכשיר אחר, ולכן נותקת כאן.</Alert> : null}
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

        <p className="flex items-start gap-2 border-t border-slate-200/70 pt-4 text-xs leading-relaxed text-slate-500 dark:border-white/10 dark:text-slate-400">
          <Lock className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          {t('auth.inviteOnly')}
        </p>
      </form>
          </div>

          <Link to="/contact" className="mt-5 flex items-center justify-center gap-2 rounded-xl border border-sky-400/30 bg-gradient-to-r from-sky-500/15 to-indigo-500/15 px-4 py-3 text-sm font-semibold text-sky-100 transition hover:border-sky-300/60 hover:from-sky-500/25 hover:to-indigo-500/25">
            {t('login.subscribe')}
          </Link>

          <nav className="mt-6 flex justify-center gap-4 text-xs text-slate-400">
            <Link to="/about" className="hover:text-white">{t('login.about')}</Link>
            <Link to="/privacy" className="hover:text-white">{t('login.privacy')}</Link>
            <Link to="/contact" className="hover:text-white">{t('login.contact')}</Link>
            <Link to="/terms" className="hover:text-white">תנאי שימוש</Link>
            <Link to="/refund-policy" className="hover:text-white">ביטולים והחזרים</Link>
          </nav>
        </div>
      </main>
    </div>
  );
}
