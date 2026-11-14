import { useI18n } from '@/i18n';
import { fmtNum, type DashResult } from '@/lib/askStats';
import { useMark, type TipApi } from './Tip';

/** Hotspots as horizontal bars growing from the inline start (right in Hebrew). */
export function HotspotBars({ places, dir, onSelect, tip }: { places: DashResult['places']; dir: 'ltr' | 'rtl'; onSelect?: (index: number) => void; tip?: TipApi }) {
  const { t } = useI18n();
  const mark = useMark(tip);
  const max = Math.max(1, ...places.map((p) => p.count));
  return (
    <div className="space-y-1.5" dir={dir}>
      {places.map((p, i) => (
        <div key={i} data-hbar={i} {...mark(`hbar:${i}`, t('dash.tip.hbar', { count: p.count, share: p.share }), onSelect ? () => onSelect(i) : undefined)}
          className="grid cursor-pointer grid-cols-[minmax(0,7.5rem)_1fr_2.5rem] items-center gap-2 text-sm">
          <span className="truncate" dir="auto" style={{ color: 'var(--dash-ink)' }}>{p.other ? t('dash.other') : p.name || t('dash.placeUnknown')}</span>
          <span className="h-2.5 overflow-hidden rounded-full" style={{ background: 'var(--dash-line)' }}>
            <span data-hbar-fill className="block h-full rounded-full" style={{ width: `${(p.count / max) * 100}%`, background: p.other ? 'var(--dash-compare)' : 'var(--dash-hot)' }} />
          </span>
          <span className="text-end font-semibold tabular-nums" style={{ color: 'var(--dash-ink)' }}>{fmtNum(p.count)}</span>
        </div>
      ))}
    </div>
  );
}
