/**
 * Full-screen image viewer (no new tab). Plain DOM so both React components and the
 * Leaflet popups (built without React) can open it. Closes on click, Escape or ×.
 * With an overlay: an Original / Translated switch and the translation boxes over the picture
 * (a tap on a box shows its original).
 */
import { mountOverlay } from './mediaOverlayDom';
import type { OverlayBox } from './mediaOverlay';

export interface LightboxOverlay {
  boxes: OverlayBox[];
  on: boolean;
  labels: { original: string; translated: string; hint: string };
  onChange?: (on: boolean) => void;
}

let open: HTMLElement | null = null;

export function openLightbox(src: string, alt = '', ov?: LightboxOverlay): void {
  closeLightbox();
  const overlay = document.createElement('div');
  overlay.className = 'ofm-lightbox';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  const img = document.createElement('img');
  img.src = src;
  img.alt = alt;
  img.className = 'ofm-lightbox__img';
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'ofm-lightbox__close';
  close.setAttribute('aria-label', 'Close');
  close.textContent = '×';
  overlay.append(img, close);
  let unmount: (() => void) | null = null;
  let pending: (() => void) | null = null; // a mount waiting for the picture to load
  let closed = false;
  if (ov && ov.boxes.length) {
    const bar = document.createElement('div');
    bar.className = 'ofm-ov__switch ofm-ov__switch--viewer';
    bar.addEventListener('click', (e) => e.stopPropagation());
    const hint = document.createElement('p');
    hint.className = 'ofm-ov__hint';
    hint.textContent = ov.labels.hint;
    const btns = (['original', 'translated'] as const).map((mode) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('data-ov-mode', mode);
      b.textContent = mode === 'original' ? ov.labels.original : ov.labels.translated;
      b.addEventListener('click', () => set(mode === 'translated', true));
      bar.append(b);
      return b;
    });
    const set = (on: boolean, user: boolean) => {
      btns[0].setAttribute('aria-pressed', String(!on));
      btns[1].setAttribute('aria-pressed', String(on));
      hint.hidden = !on;
      unmount?.();
      unmount = null;
      if (pending) img.removeEventListener('load', pending);
      pending = null;
      if (on) {
        const go = () => {
          pending = null;
          if (!closed) unmount = mountOverlay(overlay, img, ov.boxes, { fit: 'contain', interactive: true });
        };
        if (img.complete && img.naturalWidth) go();
        else {
          pending = go;
          img.addEventListener('load', go, { once: true });
        }
      }
      if (user) ov.onChange?.(on);
    };
    overlay.append(bar, hint);
    set(ov.on, false);
  }
  const onKey = (e: KeyboardEvent) => e.key === 'Escape' && closeLightbox();
  overlay.addEventListener('click', () => closeLightbox());
  document.addEventListener('keydown', onKey);
  (overlay as HTMLElement & { _off?: () => void })._off = () => {
    document.removeEventListener('keydown', onKey);
    closed = true;
    if (pending) img.removeEventListener('load', pending);
    unmount?.();
  };
  document.body.append(overlay);
  open = overlay;
  close.focus();
}

export function closeLightbox(): void {
  if (!open) return;
  (open as HTMLElement & { _off?: () => void })._off?.();
  open.remove();
  open = null;
}
