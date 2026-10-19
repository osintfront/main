import type { ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, Info, Loader2, XCircle } from 'lucide-react';
import { cn } from '@/utils/cn';

export function Spinner({ className, label }: { className?: string; label?: string }) {
  return (
    <span role="status" className="inline-flex items-center gap-2">
      <Loader2 className={cn('size-4 animate-spin', className)} aria-hidden />
      {label ? <span>{label}</span> : <span className="sr-only">Loading</span>}
    </span>
  );
}

export function FullScreenLoader({ label }: { label: string }) {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-slate-50 text-sm text-slate-600 dark:bg-slate-950 dark:text-slate-300">
      <Spinner label={label} className="size-5 text-sky-500" />
    </div>
  );
}

type Tone = 'info' | 'success' | 'warning' | 'error';

const TONES: Record<Tone, { box: string; Icon: typeof Info }> = {
  info: { box: 'bg-sky-50 text-sky-900 ring-sky-600/20 dark:bg-sky-500/10 dark:text-sky-100 dark:ring-sky-400/20', Icon: Info },
  success: {
    box: 'bg-emerald-50 text-emerald-900 ring-emerald-600/20 dark:bg-emerald-500/10 dark:text-emerald-100 dark:ring-emerald-400/20',
    Icon: CheckCircle2,
  },
  warning: {
    box: 'bg-amber-50 text-amber-900 ring-amber-600/25 dark:bg-amber-500/10 dark:text-amber-100 dark:ring-amber-400/25',
    Icon: AlertTriangle,
  },
  error: { box: 'bg-red-50 text-red-900 ring-red-600/20 dark:bg-red-500/10 dark:text-red-100 dark:ring-red-400/25', Icon: XCircle },
};

export function Alert({ tone = 'info', children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  const { box, Icon } = TONES[tone];
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={cn('flex items-start gap-2.5 rounded-lg px-3 py-2.5 text-sm ring-1 ring-inset', box, className)}
    >
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
