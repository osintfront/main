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
      className="group fixed bottom-20 end-3 z-[1100] flex items-center gap-2 lg:bottom-10 lg:end-5"
    >
      <span className="hidden rounded-full bg-emerald-800 px-2.5 py-1 text-[11px] font-bold text-white opacity-0 shadow transition group-hover:opacity-100 group-focus-visible:opacity-100 sm:inline">
        {t('nav.insights')}
      </span>
      <span className="grid size-14 place-items-center rounded-full bg-white shadow-lg shadow-emerald-900/30 ring-2 ring-emerald-600/60 transition group-hover:scale-110 motion-safe:animate-[ofi-bob_3s_ease-in-out_infinite] motion-reduce:transition-none dark:bg-slate-900">
        <OfiAvatar mood="calm" size={48} />
      </span>
      <style>{'@keyframes ofi-bob{0%,100%{transform:translateY(0)}50%{transform:translateY(-3px)}}'}</style>
    </Link>
  );
}
