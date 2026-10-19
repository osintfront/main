import { useI18n } from '@/i18n';
import { AuthLayout } from '@/components/auth/AuthLayout';

export function NotFoundPage() {
  const { t } = useI18n();
  return (
    <AuthLayout title={t('common.notFoundTitle')}>
      <p className="text-sm text-slate-600 dark:text-slate-400">{t('common.notFoundBody')}</p>
    </AuthLayout>
  );
}
