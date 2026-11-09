import { Link } from 'react-router-dom';
import { Logo } from '@/components/common/Logo';
import { useI18n, type TranslationKey } from '@/i18n';
import { richText } from '@/i18n/richText';

const TITLES = {
  terms: 'legal.terms',
  refund: 'legal.refund',
  cancel: 'legal.cancel',
} as const satisfies Record<string, TranslationKey>;

/** Legal pages — placeholders; the texts will be added later. */
export function LegalPlaceholder({ page }: { page: keyof typeof TITLES }) {
  const { t, dir } = useI18n();
  return (
    <div dir={dir} className="min-h-dvh bg-slate-50 dark:bg-slate-950">
      <header className="border-b border-slate-200 bg-white px-4 py-2.5 dark:border-slate-800 dark:bg-slate-900"><Logo /></header>
      <main className="mx-auto max-w-2xl px-4 py-10 text-slate-800 dark:text-slate-100">
        <h1 className="text-2xl font-bold">{t(TITLES[page])}</h1>
        {page === 'cancel' ? (
          <>
            <p className="mt-4 text-slate-600 dark:text-slate-300">{richText(t('legal.cancelContact'), {
              email: <a className="text-sky-600 underline" href="mailto:service@osintfront.com">service@osintfront.com</a>,
            })}</p>
            <p className="mt-2 text-slate-600 dark:text-slate-300">{richText(t('legal.cancelRights'), {
              policy: <Link className="text-sky-600 underline" to="/refund-policy">{t('legal.cancelPolicyLink')}</Link>,
            })}</p>
          </>
        ) : (
          <p className="mt-4 text-slate-500">{t('legal.comingSoon')}</p>
        )}
        <nav className="mt-8 flex flex-wrap gap-4 text-sm text-sky-700 dark:text-sky-400">
          <Link to="/terms">{t('site.terms')}</Link><Link to="/privacy">{t('site.privacy')}</Link><Link to="/refund-policy">{t('legal.navRefund')}</Link><Link to="/cancel-subscription">{t('legal.cancel')}</Link><Link to="/">{t('legal.navHome')}</Link>
        </nav>
      </main>
    </div>
  );
}
