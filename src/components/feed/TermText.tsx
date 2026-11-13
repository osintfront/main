import { useEffect, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { Lock } from 'lucide-react';
import type { EventTerm, InnerTerm, Segment } from '@/lib/deepTerms';
import { useI18n } from '@/i18n';
import { hasFeature, usePlanVersion } from '@/lib/plans';
import { cn } from '@/utils/cn';

interface Pick { items: InnerTerm[]; x: number; top: number; bottom: number }

/**
 * Event text with its terms as links to their deep-analysis entry: a solid underline when the
 * entry exists, dotted when it is not written yet, a lock for readers without the feature.
 * A link that holds other terms ("כוחות היבשה של משמרות המהפכה") opens a menu to choose which entry
 * to read: the full phrase first, then the inner terms. Readers without the feature get the gate
 * straight away, as for any link.
 * Plain text only — never HTML. The parent works out `parts` (linkSegments / segmentsInOrder) in its own
 * render, so a term links once across the window's texts even when React renders twice.
 */
export function TermText({ parts, onTerm }: { parts: Segment[]; onTerm: (t: EventTerm) => void }) {
  usePlanVersion();
  const { t } = useI18n();
  const locked = !hasFeature(undefined, 'deep_analysis');
  const [pick, setPick] = useState<Pick | null>(null);

  // Outside tap, scroll or Escape closes the menu; Escape does not reach the event window under it.
  useEffect(() => {
    if (!pick) return;
    const off = (e: Event) => {
      if (e instanceof KeyboardEvent && e.key !== 'Escape') return;
      if (e.type === 'pointerdown' && e.target instanceof Element && e.target.closest('[data-term-menu]')) return;
      if (e instanceof KeyboardEvent) e.stopPropagation();
      setPick(null);
    };
    document.addEventListener('keydown', off, true);
    document.addEventListener('pointerdown', off, true);
    document.addEventListener('scroll', off, true);
    window.addEventListener('resize', off);
    return () => {
      document.removeEventListener('keydown', off, true);
      document.removeEventListener('pointerdown', off, true);
      document.removeEventListener('scroll', off, true);
      window.removeEventListener('resize', off);
    };
  }, [pick]);

  const choose = (term: EventTerm) => {
    setPick(null);
    onTerm(term);
  };

  // Under the link; above it when there is no room below.
  const menuStyle = (p: Pick): CSSProperties => {
    const w = Math.min(280, window.innerWidth - 16);
    const left = Math.max(8, Math.min(p.x - w / 2, window.innerWidth - w - 8));
    const below = window.innerHeight - p.bottom > 60 + p.items.length * 44;
    return below ? { left, width: w, top: p.bottom + 6 } : { left, width: w, bottom: window.innerHeight - p.top + 6 };
  };

  return (
    <>
      {parts.map((p, i) =>
        typeof p === 'string' ? (
          p
        ) : (
          <button
            key={`${p.term.key}-${i}`}
            type="button"
            data-term={p.term.key}
            data-ready={p.term.entry ? '1' : '0'}
            aria-haspopup={p.inner && !locked ? 'menu' : undefined}
            onClick={(e) => {
              e.stopPropagation();
              if (!p.inner?.length || locked) return onTerm(p.term);
              const r = e.currentTarget.getBoundingClientRect();
              setPick({ items: [{ text: p.text, term: p.term }, ...p.inner], x: r.left + r.width / 2, top: r.top, bottom: r.bottom });
            }}
            className={cn(
              'relative inline cursor-pointer rounded-sm px-0 align-baseline font-[inherit] text-sky-700 underline underline-offset-2 hover:bg-sky-50 focus-visible:outline-2 focus-visible:outline-sky-500 dark:text-sky-400 dark:hover:bg-sky-500/10',
              'after:absolute after:-inset-y-2 after:inset-x-0 after:content-[""]',
              p.term.entry ? 'decoration-solid' : 'decoration-dotted',
            )}
          >
            {p.text}
            {locked ? <Lock className="ms-0.5 inline size-3 align-[-1px] opacity-70" aria-hidden /> : null}
          </button>
        ),
      )}
      {pick
        ? createPortal(
            <div
              role="menu"
              data-term-menu
              aria-label={t('deep.pick')}
              className="fixed z-[3050] rounded-lg bg-white p-1 shadow-xl ring-1 ring-slate-900/10 dark:bg-slate-900 dark:ring-white/10"
              style={menuStyle(pick)}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="px-3 pb-1 pt-1.5 text-xs font-semibold text-slate-500 dark:text-slate-400">{t('deep.pick')}</div>
              {pick.items.map((it, n) => (
                <button
                  key={it.term.key}
                  type="button"
                  role="menuitem"
                  autoFocus={n === 0}
                  data-term={it.term.key}
                  onClick={() => choose(it.term)}
                  className="block w-full rounded-md px-3 py-2.5 text-start text-sm font-semibold text-sky-700 hover:bg-sky-50 focus-visible:bg-sky-50 focus-visible:outline-none dark:text-sky-400 dark:hover:bg-sky-500/10 dark:focus-visible:bg-sky-500/10"
                >
                  <span className={cn('underline underline-offset-2', it.term.entry ? 'decoration-solid' : 'decoration-dotted')}>{it.text}</span>
                </button>
              ))}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
