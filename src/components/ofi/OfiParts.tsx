import { useEffect, useId, useState } from 'react';
import { useI18n } from '@/i18n';
import { OFI_TEXT } from '@/content/ofi';
import { cn } from '@/utils/cn';

/** Risk level → OFI's mood and colour (used only by the gauge and the avatar). */
export type OfiMood = 'calm' | 'alert' | 'high';
export const MOOD_COLOR: Record<OfiMood, string> = { calm: '#0e9f8b', alert: '#d98a06', high: '#d6342c' };
export function moodOf(p: number | null | undefined): OfiMood {
  if (p == null) return 'calm';
  return p < 0.1 ? 'calm' : p < 0.3 ? 'alert' : 'high';
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

/**
 * OFI — a cute little soldier: olive helmet with a radar dish on top (it sweeps), a star on the front,
 * big eyes. The mood sets the ring colour, the star colour and the face: calm = relaxed smile,
 * alert = wide eyes, high = wide eyes, frown and a quicker radar. Original artwork.
 */
export function OfiAvatar({ mood = 'calm', size = 44, className }: { mood?: OfiMood; size?: number; className?: string }) {
  const c = MOOD_COLOR[mood];
  const reduce = usePrefersReducedMotion();
  const id = useId();
  const spin = reduce ? undefined : `ofi-sweep ${mood === 'high' ? 1.6 : mood === 'alert' ? 3 : 6}s linear infinite`;
  return (
    <svg viewBox="0 0 48 48" width={size} height={size} className={className} role="img" aria-label={`OFI (${mood})`}>
      <defs>
        <clipPath id={`${id}-c`}><circle cx="24" cy="24" r="21" /></clipPath>
      </defs>
      <circle cx="24" cy="24" r="22" fill="#e8efe2" stroke={c} strokeWidth="2.5" />
      <g clipPath={`url(#${id}-c)`}>
        <path d="M6 48 Q8 37 24 36 Q40 37 42 48 Z" fill="#5b6b3a" />
        <path d="M20 36 L24 41 L28 36 Z" fill="#f0c9a0" />
      </g>
      <ellipse cx="24" cy="27" rx="11" ry="10" fill="#f6d3ae" />
      <path d="M11.5 24 Q11 9 24 8.5 Q37 9 36.5 24 Q24 20 11.5 24 Z" fill="#6f8040" stroke="#4a5a2a" strokeWidth="1" />
      <path d="M9.5 24.5 Q24 19.5 38.5 24.5" fill="none" stroke="#4a5a2a" strokeWidth="2.4" strokeLinecap="round" />
      <path d="M24 11.2 l1.2 2.5 2.7.3-2 1.9.6 2.7-2.5-1.4-2.5 1.4.6-2.7-2-1.9 2.7-.3z" fill={c} stroke="#fff" strokeWidth=".5" />
      <g style={{ transformOrigin: '33px 9px', animation: spin }}>
        <path d="M33 9 L33 4.2" stroke="#33401c" strokeWidth="1.4" strokeLinecap="round" />
        <circle cx="33" cy="4" r="1.6" fill={c} />
      </g>
      <circle cx="19.5" cy="27.5" r={mood === 'calm' ? 2 : 2.6} fill="#fff" stroke="#33401c" strokeWidth=".8" />
      <circle cx="28.5" cy="27.5" r={mood === 'calm' ? 2 : 2.6} fill="#fff" stroke="#33401c" strokeWidth=".8" />
      <circle cx="19.5" cy="27.8" r="1.2" fill="#1e2a10" />
      <circle cx="28.5" cy="27.8" r="1.2" fill="#1e2a10" />
      {mood === 'high' ? (
        <>
          <path d="M16.5 23.6 L21.5 25" stroke="#4a3a20" strokeWidth="1.3" strokeLinecap="round" />
          <path d="M31.5 23.6 L26.5 25" stroke="#4a3a20" strokeWidth="1.3" strokeLinecap="round" />
        </>
      ) : null}
      {mood === 'calm' ? (
        <path d="M20.5 32.2 Q24 35 27.5 32.2" fill="none" stroke="#8a4a32" strokeWidth="1.4" strokeLinecap="round" />
      ) : mood === 'alert' ? (
        <path d="M21.5 33 L26.5 33" stroke="#8a4a32" strokeWidth="1.4" strokeLinecap="round" />
      ) : (
        <path d="M20.5 34 Q24 31.2 27.5 34" fill="none" stroke="#8a4a32" strokeWidth="1.4" strokeLinecap="round" />
      )}
      <circle cx="16" cy="31" r="1.6" fill="#f08a7a" fillOpacity=".45" />
      <circle cx="32" cy="31" r="1.6" fill="#f08a7a" fillOpacity=".45" />
      <style>{'@keyframes ofi-sweep{to{transform:rotate(360deg)}}'}</style>
    </svg>
  );
}

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
