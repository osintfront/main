import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { useI18n } from '@/i18n';
import { Logo } from '@/components/common/Logo';
import { LanguageToggle, ThemeToggle } from '@/components/common/Toggles';

/** Centered card layout shared by sign-in, password and status screens. */
export function AuthLayout({ title, subtitle, children, wide = false }: { title: string; subtitle?: ReactNode; children: ReactNode; wide?: boolean }) {
  const { t } = useI18n();
  return (
    <div className="ofm-auth-bg flex min-h-dvh flex-col bg-slate-50 dark:bg-slate-950">
      <header className="flex h-14 items-center justify-between px-4">
        <Logo />
        <div className="flex items-center gap-0.5">
          <LanguageToggle />
          <ThemeToggle />
        </div>
      </header>
      <main className="flex flex-1 items-start justify-center px-4 pb-16 pt-6 sm:items-center sm:pt-0">
        <div
          className={`w-full ${wide ? 'max-w-xl' : 'max-w-sm'} rounded-2xl border border-slate-200 bg-white p-6 shadow-xl shadow-slate-900/5 sm:p-8 dark:border-slate-800 dark:bg-slate-900 dark:shadow-black/30`}
        >
          <h1 className="text-xl font-bold tracking-tight text-slate-900 dark:text-white">{title}</h1>
          {subtitle ? <div className="mt-1.5 text-sm text-slate-600 dark:text-slate-400">{subtitle}</div> : null}
          <div className="mt-6">{children}</div>
        </div>
      </main>
      <footer className="pb-6 text-center">
        <Link
          to="/"
          className="inline-flex items-center gap-1.5 rounded text-sm font-medium text-slate-600 hover:text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500 dark:text-slate-400 dark:hover:text-white"
        >
          <ArrowLeft className="size-4 rtl:-scale-x-100" aria-hidden />
          {t('auth.backToMap')}
        </Link>
      </footer>
    </div>
  );
}
