import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cn } from '@/utils/cn';

interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label'> {
  /** Accessible name — also shown as the tooltip. */
  label: string;
  children: ReactNode;
  variant?: 'ghost' | 'map' | 'solid';
  /** bottom-end keeps tooltips of buttons at the screen edge inside the viewport. */
  tooltipSide?: 'bottom' | 'bottom-end' | 'end' | 'top';
}

const VARIANTS = {
  ghost:
    'text-slate-600 hover:bg-slate-900/5 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-white/10 dark:hover:text-white',
  map: 'bg-white/95 text-slate-700 ring-1 ring-slate-900/10 hover:bg-white hover:text-slate-900 dark:bg-slate-900/90 dark:text-slate-200 dark:ring-white/10 dark:hover:bg-slate-800 dark:hover:text-white backdrop-blur',
  solid: 'bg-sky-600 text-white hover:bg-sky-500',
} as const;

const TOOLTIP_SIDES = {
  bottom: 'top-full mt-2 start-1/2 -translate-x-1/2 rtl:translate-x-1/2',
  'bottom-end': 'top-full mt-2 end-0',
  end: 'start-full ms-2 top-1/2 -translate-y-1/2',
  top: 'bottom-full mb-2 start-1/2 -translate-x-1/2 rtl:translate-x-1/2',
} as const;

/** Icon-only button with an accessible name and a hover/focus tooltip. */
export function IconButton({
  label,
  children,
  variant = 'ghost',
  tooltipSide = 'end',
  className,
  type = 'button',
  ...rest
}: IconButtonProps) {
  return (
    <span className={cn('group relative inline-flex', className)}>
      <button
        type={type}
        aria-label={label}
        className={cn(
          'inline-flex size-9 items-center justify-center rounded-lg transition-colors disabled:cursor-not-allowed disabled:opacity-40',
          'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500',
          VARIANTS[variant],
        )}
        {...rest}
      >
        {children}
      </button>
      <span
        role="tooltip"
        className={cn(
          // display:none while idle — an invisible-but-laid-out tooltip would widen the page on phones.
          'pointer-events-none absolute z-[1200] hidden whitespace-nowrap rounded-md bg-slate-900 px-2 py-1 text-xs font-medium text-white shadow-lg',
          'group-hover:block group-focus-within:block dark:bg-slate-700',
          TOOLTIP_SIDES[tooltipSide],
        )}
      >
        {label}
      </span>
    </span>
  );
}
