/**
 * Full-screen image viewer (no new tab). Plain DOM so both React components and the
 * Leaflet popups (built without React) can open it. Closes on click, Escape or ×.
 */
let open: HTMLElement | null = null;

export function openLightbox(src: string, alt = ''): void {
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
  const onKey = (e: KeyboardEvent) => e.key === 'Escape' && closeLightbox();
  overlay.addEventListener('click', () => closeLightbox());
  document.addEventListener('keydown', onKey);
  (overlay as HTMLElement & { _off?: () => void })._off = () => document.removeEventListener('keydown', onKey);
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
