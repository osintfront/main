import { useCallback, useEffect, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import { tapAction } from '@/lib/askStats';

/** The dashboard's one tooltip: shown by hover (mouse) or a first tap (touch). */
export interface TipApi { shown: string | null; show(key: string, text: string, at: { x: number; y: number }): void; hide(): void }

export function useTip(): { tip: TipApi; text: string; at: { x: number; y: number } | null } {
  const [state, setState] = useState<{ key: string; text: string; at: { x: number; y: number } } | null>(null);
  const show = useCallback((key: string, text: string, at: { x: number; y: number }) => setState({ key, text, at }), []);
  const hide = useCallback(() => setState(null), []);
  useEffect(() => {
    if (!state) return;
    const off = (e: Event) => { if (e.type !== 'keydown' || (e as KeyboardEvent).key === 'Escape') setState(null); };
    window.addEventListener('scroll', off, true);
    window.addEventListener('keydown', off);
    return () => { window.removeEventListener('scroll', off, true); window.removeEventListener('keydown', off); };
  }, [state]);
  return { tip: { shown: state?.key ?? null, show, hide }, text: state?.text ?? '', at: state?.at ?? null };
}

/** Pointer handlers for one mark: hover shows the tip and a click acts (mouse); on touch the first tap
 *  shows the tip and a second tap on the same mark acts. */
export function useMark(tip: TipApi | undefined) {
  const kind = useRef('mouse');
  return useCallback(
    (key: string, text: string, act?: () => void) => ({
      onPointerDown: (e: RPointerEvent) => { kind.current = e.pointerType; },
      onPointerEnter: (e: RPointerEvent) => { if (e.pointerType === 'mouse') tip?.show(key, text, { x: e.clientX, y: e.clientY }); },
      onPointerLeave: (e: RPointerEvent) => { if (e.pointerType === 'mouse' && tip?.shown === key) tip.hide(); },
      onClick: (e: React.MouseEvent) => {
        e.stopPropagation();
        if (tapAction(tip?.shown ?? null, key, kind.current) === 'tip') return tip?.show(key, text, { x: e.clientX, y: e.clientY });
        tip?.hide();
        act?.();
      },
    }),
    [tip],
  );
}

export function TipBox({ text, at }: { text: string; at: { x: number; y: number } | null }) {
  if (!at) return null;
  return (
    <div data-dash-tip role="tooltip" dir="auto" className="pointer-events-none fixed z-[2600] max-w-[260px] -translate-x-1/2 rounded-md px-2 py-1 text-xs font-semibold shadow-lg"
      style={{ left: Math.min(Math.max(at.x, 140), window.innerWidth - 140), top: Math.max(at.y - 44, 8), background: 'var(--dash-ink)', color: 'var(--dash-bg)' }}>
      {text}
    </div>
  );
}
