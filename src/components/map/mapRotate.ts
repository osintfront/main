import L from 'leaflet';
import 'leaflet-rotate'; // pinned 0.2.8 (2023, stable): rotation, two-finger rotate, compass control

/**
 * Rotate by dragging with the right mouse button or Ctrl + left button (desktop).
 * A right-click without dragging still opens our investigation menu.
 */
export function enableDragRotate(map: L.Map) {
  // Two modes only: north-up, or turned by hand. Never follow the phone's compass.
  const m = map as L.Map & { compassBearing?: L.Handler; getBearing: () => number; setBearing: (b: number) => void };
  m.compassBearing?.disable();
  // Our own compass button: the needle shows the map's bearing; a tap = north-up again.
  const Compass = L.Control.extend({
    onAdd() {
      const box = L.DomUtil.create('div', 'leaflet-bar ofm-compass');
      const a = L.DomUtil.create('a', '', box) as HTMLAnchorElement;
      a.href = '#';
      a.title = 'צפון למעלה';
      a.setAttribute('role', 'button');
      a.setAttribute('aria-label', 'צפון למעלה');
      a.innerHTML = '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M12 2l4 10h-8z" fill="#dc2626"/><path d="M12 22l-4-10h8z" fill="#94a3b8"/></svg>';
      const restyle = () => { (a.firstChild as SVGElement).style.transform = `rotate(${-m.getBearing()}deg)`; };
      L.DomEvent.on(a, 'click', (e) => { L.DomEvent.preventDefault(e); L.DomEvent.stopPropagation(e); m.compassBearing?.disable(); m.setBearing(0); });
      L.DomEvent.disableClickPropagation(box);
      map.on('rotate', restyle);
      restyle();
      return box;
    },
  });
  new Compass({ position: 'topleft' }).addTo(map);
  const el = map.getContainer();
  let start: { x: number; y: number; bearing: number; angle: number } | null = null;
  let moved = false;
  const center = () => {
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  };
  const angle = (e: MouseEvent) => {
    const c = center();
    return (Math.atan2(e.clientY - c.y, e.clientX - c.x) * 180) / Math.PI;
  };
  const onDown = (e: MouseEvent) => {
    if (!(e.button === 2 || (e.button === 0 && e.ctrlKey))) return;
    const m = map as L.Map & { getBearing?: () => number };
    start = { x: e.clientX, y: e.clientY, bearing: m.getBearing?.() ?? 0, angle: angle(e) };
    moved = false;
    if (e.ctrlKey) { e.preventDefault(); e.stopPropagation(); map.dragging.disable(); }
  };
  const onMove = (e: MouseEvent) => {
    if (!start) return;
    if (!moved && Math.hypot(e.clientX - start.x, e.clientY - start.y) < 6) return;
    moved = true;
    (map as L.Map & { setBearing?: (b: number) => void }).setBearing?.(start.bearing + (angle(e) - start.angle));
  };
  const onUp = () => {
    if (start && !map.dragging.enabled()) map.dragging.enable();
    start = null;
  };
  // After a rotate-drag with the right button, don't open the menu.
  const onContext = (e: MouseEvent) => {
    if (moved) { e.preventDefault(); e.stopImmediatePropagation(); moved = false; }
  };
  el.addEventListener('mousedown', onDown, true);
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);
  el.addEventListener('contextmenu', onContext, true);
  return () => {
    el.removeEventListener('mousedown', onDown, true);
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', onUp);
    el.removeEventListener('contextmenu', onContext, true);
  };
}

export const ROTATE_OPTIONS = {
  rotate: true,
  bearing: 0,
  touchRotate: true, // two fingers on phones
  compassBearing: false, // never follow the device's compass
  shiftKeyRotate: true, // Shift + mouse wheel
  rotateControl: false, // replaced by our own compass button (north-up only)
} as unknown as L.MapOptions;
