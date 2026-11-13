// Satellite enhance ×4 (SEN2SR, 10 m → 2.5 m): the pure parts, unit-tested in node
// (tests/satsr/satEnhance.test.ts). No Leaflet, React or Supabase imports here.

/** Cells per degree: the server snaps every request to a 0.005° cell (migration 126, satsr-worker grid.py). */
export const CELL = 200;
/** Side of the enhanced square in metres (256 Sentinel-2 pixels of 10 m). */
export const BOX_M = 2560;

export type SatsrProduct = 'tci' | 'irp' | 'ndvi';
/** The products shown in the selector, in order (the worker may add more; unknown ones are ignored). */
export const SATSR_PRODUCTS: SatsrProduct[] = ['tci', 'irp', 'ndvi'];
export type SatsrWhich = 'sr' | 'lr';
export type SatsrView = 'swipe' | 'before' | 'after';

export interface LatLng { lat: number; lng: number }

/** Same rounding as the database: floor(v * 200 + 0.5). */
export function snapCell(lat: number, lng: number): { cellX: number; cellY: number; lat: number; lng: number } {
  const cellY = Math.floor(lat * CELL + 0.5);
  const cellX = Math.floor(lng * CELL + 0.5);
  return { cellX, cellY, lat: cellY / CELL, lng: cellX / CELL };
}

/** The ~2.56 km square that will be enhanced for a click: [[south, west], [north, east]] around the cell centre. */
export function cellBox(lat: number, lng: number, sideM = BOX_M): [[number, number], [number, number]] {
  const c = snapCell(lat, lng);
  const half = sideM / 2;
  const dLat = half / 111_320;
  const dLng = half / (111_320 * Math.max(Math.cos((c.lat * Math.PI) / 180), 0.01));
  return [[c.lat - dLat, c.lng - dLng], [c.lat + dLat, c.lng + dLng]];
}

/**
 * The day to enhance: the satellite layer's day when it shows a Sentinel-2 picture
 * (Copernicus 's2', or NASA HLS 'hlss30' which is made from Sentinel-2), else null = newest clear picture.
 */
export function enhanceDate(satOn: boolean, src: string, day: string | null | undefined): string | null {
  if (!satOn || !day || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  return src === 's2' || src === 'hlss30' ? day : null;
}

export type SatsrStatus = 'queued' | 'running' | 'done' | 'failed';
export interface SatsrJobLike {
  status: SatsrStatus;
  errorCode?: string | null;
  queuePos?: number | null;
  cacheHit?: boolean;
}
export type SatsrMessageKey =
  | 'satsr.queued' | 'satsr.running' | 'satsr.offline' | 'satsr.fail.no_scene' | 'satsr.fail.other' | 'satsr.cached' | 'satsr.done';

/** The status line for a job (i18n key + values). A queued job with no worker online says so. */
export function jobMessageKey(job: SatsrJobLike, workerOnline: boolean): { key: SatsrMessageKey; vars?: Record<string, number> } {
  switch (job.status) {
    case 'queued':
      return workerOnline ? { key: 'satsr.queued', vars: { n: Math.max(job.queuePos ?? 1, 1) } } : { key: 'satsr.offline' };
    case 'running':
      return { key: 'satsr.running' };
    case 'failed':
      return { key: job.errorCode === 'no_scene' ? 'satsr.fail.no_scene' : 'satsr.fail.other' };
    default:
      return { key: job.cacheHit ? 'satsr.cached' : 'satsr.done' };
  }
}

/** Is any of these jobs still on its way (keep polling)? */
export function anyOpen(jobs: readonly { status: SatsrStatus }[]): boolean {
  return jobs.some((j) => j.status === 'queued' || j.status === 'running');
}

/** File name for a download: osintfront-sat-2026-11-10-31.5000N-34.4500E-tci-after-2.5m.png */
export function downloadName(job: { sceneDate: string | null; lat: number; lng: number }, product: SatsrProduct, which: SatsrWhich): string {
  const ns = `${Math.abs(job.lat).toFixed(4)}${job.lat >= 0 ? 'N' : 'S'}`;
  const ew = `${Math.abs(job.lng).toFixed(4)}${job.lng >= 0 ? 'E' : 'W'}`;
  const part = which === 'sr' ? 'after-2.5m' : 'before-10m';
  return `osintfront-sat-${job.sceneDate ?? 'na'}-${ns}-${ew}-${product}-${part}.png`;
}

/** The products a finished job really has, in the selector's order. */
export function availableProducts(products: Record<string, { sr?: string; lr?: string }> | null | undefined): SatsrProduct[] {
  if (!products) return [];
  return SATSR_PRODUCTS.filter((p) => !!products[p]?.sr && !!products[p]?.lr);
}

// ── Before / after swipe ─────────────────────────────────────────────────────────
// The divider is vertical on the SCREEN (left = original, right = enhanced), but the overlay panes
// live inside leaflet-rotate's rotated pane. So the two screen halves are mapped corner by corner
// into the pane's own coordinates (map.containerPointToLayerPoint, which knows the bearing) and
// applied as CSS clip-path polygons. This never touches the date-compare swipe (other panes, `clip`).
export interface Pt { x: number; y: number }

/** The two screen-space halves of a w × h map split at fraction f (0..1) from the left. */
export function swipeQuads(w: number, h: number, f: number): { left: Pt[]; right: Pt[] } {
  const x = w * Math.min(1, Math.max(0, f));
  return {
    left: [{ x: 0, y: 0 }, { x, y: 0 }, { x, y: h }, { x: 0, y: h }],
    right: [{ x, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x, y: h }],
  };
}

/** CSS clip-path polygon (px) from points in the clipped element's coordinates. */
export function clipPolygon(points: Pt[]): string {
  const r = (v: number) => Math.round(v * 10) / 10;
  return `polygon(${points.map((p) => `${r(p.x)}px ${r(p.y)}px`).join(', ')})`;
}

/** clip-path values for the "before" (left) and "after" (right) panes. toPane = container point → pane point. */
export function swipeClips(w: number, h: number, f: number, toPane: (p: Pt) => Pt): { before: string; after: string } {
  const q = swipeQuads(w, h, f);
  return { before: clipPolygon(q.left.map(toPane)), after: clipPolygon(q.right.map(toPane)) };
}
