import L from 'leaflet';
import 'leaflet-rotate'; // pinned 0.2.8 (2023, stable): rotation, two-finger rotate, compass control

/**
 * Rotate by dragging with the right mouse button or Ctrl + left button (desktop).
 * A right-click without dragging still opens our investigation menu.
 */
export function enableDragRotate(map: L.Map) {
  // Manual rotation only: never follow the phone's compass. The compass button = back to north.
  const m = map as L.Map & { compassBearing?: L.Handler; touchRotate?: L.Handler; rotateControl?: { _cycleState: () => void; _restyle: () => void } };
  m.compassBearing?.disable();
  if (m.rotateControl) {
    m.rotateControl._cycleState = function (this: { _restyle: () => void }) {
      m.compassBearing?.disable();
      (map as L.Map & { setBearing: (b: number) => void }).setBearing(0);
      m.touchRotate?.enable();
      this._restyle();
    };
  }
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
  rotateControl: { closeOnZeroBearing: false, position: 'topleft' }, // compass: shows bearing, click = north up
} as unknown as L.MapOptions;
