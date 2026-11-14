import { useI18n } from '@/i18n';
import { bucketLabel, fmtNum, type DashResult, type Unit } from '@/lib/askStats';
import { niceMax } from '@/lib/dashGeometry';
import { useMark, type TipApi } from './Tip';
import { useDashColors } from './dashColors';

const W = 640, H = 240, L = 34, R = 8, T = 10, B = 28;

/** Incidents per bucket (bars) and the previous period (dashed line). Time runs left to right in every language. */
export function BarChart({ buckets, unit, peak, onSelect, tip }: { buckets: DashResult['buckets']; unit: Unit; peak: number | null; onSelect?: (index: number) => void; tip?: TipApi }) {
  const { t } = useI18n();
  const mark = useMark(tip);
  const C = useDashColors();
  const n = Math.max(buckets.length, 1);
  const top = niceMax(Math.max(0, ...buckets.map((b) => Math.max(b.count, b.prev ?? 0))));
  const cw = (W - L - R) / n;
  const bw = Math.max(2, Math.min(28, cw * 0.62));
  const y = (v: number) => T + (H - T - B) * (1 - v / top);
  const hasPrev = buckets.some((b) => b.prev != null);
  const every = Math.ceil(n / 8);
  const ticks = [0, top / 2, top];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full" style={{ direction: 'ltr' }} role="img" aria-label={t('dash.chart', { unit: t(`dash.unit.${unit}`) })}>
      {ticks.map((v) => (
        <g key={v}>
          <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} stroke={C.line} strokeWidth={1} />
          <text x={L - 6} y={y(v) + 4} textAnchor="end" fontSize={11} fill={C.muted}>{fmtNum(v)}</text>
        </g>
      ))}
      <line data-baseline x1={L} x2={W - R} y1={y(0)} y2={y(0)} stroke={C.muted} strokeWidth={1} />
      {buckets.map((b, i) => {
        const label = bucketLabel(b.start, unit);
        const text = b.prev == null ? t('dash.tip.barShort', { label, count: b.count }) : t('dash.tip.barFull', { label, count: b.count, prev: b.prev });
        const h = Math.max(0, y(0) - y(b.count));
        return (
          <g key={b.start} {...mark(`bar:${i}`, text, b.count && onSelect ? () => onSelect(i) : undefined)} className="cursor-pointer">
            <rect x={L + i * cw} y={T} width={cw} height={H - T - B} fill="transparent" />
            <rect data-bar={i} x={L + i * cw + (cw - bw) / 2} y={y(b.count)} width={bw} height={h} rx={Math.min(3, bw / 3)}
              fill={C.accent} opacity={peak === i || peak == null ? 1 : 0.82} />
            {i % every === 0 ? <text x={L + i * cw + cw / 2} y={H - 9} textAnchor="middle" fontSize={11} fill={C.muted}>{label}</text> : null}
          </g>
        );
      })}
      {hasPrev ? (
        <polyline data-prev-line fill="none" stroke={C.compare} strokeWidth={2} strokeDasharray="4 4" strokeLinejoin="round" pointerEvents="none"
          points={buckets.map((b, i) => `${(L + i * cw + cw / 2).toFixed(1)},${y(b.prev ?? 0).toFixed(1)}`).join(' ')} />
      ) : null}
    </svg>
  );
}
