import { memo, type CSSProperties } from 'react';
import { Crosshair, Timer } from 'lucide-react';
import { useI18n } from '@/i18n';
import { alertNames, formatCountdown, HFC_CATEGORY, threatInfo, zoneHeadline } from '@/config/hfcThreats';
import type { HfcAlert } from '@/types/hfcAlert';
import { formatEventTime, formatRelative } from '@/utils/time';
import { BreakingBadge, CategoryBadge } from '@/components/common/Badges';

interface AlertCardProps {
  alert: HfcAlert;
  now: number;
  onLocate: (id: string) => void;
}

const MAX_AREAS = 18;

function AlertCardImpl({ alert, now, onLocate }: AlertCardProps) {
  const { t, locale, lang } = useI18n();
  const threat = threatInfo(alert.threat);
  const { areas, zones } = alertNames(alert, lang);
  const remaining = Date.parse(alert.expiresAt) - now;
  const shownAreas = areas.slice(0, MAX_AREAS).join(', ');
  const moreAreas = areas.length - MAX_AREAS;

  return (
    <article
      id={`hfc-card-${alert.id}`}
      onClick={(e) => {
        if (!(e.target as HTMLElement).closest('a,button')) onLocate(alert.id);
      }}
      style={{ '--card-accent': threat.color } as CSSProperties}
      className="ofm-card ofm-card--hfc relative cursor-pointer rounded-xl border border-red-300 bg-red-50/80 p-3.5 transition-shadow hover:shadow-sm dark:border-red-500/40 dark:bg-red-950/40"
    >
      <span className="ofm-card__accent" aria-hidden />
      <header className="flex flex-wrap items-center gap-1.5">
        <time dateTime={alert.startedAt} className="me-1 font-mono text-[11px] font-medium text-slate-600 tabular-nums dark:text-slate-300">
          <bdi>{formatEventTime(alert.startedAt, locale)}</bdi>
          <span className="mx-1 text-slate-300 dark:text-slate-600" aria-hidden>
            ·
          </span>
          {formatRelative(alert.startedAt, locale, t('time.justNow'), now)}
        </time>
        <BreakingBadge />
        <span className="ms-auto inline-flex items-center gap-1 rounded-md bg-white/70 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-red-700 tabular-nums ring-1 ring-red-200 dark:bg-red-500/10 dark:text-red-300 dark:ring-red-500/30">
          <Timer className="size-3" aria-hidden />
          <span title={t('hfc.clearsHint')}>{t('hfc.clearsIn', { time: formatCountdown(remaining) })}</span>
        </span>
      </header>

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <CategoryBadge category={HFC_CATEGORY} />
        <span
          className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-bold text-white"
          style={{ backgroundColor: threat.color }}
        >
          <span className="relative flex size-1.5" aria-hidden>
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-white opacity-75 motion-reduce:animate-none" />
            <span className="relative inline-flex size-1.5 rounded-full bg-white" />
          </span>
          {t(`hfc.threat.${threat.key}`)}
        </span>
      </div>

      <h3 className="mt-2 text-[15px] font-semibold leading-snug text-slate-900 dark:text-white" dir="auto">
        {zoneHeadline(zones, areas)}
      </h3>
      <p className="mt-1 line-clamp-3 text-[13px] leading-relaxed text-slate-700 dark:text-slate-300" dir="auto">
        {moreAreas > 0 ? `${shownAreas} ${t('hfc.moreAreas', { count: moreAreas })}` : shownAreas}
      </p>

      <footer className="mt-3 flex items-center gap-2 border-t border-red-200/70 pt-2.5 text-xs text-slate-600 dark:border-red-500/20 dark:text-slate-400">
        <span>
          {t('hfc.areasCount', { count: areas.length })} · {t('hfc.lastAlert')}{' '}
          <bdi>{formatEventTime(alert.lastAlertAt, locale)}</bdi>
        </span>
        <button
          type="button"
          onClick={() => onLocate(alert.id)}
          aria-label={t('hfc.locateLabel')}
          className="ms-auto inline-flex h-7 items-center gap-1 rounded-md bg-white px-2 text-xs font-semibold text-slate-800 ring-1 ring-slate-200 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-sky-500 dark:bg-slate-800 dark:text-slate-100 dark:ring-slate-700 dark:hover:bg-slate-700"
        >
          <Crosshair className="size-3.5" aria-hidden />
          {t('feed.locate')}
        </button>
      </footer>
    </article>
  );
}

export const AlertCard = memo(AlertCardImpl);
