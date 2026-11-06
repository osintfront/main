import { Link } from 'react-router-dom';
import { useI18n } from '@/i18n';
import { OfiAvatar } from './OfiParts';

/**
 * "Insights by OFI" button in the map's bottom-end corner. It sits on top of the other buttons in that
 * corner (quick report, social search), so `stack` = how many of them are showing below it.
 */
export function OfiFab({ stack = 0 }: { stack?: number }) {
  const { t } = useI18n();
  return (
    <Link
      to="/insights"
      aria-label={t('nav.insights')}
      title={t('nav.insights')}
      style={{ bottom: `${1.5 + stack * 2.75}rem` }}
      className="group absolute end-3 z-[600] flex items-center gap-2"
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
