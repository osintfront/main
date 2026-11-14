import { useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent, type WheelEvent as RWheelEvent } from 'react';
import { Minus, Plus, RotateCcw } from 'lucide-react';
import { useI18n } from '@/i18n';
import { type DashResult } from '@/lib/askStats';
import { clampView, fitView, hotspotRadius, project, ringPath, viewKey, zoomAt, type View } from '@/lib/dashGeometry';
import { useMark, type TipApi } from './charts/Tip';
import { useDashColors } from './charts/dashColors';

const W = 600, H = 360;
type Country = { name: string; d: string };
let shapes: Promise<Country[]> | null = null;
/** The region's country outlines, loaded once (lazily, on the first dashboard). */
function loadShapes(): Promise<Country[]> {
  shapes ??= fetch('/data/me-admin0.geojson')
    .then((r) => r.json())
    .then((fc) => fc.features.map((f: any) => {
      const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
      return { name: f.properties.name, d: polys.flatMap((p: [number, number][][]) => p.map(ringPath)).join('') };
    }))
    .catch(() => { shapes = null; return []; });
  return shapes;
}

/** Resolves when the country outlines are loaded (the export waits for them). */
export const mapShapesReady = (): Promise<unknown> => loadShapes();

/** Our own SVG map of the hotspots (no tiles): zoom with the wheel or a pinch, drag to pan, reset. */
export function MiniMap({ places, targetCountry, view, onView, onSelect, tip, interactive }: {
  places: DashResult['places']; targetCountry: string | null; view: View | null; onView?: (v: View) => void;
  onSelect?: (index: number) => void; tip?: TipApi; interactive: boolean;
}) {
  const { t } = useI18n();
  const mark = useMark(tip);
  const C = useDashColors();
  const [countries, setCountries] = useState<Country[]>([]);
  useEffect(() => { let live = true; void loadShapes().then((c) => live && setCountries(c)); return () => { live = false; }; }, []);
  const pins = places.map((p, i) => ({ p, i })).filter(({ p }) => !p.other && p.lat != null && p.lng != null);
  const first = useMemo(() => fitView(pins.map(({ p }) => [p.lng!, p.lat!]), W, H), [places]); // eslint-disable-line react-hooks/exhaustive-deps
  const v = view ?? first;
  const max = Math.max(1, ...pins.map(({ p }) => p.count));
  const svgRef = useRef<SVGSVGElement>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const last = useRef<{ x: number; y: number; dist: number } | null>(null);
  /** How far the pointer travelled since it went down: a drag must not end as a press on a hotspot. */
  const travelled = useRef(0);
  const set = (nv: View) => onView?.(clampView(nv, W, H));
  /** Client coordinates → viewBox units. */
  const local = (x: number, y: number) => {
    const r = svgRef.current!.getBoundingClientRect();
    return { x: ((x - r.left) / r.width) * W, y: ((y - r.top) / r.height) * H };
  };
  const centre = () => {
    const ps = [...pointers.current.values()];
    const c = { x: ps.reduce((s, p) => s + p.x, 0) / ps.length, y: ps.reduce((s, p) => s + p.y, 0) / ps.length };
    const dist = ps.length > 1 ? Math.hypot(ps[0].x - ps[1].x, ps[0].y - ps[1].y) : 0;
    return { ...c, dist };
  };
  const down = (e: RPointerEvent) => {
    if (!interactive) return;
    pointers.current.set(e.pointerId, local(e.clientX, e.clientY));
    if (pointers.current.size === 1) travelled.current = 0;
    last.current = centre();
  };
  const move = (e: RPointerEvent) => {
    if (!interactive || !pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, local(e.clientX, e.clientY));
    const c = centre();
    const l = last.current;
    if (l) {
      travelled.current += Math.abs(c.x - l.x) + Math.abs(c.y - l.y);
      let nv = { ...v, x: v.x + (c.x - l.x), y: v.y + (c.y - l.y) };
      if (c.dist && l.dist) nv = zoomAt(nv, c.dist / l.dist, c.x, c.y, W, H);
      if (Math.abs(c.x - l.x) + Math.abs(c.y - l.y) > 0.5 || (c.dist && l.dist && c.dist !== l.dist)) set(nv);
    }
    last.current = c;
  };
  const up = (e: RPointerEvent) => {
    pointers.current.delete(e.pointerId);
    last.current = pointers.current.size ? centre() : null;
  };
  const wheel = (e: RWheelEvent) => {
    if (!interactive) return;
    const p = local(e.clientX, e.clientY);
    set(zoomAt(v, e.deltaY < 0 ? 1.25 : 0.8, p.x, p.y, W, H));
  };
  // React's wheel listener is passive: stop the page from scrolling under the map.
  useEffect(() => {
    const el = svgRef.current;
    if (!el || !interactive) return;
    const stop = (e: WheelEvent) => e.preventDefault();
    el.addEventListener('wheel', stop, { passive: false });
    return () => el.removeEventListener('wheel', stop);
  }, [interactive]);
  const btn = 'inline-flex size-8 items-center justify-center rounded-md shadow ring-1';
  const btnStyle = { background: 'var(--dash-bg)', color: 'var(--dash-ink)', borderColor: 'var(--dash-line)' };
  return (
    <div className="relative overflow-hidden rounded-xl" style={{ background: 'var(--dash-panel)' }}>
      <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full select-none" role="img" aria-label={t('dash.mapLabel')}
        data-view={viewKey(v)} style={{ direction: 'ltr', touchAction: interactive ? 'none' : undefined }}
        onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onPointerLeave={up} onWheel={wheel}
        onClickCapture={(e) => { if (travelled.current > 6) { e.stopPropagation(); e.preventDefault(); } travelled.current = 0; }}>
        <g transform={`translate(${v.x} ${v.y}) scale(${v.k})`}>
          {countries.map((c, i) => (
            <path key={i} d={c.d} data-country={c.name} data-target={c.name === targetCountry ? '' : undefined} vectorEffect="non-scaling-stroke"
              fill={c.name === targetCountry ? C.target : C.land} stroke={C.muted} strokeOpacity={0.45} strokeWidth={0.8} fillRule="evenodd" />
          ))}
        </g>
        {pins.map(({ p, i }) => {
          const [wx, wy] = project(p.lng!, p.lat!);
          const x = wx * v.k + v.x, y = wy * v.k + v.y;
          const r = hotspotRadius(p.count, max);
          return (
            <g key={i} data-hotspot={i} className="cursor-pointer" {...mark(`hot:${i}`, t('dash.tip.hotspotPin', { place: p.name, count: p.count, reports: p.reports }), onSelect ? () => onSelect(i) : undefined)}>
              <circle cx={x} cy={y} r={r} fill={C.hot} fillOpacity={0.72} stroke={C.bg} strokeWidth={2} />
              <text x={x + r + 4} y={y + 4} fontSize={12} fontWeight={600} fill={C.ink} stroke={C.panel} strokeWidth={3} paintOrder="stroke">{`${p.name} ${p.count}`}</text>
            </g>
          );
        })}
      </svg>
      {interactive ? (
        <div className="absolute bottom-2 end-2 flex gap-1">
          <button type="button" data-dash-action="zoom-in" aria-label={t('dash.zoomIn')} onClick={() => set(zoomAt(v, 1.5, W / 2, H / 2, W, H))} className={btn} style={btnStyle}><Plus className="size-4" aria-hidden /></button>
          <button type="button" data-dash-action="zoom-out" aria-label={t('dash.zoomOut')} onClick={() => set(zoomAt(v, 1 / 1.5, W / 2, H / 2, W, H))} className={btn} style={btnStyle}><Minus className="size-4" aria-hidden /></button>
          <button type="button" data-dash-action="reset" aria-label={t('dash.mapReset')} onClick={() => onView?.(first)} className={btn} style={btnStyle}><RotateCcw className="size-4" aria-hidden /></button>
        </div>
      ) : null}
    </div>
  );
}
