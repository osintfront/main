import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Info } from 'lucide-react';
import { useI18n } from '@/i18n';
import { cn } from '@/utils/cn';
import type { InfoTipKey } from '@/lib/infoTips';

/** Sent on window when a tip opens, so every other tip closes (never two open). */
const OPEN_EVENT = 'ofm:infotip-open';
/** Gap to the screen edge and to the (i). */
const EDGE = 8;
const GAP = 4;

/**
 * A small (i) beside a term that is not self-explanatory: one or two lines on what it is.
 * Opens on hover or keyboard focus (desktop) and on tap (phones); Escape or a tap elsewhere closes it.
 * Never place it inside another button or label (a tap on it must not toggle anything): put it
 * beside the control instead, e.g. with <WithTip>.
 *
 * The tooltip is drawn in document.body with a fixed position, so a scrolling panel or a narrow
 * menu cannot cut it; it is kept 8 px inside the screen and goes above the (i) when there is no
 * room below. It sits above dialogs (z 4000), as a tip may be inside one (the filter panel).
 */
export function InfoTip({ text, tip, className, align = 'end' }: { text?: string; tip?: InfoTipKey; className?: string; align?: 'start' | 'end' }) {
  const { t, dir } = useI18n();
  const body = tip ? t(tip) : (text ?? '');
  const [pinned, setPinned] = useState(false);
  const [hover, setHover] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const ref = useRef<HTMLSpanElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const tipRef = useRef<HTMLSpanElement>(null);
  const id = useId();
  const open = pinned || hover;

  const close = useCallback(() => {
    setPinned(false);
    setHover(false);
  }, []);

  // Only one tip open at a time.
  useEffect(() => {
    if (open) window.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: id }));
  }, [open, id]);
  useEffect(() => {
    const onOther = (e: Event) => {
      if ((e as CustomEvent<string>).detail !== id) close();
    };
    window.addEventListener(OPEN_EVENT, onOther);
    return () => window.removeEventListener(OPEN_EVENT, onOther);
  }, [id, close]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (ref.current?.contains(target) || tipRef.current?.contains(target)) return;
      close();
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, close]);

  // Place the tooltip beside the (i), inside the screen; again when the page or a panel scrolls.
  const place = useCallback(() => {
    const btn = btnRef.current;
    const el = tipRef.current;
    if (!btn || !el) return;
    const b = btn.getBoundingClientRect();
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const vw = document.documentElement.clientWidth || window.innerWidth;
    const vh = window.innerHeight;
    // 'end' lines the tooltip's end edge up with the (i) (right in English, left in Hebrew).
    const atRight = (align === 'end') === (dir !== 'rtl');
    let left = atRight ? b.right - w : b.left;
    left = Math.max(EDGE, Math.min(left, vw - EDGE - w));
    let top = b.bottom + GAP;
    if (top + h > vh - EDGE && b.top - GAP - h >= EDGE) top = b.top - GAP - h;
    top = Math.max(EDGE, Math.min(top, vh - EDGE - h));
    setPos((cur) => (cur && cur.left === left && cur.top === top ? cur : { left, top }));
  }, [align, dir]);

  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    place();
  }, [open, place, body]);
  useEffect(() => {
    if (!open) return;
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open, place]);

  return (
    <span ref={ref} className={cn('relative inline-flex shrink-0 align-middle', className)} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
      <button
        ref={btnRef}
        type="button"
        data-info-tip={tip ?? ''}
        aria-label={t('info.label')}
        aria-expanded={open}
        aria-describedby={open ? id : undefined}
        onClick={(e) => {
          e.stopPropagation();
          e.preventDefault();
          if (pinned) close();
          else setPinned(true);
        }}
        onFocus={() => setHover(true)}
        onBlur={() => setHover(false)}
        className="inline-flex size-5 items-center justify-center rounded-full text-slate-400 hover:text-sky-600 focus-visible:outline-2 focus-visible:outline-sky-500 dark:text-slate-500 dark:hover:text-sky-400"
      >
        <Info className="size-3.5" aria-hidden />
      </button>
      {open
        ? createPortal(
            <span
              ref={tipRef}
              id={id}
              role="tooltip"
              data-info-tooltip
              dir={dir}
              onClick={(e) => e.stopPropagation()}
              style={{ position: 'fixed', left: pos?.left ?? 0, top: pos?.top ?? 0, visibility: pos ? 'visible' : 'hidden' }}
              className="z-[4000] w-60 max-w-[calc(100vw-1rem)] whitespace-normal rounded-lg bg-slate-900 px-2.5 py-2 text-start text-xs font-normal normal-case leading-relaxed tracking-normal text-white shadow-lg dark:bg-slate-700"
            >
              {body}
            </span>,
            document.body,
          )
        : null}
    </span>
  );
}

/** A control with its (i) beside it: the control fills the row, the (i) sits at its end. */
export function WithTip({ tip, children, className }: { tip: InfoTipKey; children: ReactNode; className?: string }) {
  return (
    <div className={cn('flex items-center gap-1', className)}>
      <div className="min-w-0 flex-1">{children}</div>
      <InfoTip tip={tip} />
    </div>
  );
}
