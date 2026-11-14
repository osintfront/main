import { type ReactNode } from 'react';
import { useI18n } from '@/i18n';
import { LogoMark } from '@/components/common/Logo';
import { bucketLabel, changeText, fmtNum, periodDates, PREPARED_MAX, type DashResult, type DashSelection } from '@/lib/askStats';
import { type View } from '@/lib/dashGeometry';
import { MiniMap } from './MiniMap';
import { BarChart } from './charts/BarChart';
import { HotspotBars } from './charts/HotspotBars';
import { useMark, type TipApi } from './charts/Tip';
import { cn } from '@/utils/cn';

export interface SheetProps {
  result: DashResult;
  preparedFor: string;
  view: View | null;
  variant: 'screen' | 'export';
  staff?: boolean;
  onPreparedFor?: (v: string) => void;
  onView?: (v: View) => void;
  onSelect?: (sel: DashSelection) => void;
  tip?: TipApi;
}

const time = (iso: string) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Jerusalem', numberingSystem: 'latn', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso));

/** The dashboard itself, header to method note. The same tree is drawn on screen and, off-screen in the
 *  light theme at 1,080 px, for the PDF / JPEG. */
export function DashboardSheet({ result: r, preparedFor, view, variant, staff, onPreparedFor, onView, onSelect, tip }: SheetProps) {
  const { t, dir } = useI18n();
  const mark = useMark(tip);
  const exp = variant === 'export';
  const peak = r.peak ? r.buckets[r.peak.index] : null;
  const top = r.places.find((p) => !p.other) ?? null;
  const card = 'rounded-xl p-3';
  const cardStyle = { background: 'var(--dash-panel)' };
  const muted = { color: 'var(--dash-muted)' };
  const tile = (key: string, title: string, value: ReactNode, sub: string, tipText: string, act?: () => void) => (
    <div data-tile={key} {...mark(`tile:${key}`, tipText, act)} className={cn(card, act && 'cursor-pointer')} style={cardStyle}>
      <p className="text-xs font-semibold" style={muted}>{title}</p>
      <p className="mt-0.5 text-2xl font-bold tabular-nums leading-tight" dir="auto">{value}</p>
      <p className="mt-0.5 text-xs" style={muted} dir="auto">{sub}</p>
    </div>
  );
  const prepared = staff && !exp ? (
    <input data-dash-prepared value={preparedFor} maxLength={PREPARED_MAX} onChange={(e) => onPreparedFor?.(e.target.value.slice(0, PREPARED_MAX))}
      placeholder={t('dash.preparedAdd')} aria-label={t('dash.preparedFor')} dir="auto"
      className="h-7 w-48 max-w-full rounded-md px-2 text-xs font-semibold outline-none ring-1" style={{ background: 'var(--dash-panel)', color: 'var(--dash-ink)', borderColor: 'var(--dash-line)' }} />
  ) : preparedFor.trim() ? (
    <span data-dash-prepared-badge className="rounded-md px-2 py-1 text-xs font-semibold" style={{ background: 'var(--dash-target)', color: 'var(--dash-ink)' }} dir="auto">
      {t('dash.preparedForName', { name: preparedFor.trim() })}
    </span>
  ) : null;
  return (
    <div data-dash-sheet-body dir={dir} className={cn('space-y-4', exp ? 'w-[1080px] p-8' : 'p-4 sm:p-5')} style={{ background: 'var(--dash-bg)', color: 'var(--dash-ink)' }}>
      <header className="space-y-1">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="inline-flex items-center gap-1.5 text-xs font-bold tracking-wide" style={muted}>
            <LogoMark className="size-4" />
            {t('dash.mark')}
          </span>
          {prepared}
        </div>
        <h2 className={cn('font-bold leading-tight', exp ? 'text-3xl' : 'text-xl sm:text-2xl')} dir="auto">{r.title}</h2>
        <p className="text-sm" style={muted} dir="auto">
          <span dir="ltr">{periodDates(r.period.since, r.period.until)}</span> · {t(`dash.periodName.${r.period.preset ?? 'custom'}`)} · {t('dash.updated', { time: time(r.generated_at) })}
        </p>
      </header>

      <div className={cn('grid gap-3', exp ? 'grid-cols-[1.25fr_1fr]' : 'lg:grid-cols-[1.25fr_1fr]')}>
        <MiniMap places={r.places} targetCountry={r.metric.target_country} view={view} onView={onView} interactive={!exp}
          onSelect={onSelect ? (i) => onSelect({ kind: 'place', index: i }) : undefined} tip={tip} />
        <div className="grid grid-cols-2 gap-3 self-start">
          {tile('incidents', t('dash.tile.incidents'), fmtNum(r.totals.incidents), t('dash.tile.ofReports', { n: fmtNum(r.totals.reports) }), t('dash.tip.incidents'),
            onSelect && r.totals.incidents ? () => onSelect({ kind: 'all' }) : undefined)}
          {tile('change', t('dash.tile.change'), <span style={{ color: (r.totals.change_pct ?? 0) > 0 ? 'var(--dash-hot)' : 'var(--dash-ink)' }}>{changeText(r.totals.change_pct, t('dash.tile.none'))}</span>,
            r.totals.previous == null ? t('dash.tile.none') : t('dash.tile.prevCount', { n: fmtNum(r.totals.previous) }), t('dash.tip.change'))}
          {tile('peak', t(`dash.tile.peakTitle.${r.period.unit}`), peak ? <span dir="ltr">{bucketLabel(peak.start, r.period.unit)}</span> : t('dash.tile.none'),
            r.peak ? t('dash.tile.peakCount', { n: fmtNum(r.peak.count) }) : t('dash.tile.none'), t('dash.tip.peak'))}
          {tile('hotspot', t('dash.tile.hotspot'), top ? top.name || t('dash.placeUnknown') : t('dash.tile.none'), top ? t('dash.tile.share', { share: top.share }) : t('dash.tile.none'), t('dash.tip.hotspot'))}
        </div>
      </div>

      {r.totals.incidents === 0 ? (
        <p data-dash-zero className="rounded-lg px-3 py-2 text-sm font-semibold" style={cardStyle}>{t('dash.zero')}</p>
      ) : null}

      <section className={card} style={cardStyle}>
        <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-bold">{t('dash.chart', { unit: t(`dash.unit.${r.period.unit}`) })}</h3>
          <div className="flex gap-3 text-xs" style={muted}>
            <span className="inline-flex items-center gap-1"><span className="size-2.5 rounded-sm" style={{ background: 'var(--dash-accent)' }} />{t('dash.legendCur')}</span>
            {r.totals.previous != null ? <span className="inline-flex items-center gap-1"><span className="w-3.5 border-t-2 border-dashed" style={{ borderColor: 'var(--dash-compare)' }} />{t('dash.legendPrev')}</span> : null}
          </div>
        </div>
        <BarChart buckets={r.buckets} unit={r.period.unit} peak={r.peak?.index ?? null} tip={tip} onSelect={onSelect ? (i) => onSelect({ kind: 'bucket', index: i }) : undefined} />
      </section>

      {r.places.length || r.insights.length ? (
        <div className={cn('grid gap-3', exp ? 'grid-cols-2' : 'lg:grid-cols-2')}>
          {r.places.length ? (
            <section className={card} style={cardStyle}>
              <h3 className="mb-2 text-sm font-bold">{t('dash.hotspots')}</h3>
              <HotspotBars places={r.places} dir={dir} tip={tip} onSelect={onSelect ? (i) => onSelect({ kind: 'place', index: i }) : undefined} />
            </section>
          ) : null}
          {r.insights.length ? (
            <section className={card} style={cardStyle}>
              <h3 className="mb-2 text-sm font-bold">{t('dash.insights')}</h3>
              <ul className="space-y-1.5 text-sm leading-relaxed">
                {r.insights.map((line, i) => (
                  <li key={i} data-insight={i} dir="auto">
                    {'• '}
                    {line.split(/(\[\d+\])/).map((part, k) => {
                      const m = /^\[(\d+)\]$/.exec(part);
                      if (!m) return part;
                      const n = Number(m[1]);
                      return (
                        <button key={k} type="button" data-cite={n} onClick={(e) => (e.stopPropagation(), onSelect?.({ kind: 'incident', n }))}
                          className="mx-0.5 inline-flex h-5 min-w-5 items-center justify-center rounded px-1 align-baseline text-[11px] font-bold"
                          style={{ background: 'var(--dash-target)', color: 'var(--dash-ink)' }}>
                          {n}
                        </button>
                      );
                    })}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      ) : null}

      <p data-dash-method className="text-xs leading-relaxed" style={muted} dir="auto">
        {t('dash.method', { n: fmtNum(r.totals.classified), u: fmtNum(r.totals.unclear) })}
      </p>
    </div>
  );
}
