import { Link } from 'react-router-dom';
import { useI18n } from '@/i18n';
import { cn } from '@/utils/cn';

/** About · Privacy · Contact — shown on every public page. */
export function SiteLinks({ className }: { className?: string }) {
  const { t } = useI18n();
  const link = 'hover:text-slate-800 hover:underline dark:hover:text-white';
  return (
    <nav aria-label={t('site.links')} className={cn('flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500 dark:text-slate-400', className)}>
      <Link to="/about" className={link}>
        {t('site.about')}
      </Link>
      <span aria-hidden>·</span>
      <Link to="/privacy" className={link}>
        {t('site.privacy')}
      </Link>
      <span aria-hidden>·</span>
      <Link to="/contact" className={link}>
        {t('site.contact')}
      </Link>
      <span aria-hidden>·</span>
      <span>© {new Date().getFullYear()} Osintfront</span>
    </nav>
  );
}
