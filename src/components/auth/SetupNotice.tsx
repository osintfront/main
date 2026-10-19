import { useI18n } from '@/i18n';
import { supabaseConfigError } from '@/integrations/supabase/client';
import { Alert } from '@/components/common/Feedback';
import { AuthLayout } from './AuthLayout';

/** Shown instead of auth/admin screens when Supabase isn't configured — never a silent failure. */
export function SetupNotice() {
  const { t } = useI18n();
  const steps = ['setup.step1', 'setup.step2', 'setup.step3', 'setup.step4', 'setup.step5'] as const;
  return (
    <AuthLayout title={t('setup.title')} subtitle={t('setup.body')} wide>
      {supabaseConfigError === 'service_role' ? (
        <Alert tone="error" className="mb-5">
          {t('setup.serviceRole')}
        </Alert>
      ) : null}
      <ol className="space-y-3">
        {steps.map((key, i) => (
          <li key={key} className="flex gap-3 text-sm text-slate-700 dark:text-slate-300">
            <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-slate-900 text-xs font-bold text-white dark:bg-white dark:text-slate-900">
              {i + 1}
            </span>
            <span className="pt-0.5">{t(key)}</span>
          </li>
        ))}
      </ol>
      <pre
        dir="ltr"
        className="mt-5 overflow-x-auto rounded-lg bg-slate-950 p-3 text-left font-mono text-xs leading-relaxed text-slate-200"
      >
        {`# .env.local
VITE_SUPABASE_URL=https://<project-ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon public key>`}
      </pre>
    </AuthLayout>
  );
}
