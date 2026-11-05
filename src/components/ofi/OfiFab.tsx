import { Link } from 'react-router-dom';
import { useI18n } from '@/i18n';
import { OfiAvatar } from './OfiParts';

/** Floating "Insights by OFI" button on the live map (above the phone tab bar, clear of map controls). */
export function OfiFab() {
  const { t } = useI18n();
  return (
    <Link
      to="/insights"
      aria-label={t('nav.insights')}
      title={t('nav.insights')}
      className="fixed bottom-20 end-3 z-[1100] grid size-14 place-items-center rounded-full bg-white shadow-lg ring-1 ring-slate-900/10 hover:scale-105 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500 motion-reduce:hover:scale-100 lg:bottom-10 lg:end-5 dark:bg-slate-900 dark:ring-white/15"
    >
      <OfiAvatar mood="calm" size={42} />
    </Link>
  );
}
