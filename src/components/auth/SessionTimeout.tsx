import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Clock } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useI18n } from '@/i18n';
import { SESSION_CLOCK_KEY, SESSION_MS, WARN_MS, clearSessionClock, sessionStarted, startSessionClock } from '@/lib/sessionClock';

/** Ends a sign-in after 24 hours; two minutes before, asks whether to continue. */
export function SessionTimeout() {
  const { status, signOut } = useAuth();
  const { t } = useI18n();
  const navigate = useNavigate();
  const [now, setNow] = useState(() => Date.now());
  const [started, setStarted] = useState<number | null>(() => sessionStarted());

  // A session that was open before this feature (or in a new tab) starts its clock now.
  useEffect(() => {
    if (status !== 'signed_in') return;
    let s = sessionStarted();
    if (!s) {
      s = Date.now();
      startSessionClock(s);
    }
    setStarted(s);
  }, [status]);

  // Other tabs: extended or signed out there.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === SESSION_CLOCK_KEY) setStarted(sessionStarted());
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  useEffect(() => {
    if (status !== 'signed_in') return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [status]);

  const left = status === 'signed_in' && started ? started + SESSION_MS - now : null;

  useEffect(() => {
    if (left === null || left > 0) return;
    clearSessionClock();
    void signOut().then(() => navigate('/login', { replace: true, state: { reason: 'expired' } }));
  }, [left, signOut, navigate]);

  if (left === null || left > WARN_MS || left <= 0) return null;

  const secs = Math.ceil(left / 1000);
  const mmss = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
  const extend = () => {
    const s = Date.now();
    startSessionClock(s);
    setStarted(s);
  };
  const leave = () => {
    clearSessionClock();
    void signOut().then(() => navigate('/login', { replace: true }));
  };

  return (
    <div className="fixed inset-0 z-[5000] flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm" role="presentation">
      <section
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="session-title"
        aria-describedby="session-body"
        className="w-full max-w-sm rounded-2xl bg-white p-6 text-center shadow-2xl ring-1 ring-slate-900/10 dark:bg-slate-900 dark:ring-white/10"
      >
        <span className="mx-auto grid size-12 place-items-center rounded-full bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">
          <Clock className="size-6" aria-hidden />
        </span>
        <h2 id="session-title" className="mt-3 text-lg font-bold text-slate-900 dark:text-white">
          {t('session.title')}
        </h2>
        <p id="session-body" className="mt-1 text-sm text-slate-600 dark:text-slate-400">
          {t('session.body')}
        </p>
        <p className="mt-3 font-mono text-3xl font-bold tabular-nums text-slate-900 dark:text-white" aria-live="polite">
          {mmss}
        </p>
        <div className="mt-5 flex flex-col gap-2 sm:flex-row-reverse">
          <button
            type="button"
            autoFocus
            onClick={extend}
            className="h-10 flex-1 rounded-lg bg-sky-600 px-4 text-sm font-semibold text-white hover:bg-sky-500"
          >
            {t('session.extend')}
          </button>
          <button
            type="button"
            onClick={leave}
            className="h-10 flex-1 rounded-lg px-4 text-sm font-semibold text-slate-700 ring-1 ring-slate-300 hover:bg-slate-50 dark:text-slate-200 dark:ring-slate-700 dark:hover:bg-slate-800"
          >
            {t('session.signOut')}
          </button>
        </div>
      </section>
    </div>
  );
}
