import { useEffect, useState } from 'react';
import { useI18n } from '@/i18n';
import { OFI_TEXT } from '@/content/ofi';
import { cn } from '@/utils/cn';

/**
 * Risk level for a 24 h probability, set against the base rate (~2% on an ordinary day):
 * up to 2% routine · 2–5% elevated · 5–15% high · above 15% critical. Used by the gauge, the avatar
 * and the legend. The probability itself is never changed — only how it is coloured and named.
 */
export type OfiMood = 'calm' | 'alert' | 'high' | 'critical';
export const MOOD_COLOR: Record<OfiMood, string> = { calm: '#0e9f8b', alert: '#d98a06', high: '#e0592a', critical: '#b4161b' };
export const LEVELS: { mood: OfiMood; from: number; to: number | null }[] = [
  { mood: 'calm', from: 0, to: 0.02 },
  { mood: 'alert', from: 0.02, to: 0.05 },
  { mood: 'high', from: 0.05, to: 0.15 },
  { mood: 'critical', from: 0.15, to: null },
];
export function moodOf(p: number | null | undefined): OfiMood {
  if (p == null) return 'calm';
  return p <= 0.02 ? 'calm' : p < 0.05 ? 'alert' : p < 0.15 ? 'high' : 'critical';
}

/**
 * The same 24 h estimate over a longer window, assuming the daily risk stays as it is:
 * P(at least once in n days) = 1 − (1 − p)^n. Not a separate forecast.
 */
export const overDays = (p24: number, days: number) => 1 - Math.pow(1 - Math.min(Math.max(p24, 0), 1), Math.max(days, 0));

/** Days left until the end of this month (rolls to next month in the last week), and that month. */
export function monthWindow(now = new Date()): { days: number; end: Date } {
  let end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
  if ((end.getTime() - now.getTime()) / 86_400_000 < 7) end = new Date(now.getFullYear(), now.getMonth() + 2, 0, 23, 59, 59);
  return { days: (end.getTime() - now.getTime()) / 86_400_000, end };
}

export const pct = (p: number, digits = 1) => `${(p * 100).toFixed(digits).replace(/\.0$/, '')}%`;

function usePrefersReducedMotion(): boolean {
  const [reduce, setReduce] = useState(() => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false);
  useEffect(() => {
    const m = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (!m) return;
    const on = () => setReduce(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);
  return reduce;
}

export { OfiAvatar } from './OfiAvatar';

/**
 * Half-circle gauge 0–100%. The needle settles once on first show (not with reduced motion).
 * `band` draws the confidence interval as a lighter arc. `blurred` = no number (locked / guest).
 */
export function Gauge({
  value,
  band,
  size = 220,
  blurred = false,
  label,
}: {
  value: number | null;
  band?: [number, number] | null;
  size?: number;
  blurred?: boolean;
  label?: string;
}) {
  const reduce = usePrefersReducedMotion();
  const [shown, setShown] = useState(reduce ? value ?? 0 : 0);
  useEffect(() => {
    if (reduce) return setShown(value ?? 0);
    const id = requestAnimationFrame(() => setShown(value ?? 0));
    return () => cancelAnimationFrame(id);
  }, [value, reduce]);
  const mood = moodOf(value);
  const c = MOOD_COLOR[mood];
  const r = 80;
  const len = Math.PI * r;
  // Position along the arc: the gauge reads 0% at the start edge and 100% at the end edge.
  const at = (p: number) => len * Math.min(1, Math.max(0, p));
  const angle = Math.PI * (1 - Math.min(1, Math.max(0, shown)));
  const nx = 100 + (r - 12) * Math.cos(angle);
  const ny = 100 - (r - 12) * Math.sin(angle);
  const arc = 'M20 100 A80 80 0 0 1 180 100';
  return (
    <figure className="m-0 inline-flex flex-col items-center" style={{ width: size }} dir="ltr">
      <svg viewBox="0 0 200 116" width={size} height={size * 0.58} role="img" aria-label={label ?? (value == null ? 'OFI' : pct(value))}>
        <path d={arc} fill="none" className="stroke-slate-200 dark:stroke-slate-800" strokeWidth="14" strokeLinecap="round" />
        {!blurred && band ? (
          <path d={arc} fill="none" stroke={c} strokeOpacity="0.22" strokeWidth="14"
            strokeDasharray={`${at(band[1]) - at(band[0])} ${len}`} strokeDashoffset={-at(band[0])} />
        ) : null}
        {!blurred && value != null ? (
          <path d={arc} fill="none" stroke={c} strokeWidth="14" strokeLinecap="round"
            strokeDasharray={`${Math.max(at(shown), 0.01)} ${len}`}
            style={{ transition: reduce ? undefined : 'stroke-dasharray 900ms cubic-bezier(.2,.8,.2,1)' }} />
        ) : null}
        {!blurred && value != null ? (
          <line x1="100" y1="100" x2={nx} y2={ny} stroke="currentColor" strokeWidth="3" strokeLinecap="round"
            className="text-slate-700 dark:text-slate-200" style={{ transition: reduce ? undefined : 'all 900ms cubic-bezier(.2,.8,.2,1)' }} />
        ) : null}
        <circle cx="100" cy="100" r="5" className="fill-slate-700 dark:fill-slate-200" />
        <text x="22" y="114" fontSize="9" textAnchor="middle" className="fill-slate-400">0</text>
        <text x="178" y="114" fontSize="9" textAnchor="middle" className="fill-slate-400">100</text>
      </svg>
      <figcaption className={cn('-mt-1 text-4xl font-bold tabular-nums tracking-tight text-slate-900 dark:text-white', blurred && 'select-none blur-sm')}>
        {blurred || value == null ? '??%' : pct(value)}
      </figcaption>
      {!blurred && value != null ? <LevelPill mood={mood} /> : null}
    </figure>
  );
}

/** Tiny line chart of [time, value 0..1] points. */
export function Sparkline({ points, width = 120, height = 32, className }: { points: [string, number][]; width?: number; height?: number; className?: string }) {
  if (points.length < 2) return null;
  const xs = points.map(([t]) => new Date(t).getTime());
  const ys = points.map(([, v]) => v);
  const x0 = Math.min(...xs), x1 = Math.max(...xs) || x0 + 1;
  const y0 = Math.min(...ys), y1 = Math.max(...ys);
  const pad = 2;
  const sx = (x: number) => pad + ((x - x0) / Math.max(1, x1 - x0)) * (width - 2 * pad);
  const sy = (y: number) => height - pad - ((y - y0) / Math.max(1e-6, y1 - y0)) * (height - 2 * pad);
  const d = points.map(([t, v], i) => `${i ? 'L' : 'M'}${sx(new Date(t).getTime()).toFixed(1)} ${sy(v).toFixed(1)}`).join(' ');
  return (
    <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} className={className} aria-hidden style={{ direction: "ltr" }}>
      <path d={d} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

export function BetaBadge() {
  const { lang } = useI18n();
  return (
    <span className="inline-flex h-6 items-center rounded-full bg-amber-100 px-2.5 text-xs font-semibold text-amber-900 ring-1 ring-amber-300 dark:bg-amber-400/15 dark:text-amber-200 dark:ring-amber-400/30">
      {lang === 'he' ? 'ניסיוני (Beta)' : 'Experimental (Beta)'}
    </span>
  );
}

/** The full disclaimer box (top of every OFI page). */
export function OfiDisclaimer() {
  const { lang } = useI18n();
  const tx = OFI_TEXT[lang === 'he' ? 'he' : 'en'];
  return (
    <aside role="note" className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm leading-relaxed text-amber-950 dark:border-amber-400/30 dark:bg-amber-400/10 dark:text-amber-100">
      {tx.disclaimer}
    </aside>
  );
}

/** The short disclaimer under every gauge. */
export function OfiDisclaimerShort({ className }: { className?: string }) {
  const { lang } = useI18n();
  return <p className={cn('text-xs leading-relaxed text-slate-500 dark:text-slate-400', className)}>{OFI_TEXT[lang === 'he' ? 'he' : 'en'].disclaimerShort}</p>;
}

function LevelPill({ mood }: { mood: OfiMood }) {
  const { t } = useI18n();
  return (
    <span className="mt-1 inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-bold text-white" style={{ background: MOOD_COLOR[mood] }}>
      {t(`ofi.level.${mood}`)}
    </span>
  );
}

/** Legend for the colours: the four levels with their ranges; the current one is highlighted. */
export function OfiLegend({ value, className }: { value: number | null; className?: string }) {
  const { t } = useI18n();
  const cur = value == null ? null : moodOf(value);
  const range = (l: (typeof LEVELS)[number]) =>
    l.to == null ? `${pct(l.from, 0)}+` : l.from === 0 ? `≤ ${pct(l.to, 0)}` : `${pct(l.from, 0)}–${pct(l.to, 0)}`;
  return (
    <div className={className}>
      <p className="text-xs font-semibold text-slate-600 dark:text-slate-300">{t('ofi.legendTitle')}</p>
      <ul className="mt-1.5 grid grid-cols-2 gap-1.5 sm:grid-cols-4">
        {LEVELS.map((l) => (
          <li key={l.mood}
            className={cn('flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs ring-1',
              cur === l.mood ? 'font-bold text-slate-900 ring-2 dark:text-white' : 'text-slate-600 ring-slate-200 dark:text-slate-300 dark:ring-slate-700')}
            style={cur === l.mood ? { boxShadow: `inset 0 0 0 2px ${MOOD_COLOR[l.mood]}` } : undefined}
            aria-current={cur === l.mood ? 'true' : undefined}>
            <span className="size-2.5 shrink-0 rounded-full" style={{ background: MOOD_COLOR[l.mood] }} aria-hidden />
            <span className="min-w-0">{t(`ofi.level.${l.mood}`)} <bdi dir="ltr" className="tabular-nums text-slate-500 dark:text-slate-400">{range(l)}</bdi></span>
          </li>
        ))}
      </ul>
      <p className="mt-1.5 text-[11px] leading-snug text-slate-500 dark:text-slate-400">{t('ofi.legendNote')}</p>
    </div>
  );
}

/** "x times the usual": the 24 h estimate against the base rate. */
export function TimesUsual({ p, base, className }: { p: number | null; base: number | null | undefined; className?: string }) {
  const { t } = useI18n();
  if (p == null || !base) return null;
  const x = p / base;
  const label = x >= 1.15 ? t('ofi.times', { x: x >= 10 ? Math.round(x) : x.toFixed(1).replace(/\.0$/, '') })
    : x <= 0.87 ? t('ofi.timesBelow') : t('ofi.timesUsual');
  return (
    <p className={cn('text-sm font-semibold', className)} style={{ color: MOOD_COLOR[moodOf(p)] }}>
      {label} <span className="font-normal text-slate-500 dark:text-slate-400">{t('ofi.baseIs', { b: pct(base) })}</span>
    </p>
  );
}

/** The same estimate over 24 h, 7 days and until the end of the month. */
export function OfiHorizons({ p, compact = false, className }: { p: number | null; compact?: boolean; className?: string }) {
  const { t, lang } = useI18n();
  if (p == null) return null;
  const m = monthWindow();
  const month = m.end.toLocaleDateString(lang === 'he' ? 'he-IL' : 'en-GB', { month: 'long' });
  const cells: [string, number][] = [
    [t('ofi.h24'), p],
    [t('ofi.h7'), overDays(p, 7)],
    [t('ofi.hMonth', { month }), overDays(p, m.days)],
  ];
  return (
    <div className={className}>
      <dl className="grid grid-cols-3 gap-2">
        {cells.map(([k, v], i) => (
          <div key={k} className={cn('rounded-xl px-2 py-2 text-center ring-1 ring-slate-200 dark:ring-slate-700', i === 0 && 'bg-slate-50 dark:bg-slate-800/60')}>
            <dt className="text-[11px] font-medium text-slate-500 dark:text-slate-400">{k}</dt>
            <dd className={cn('font-bold tabular-nums text-slate-900 dark:text-white', compact ? 'text-lg' : 'text-2xl')}>{pct(v, v >= 0.1 ? 0 : 1)}</dd>
          </div>
        ))}
      </dl>
      {compact ? null : <p className="mt-1.5 text-[11px] leading-snug text-slate-500 dark:text-slate-400">{t('ofi.horizonNote')}</p>}
    </div>
  );
}
