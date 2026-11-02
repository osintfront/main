import L from 'leaflet';
import 'leaflet-rotate'; // pinned 0.2.8 (2023, stable): rotation, two-finger rotate, compass control

/**
 * leaflet-rotate redraws every vector renderer (areas, alert polygons, lines) on each `rotate`
 * event. During a phone pinch that also turns the map, that re-places the SVG/canvas for the
 * half-way zoom while its shapes are still drawn for the zoom the gesture started at — the
 * areas slide away from the pins and jump back when the fingers lift (leaflet-rotate's own
 * "@FIXME layer drifts"). When the zoom has changed since the shapes were drawn, redraw them
 * for the current zoom too (a full reset), so container and shapes always agree.
 */
{
  type R = L.Renderer & { _map?: L.Map; _zoom?: number; _update: () => void; _reset: () => void };
  const proto = L.Renderer.prototype as unknown as { getEvents: (this: R) => Record<string, unknown> };
  const rotateEvents = proto.getEvents;
  proto.getEvents = function (this: R) {
    const events = rotateEvents.call(this);
    events.rotate = function (this: R) {
      if (this._map && this._zoom !== this._map.getZoom()) this._reset();
      else this._update();
    };
    return events;
  };
}

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
  // Two-finger twist on phones: less sensitive. A small twist (a normal pinch-zoom) does nothing;
  // beyond the dead zone the map follows at a reduced rate. Compass / mouse rotation are untouched.
  const DEAD = 15, GAIN = 0.6;
  const rawSet = m.setBearing.bind(m);
  let pinch: { b0: number; open: boolean } | null = null;
  m.setBearing = (b: number) => {
    if (!pinch) return rawSet(b);
    const d = ((b - pinch.b0 + 540) % 360) - 180;
    const ad = Math.abs(d);
    if (!pinch.open && ad < DEAD) return;
    pinch.open = true;
    rawSet(pinch.b0 + Math.sign(d) * Math.max(0, ad - DEAD) * GAIN);
  };
  const onTouch = (e: TouchEvent) => {
    if (e.touches.length === 2) { if (!pinch) pinch = { b0: m.getBearing(), open: false }; }
    else pinch = null;
  };
  el.addEventListener('touchstart', onTouch, true);
  el.addEventListener('touchend', onTouch, true);
  el.addEventListener('touchcancel', onTouch, true);
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
    el.removeEventListener('touchstart', onTouch, true);
    el.removeEventListener('touchend', onTouch, true);
    el.removeEventListener('touchcancel', onTouch, true);
    m.setBearing = rawSet;
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
