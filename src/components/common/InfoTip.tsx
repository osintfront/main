import { useEffect, useId, useRef, useState } from 'react';
import { Info } from 'lucide-react';
import { useI18n } from '@/i18n';
import { cn } from '@/utils/cn';

/**
 * A small (i) beside a term that is not self-explanatory: one or two lines on what it is.
 * Opens on hover or keyboard focus (desktop) and on tap (phones); Escape or a tap elsewhere closes it.
 * Never place it inside another button: put it beside the header button instead.
 */
export function InfoTip({ text, className, align = 'end' }: { text: string; className?: string; align?: 'start' | 'end' }) {
  const { t } = useI18n();
  const [pinned, setPinned] = useState(false);
  const [hover, setHover] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  const id = useId();
  const open = pinned || hover;

  useEffect(() => {
    if (!pinned) return;
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setPinned(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setPinned(false);
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [pinned]);

  return (
    <span ref={ref} className={cn('relative inline-flex align-middle', className)} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
      <button
        type="button"
        data-info-tip
        aria-label={t('info.label')}
        aria-expanded={open}
        aria-describedby={open ? id : undefined}
        onClick={(e) => {
          e.stopPropagation();
          setPinned((v) => !v);
        }}
        onFocus={() => setHover(true)}
        onBlur={() => setHover(false)}
        className="inline-flex size-5 items-center justify-center rounded-full text-slate-400 hover:text-sky-600 focus-visible:outline-2 focus-visible:outline-sky-500 dark:text-slate-500 dark:hover:text-sky-400"
      >
        <Info className="size-3.5" aria-hidden />
      </button>
      {open ? (
        <span
          id={id}
          role="tooltip"
          className={cn(
            'absolute top-full z-[1300] mt-1 w-60 max-w-[calc(100vw-2rem)] whitespace-normal rounded-lg bg-slate-900 px-2.5 py-2 text-start text-xs font-normal normal-case leading-relaxed tracking-normal text-white shadow-lg dark:bg-slate-700',
            align === 'end' ? 'end-0' : 'start-0',
          )}
        >
          {text}
        </span>
      ) : null}
    </span>
  );
}
