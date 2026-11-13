/**
 * The translation boxes drawn over a picture — plain DOM, so the React picture (through a ref) and
 * the full-screen viewer (built without React) share it. Text goes in with textContent only. The
 * picture itself is never touched.
 */
import { boxPx, fitFont, imageRect, textDir, type OverlayBox } from './mediaOverlay';

export function mountOverlay(host: HTMLElement, img: HTMLImageElement, boxes: OverlayBox[], o: { fit: 'cover' | 'contain'; interactive: boolean }): () => void {
  const layer = document.createElement('div');
  layer.setAttribute('data-ov-layer', '');
  layer.className = 'ofm-ov';
  const els = boxes.map((b) => {
    const el = document.createElement('div');
    el.setAttribute('data-ov-box', '');
    el.className = 'ofm-ov__box';
    if (o.interactive) {
      el.style.pointerEvents = 'auto';
      el.style.cursor = 'pointer';
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        const orig = el.getAttribute('data-ov-state') !== 'orig';
        paint(el, b, orig);
        place();
      });
    }
    layer.append(el);
    return el;
  });
  const paint = (el: HTMLElement, b: OverlayBox, orig: boolean) => {
    const text = orig ? b.orig : b.text;
    el.dataset.text = text;
    el.dataset.mode = orig ? 'orig' : 'tr';
    el.dir = orig ? textDir(b.orig) : b.dir;
  };
  els.forEach((el, i) => paint(el, boxes[i], false));

  const place = () => {
    const hr = host.getBoundingClientRect();
    const ir = img.getBoundingClientRect();
    const r = imageRect({ w: img.naturalWidth, h: img.naturalHeight }, { w: ir.width, h: ir.height }, o.fit);
    const shifted = { ...r, left: r.left + ir.left - hr.left, top: r.top + ir.top - hr.top };
    els.forEach((el, i) => {
      const p = boxPx(boxes[i].box, shifted);
      Object.assign(el.style, { left: `${p.left}px`, top: `${p.top}px`, width: `${p.width}px`, height: `${p.height}px` });
      const text = el.dataset.text ?? '';
      const fs = fitFont(p.width, p.height, text.length);
      if (fs == null) {
        el.textContent = '';
        el.style.fontSize = '';
        el.setAttribute('data-ov-state', 'frame');
      } else {
        el.textContent = text;
        el.setAttribute('data-ov-state', el.dataset.mode ?? 'tr');
        // The estimate first, then shrink on the real layout until nothing is cut (else a frame).
        let size = fs;
        el.style.fontSize = `${size}px`;
        while (size > 9 && (el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1)) {
          size--;
          el.style.fontSize = `${size}px`;
        }
        if (el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1) {
          el.textContent = '';
          el.style.fontSize = '';
          el.setAttribute('data-ov-state', 'frame');
        }
      }
    });
  };

  host.append(layer);
  place();
  img.addEventListener('load', place);
  window.addEventListener('resize', place);
  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(place) : null;
  ro?.observe(host);
  ro?.observe(img);
  return () => {
    img.removeEventListener('load', place);
    window.removeEventListener('resize', place);
    ro?.disconnect();
    layer.remove();
  };
}
