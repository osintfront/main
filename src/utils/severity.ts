import type { Severity } from '@/types/event';

/** Tailwind classes for severity indicators. Text colours meet WCAG AA on both themes. */
export const SEVERITY_STYLES: Record<Severity, { dot: string; badge: string; bar: string }> = {
  low: {
    dot: 'bg-emerald-500',
    badge: 'bg-emerald-50 text-emerald-800 ring-emerald-600/20 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-400/25',
    bar: 'bg-emerald-500',
  },
  medium: {
    dot: 'bg-amber-500',
    badge: 'bg-amber-50 text-amber-800 ring-amber-600/20 dark:bg-amber-500/10 dark:text-amber-300 dark:ring-amber-400/25',
    bar: 'bg-amber-500',
  },
  high: {
    dot: 'bg-orange-500',
    badge: 'bg-orange-50 text-orange-800 ring-orange-600/20 dark:bg-orange-500/10 dark:text-orange-300 dark:ring-orange-400/25',
    bar: 'bg-orange-500',
  },
  critical: {
    dot: 'bg-red-500',
    badge: 'bg-red-50 text-red-800 ring-red-600/25 dark:bg-red-500/15 dark:text-red-300 dark:ring-red-400/30',
    bar: 'bg-red-600',
  },
};
