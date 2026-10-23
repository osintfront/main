import type { MediaKind, PublicEvent, Severity } from '@/types/event';

/**
 * Visitor-side filters for the map and feed: time range, areas, event types,
 * severity, source, a few toggles, and a drawn area (polygon / octagon).
 * All filtering happens in the browser on the events already loaded; a time
 * range reaching past the live 24 hours also loads the archive (MapPage).
 */

export type TimePreset = 'live' | '1h' | '6h' | '24h' | '3d' | '7d' | 'custom';
export type SourceKind = 'telegram' | 'whatsapp' | 'x' | 'facebook' | 'instagram' | 'tiktok' | 'news' | 'other';
/** Media on the event: none, or which kinds are attached. */
export type MediaFilter = 'none' | MediaKind;
export type LatLng = [number, number];
/** place = a specific place (pinned on the map); country = only the country is known;
 *  none = no usable location (only a broad region like "Middle East", or nothing). */
export type PlaceKind = 'place' | 'country' | 'none';

export interface EventFilters {
  preset: TimePreset;
  /** Only for preset 'custom': ISO strings (either may be empty). */
  from: string;
  to: string;
  areas: string[];
  categories: string[];
  severities: Severity[];
  sources: SourceKind[];
  media: MediaFilter[];
  breakingOnly: boolean;
  verifiedOnly: boolean;
  /** Empty = all. Only 'place' events are pinned on the map; the others appear in the feed only. */
  placeKinds: PlaceKind[];
  /** A drawn area: only events with a pin inside it are shown. */
  polygon: LatLng[] | null;
  /** Active צי"ח (EEI) ids: an event must match at least one (matched in MapPage, see lib/eei). */
  eeis: string[];
}

export const EMPTY_FILTERS: EventFilters = {
  preset: 'live',
  from: '',
  to: '',
  areas: [],
  categories: [],
  severities: [],
  sources: [],
  media: [],
  breakingOnly: false,
  verifiedOnly: false,
  placeKinds: [],
  polygon: null,
  eeis: [],
};

export const TIME_PRESETS: { id: TimePreset; hours: number | null }[] = [
  { id: 'live', hours: null },
  { id: '1h', hours: 1 },
  { id: '6h', hours: 6 },
  { id: '24h', hours: 24 },
  { id: '3d', hours: 72 },
  { id: '7d', hours: 168 },
  { id: 'custom', hours: null },
];

/** The time window a filter asks for, or null for "whatever is live". */
export function timeWindow(f: EventFilters, now = Date.now()): { from: number; to: number } | null {
  if (f.preset === 'live') return null;
  if (f.preset === 'custom') {
    const from = f.from ? new Date(f.from).getTime() : NaN;
    const to = f.to ? new Date(f.to).getTime() : NaN;
    if (isNaN(from) && isNaN(to)) return null;
    return { from: isNaN(from) ? 0 : from, to: isNaN(to) ? now + 60_000 : to };
  }
  const hours = TIME_PRESETS.find((p) => p.id === f.preset)?.hours ?? 24;
  return { from: now - hours * 3600_000, to: now + 60_000 };
}

// ─── Areas ─────────────────────────────────────────────────────────
/** bbox = [south, west, north, east] — rough box, used only when the country text is unknown. */
export interface AreaDef {
  id: string;
  en: string;
  he: string;
  names: string[];
  bbox: [number, number, number, number] | null;
}

export const AREAS: AreaDef[] = [
  { id: 'israel', en: 'Israel', he: 'ישראל', names: ['israel', 'ישראל'], bbox: [29.45, 34.25, 33.34, 35.9] },
  { id: 'gaza', en: 'Gaza', he: 'עזה', names: ['gaza', 'gaza strip', 'רצועת עזה', 'עזה'], bbox: [31.22, 34.2, 31.6, 34.57] },
  {
    id: 'westbank',
    en: 'West Bank',
    he: 'יהודה ושומרון',
    names: ['west bank', 'judea and samaria', 'יהודה ושומרון', 'הגדה המערבית', 'איו"ש'],
    bbox: [31.34, 34.88, 32.55, 35.57],
  },
  { id: 'lebanon', en: 'Lebanon', he: 'לבנון', names: ['lebanon', 'לבנון'], bbox: [33.05, 35.1, 34.7, 36.62] },
  { id: 'syria', en: 'Syria', he: 'סוריה', names: ['syria', 'סוריה'], bbox: [32.31, 35.7, 37.32, 42.38] },
  { id: 'iraq', en: 'Iraq', he: 'עיראק', names: ['iraq', 'עיראק', 'עירק'], bbox: [29.06, 38.79, 37.38, 48.57] },
  { id: 'iran', en: 'Iran', he: 'איראן', names: ['iran', 'איראן'], bbox: [25.06, 44.03, 39.78, 63.32] },
  { id: 'yemen', en: 'Yemen', he: 'תימן', names: ['yemen', 'תימן'], bbox: [12.1, 42.55, 19.0, 54.5] },
  { id: 'jordan', en: 'Jordan', he: 'ירדן', names: ['jordan', 'ירדן'], bbox: [29.19, 34.96, 33.37, 39.3] },
  { id: 'egypt', en: 'Egypt', he: 'מצרים', names: ['egypt', 'מצרים', 'sinai', 'סיני'], bbox: [22.0, 24.7, 31.67, 36.9] },
  { id: 'saudi', en: 'Saudi Arabia', he: 'סעודיה', names: ['saudi arabia', 'ksa', 'סעודיה', 'ערב הסעודית'], bbox: [16.35, 34.5, 32.15, 55.67] },
  { id: 'qatar', en: 'Qatar', he: 'קטאר', names: ['qatar', 'קטאר'], bbox: [24.4, 50.7, 26.2, 51.7] },
  { id: 'uae', en: 'UAE', he: 'איחוד האמירויות', names: ['uae', 'united arab emirates', 'emirates', 'איחוד האמירויות', 'האמירויות'], bbox: [22.6, 51.5, 26.1, 56.4] },
  { id: 'bahrain', en: 'Bahrain', he: 'בחריין', names: ['bahrain', 'בחריין'], bbox: [25.5, 50.3, 26.4, 50.9] },
  { id: 'kuwait', en: 'Kuwait', he: 'כווית', names: ['kuwait', 'כווית'], bbox: [28.5, 46.5, 30.1, 48.5] },
  { id: 'oman', en: 'Oman', he: 'עומאן', names: ['oman', 'עומאן'], bbox: [16.6, 52.0, 26.4, 59.9] },
  { id: 'turkey', en: 'Turkey', he: 'טורקיה', names: ['turkey', 'türkiye', 'טורקיה'], bbox: [35.8, 25.6, 42.2, 44.8] },
  { id: 'cyprus', en: 'Cyprus', he: 'קפריסין', names: ['cyprus', 'קפריסין'], bbox: [34.5, 32.2, 35.7, 34.6] },
];

const NAME_TO_AREA = new Map<string, string>();
for (const a of AREAS) for (const n of a.names) NAME_TO_AREA.set(n, a.id);
/** "Palestine" is either Gaza or the West Bank: decided by the pin (or the text). */
const PALESTINE = new Set(['palestine', 'palestinian territories', 'palestinian territory', 'state of palestine', 'פלסטין', 'הרשות הפלסטינית', 'השטחים', 'فلسطين']);

/** The Gaza Strip border, roughly (lng, lat) — tighter than a box, so the Israeli
 *  communities next to the fence (Kissufim, Nahal Oz, Netiv HaAsara…) stay in Israel. */
const GAZA_POLYGON: [number, number][] = [
  [34.2166, 31.3236], [34.267, 31.22], [34.356, 31.289], [34.382, 31.356], [34.44, 31.43], [34.472, 31.468],
  [34.505, 31.5], [34.545, 31.53], [34.5664, 31.5586], [34.53, 31.564], [34.49, 31.596],
];
export function inGazaStrip(lat: number, lng: number): boolean {
  if (lat < 31.2 || lat > 31.61 || lng < 34.2 || lng > 34.58) return false;
  let inside = false;
  for (let i = 0, j = GAZA_POLYGON.length - 1; i < GAZA_POLYGON.length; j = i++) {
    const [xi, yi] = GAZA_POLYGON[i];
    const [xj, yj] = GAZA_POLYGON[j];
    if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Gaza Strip places (Hebrew / English / Arabic) for events with no usable pin. */
const GAZA_WORDS =
  /עזה|חאן יונס|רפיח|ג'באליה|ג׳באליה|בית להיא|בית חאנון|דיר אל-?בלח|נוסייראת|נוציראת|בורייג|מע'אזי|שג'אעייה|שג׳אעייה|זייתון|מוואסי|gaza|khan y[ou]nis|rafah|jabalia|jabaliya|beit lahia|beit hanoun|deir al-?balah|deir el-?balah|nuseirat|bureij|maghazi|shuja[i']y+a|zeitoun|mawasi|غزة|خان ?يونس|رفح|جباليا|بيت لاهيا|بيت حانون|دير البلح|النصيرات|البريج|المغازي|الشجاعية|المواسي/i;

const inBox = (lat: number, lng: number, b: [number, number, number, number]) => lat >= b[0] && lat <= b[2] && lng >= b[1] && lng <= b[3];

function areaAt(lat: number, lng: number): string {
  if (inGazaStrip(lat, lng)) return 'gaza';
  // Small areas first, so the West Bank wins over Israel's box.
  for (const id of ['westbank', 'lebanon', 'israel', 'jordan', 'bahrain', 'qatar', 'kuwait', 'uae', 'syria', 'iraq', 'yemen', 'oman', 'iran', 'saudi', 'egypt', 'cyprus', 'turkey']) {
    const a = AREAS.find((x) => x.id === id)!;
    if (a.bbox && inBox(lat, lng, a.bbox)) return id;
  }
  return '';
}

/** Any other country named on events gets its own area: id "c:<name>". */
export const COUNTRY_AREA_PREFIX = 'c:';

const areaCache = new WeakMap<PublicEvent, Set<string>>();

/** The areas an event belongs to (from its country text; the pin's position as a fallback). */
export function eventAreas(e: PublicEvent): Set<string> {
  const cached = areaCache.get(e);
  if (cached) return cached;
  const out = new Set<string>();
  const pinned = !!e.locationPrecision && e.locationPrecision !== 'country' && Number.isFinite(e.latitude) && Number.isFinite(e.longitude);
  const pinInGaza = pinned && inGazaStrip(e.latitude, e.longitude);
  for (const part of (e.country || '').split(/\s*[/,;|]\s*/)) {
    const key = part.trim().toLowerCase();
    if (!key) continue;
    if (PALESTINE.has(key)) {
      // Gaza or the West Bank: the pin decides; without a pin, the place names in the text.
      if (pinInGaza) out.add('gaza');
      else if (pinned && inBox(e.latitude, e.longitude, AREAS.find((a) => a.id === 'westbank')!.bbox!)) out.add('westbank');
      else out.add(GAZA_WORDS.test(`${e.locationName} ${e.title}`) ? 'gaza' : 'westbank');
      continue;
    }
    out.add(NAME_TO_AREA.get(key) ?? COUNTRY_AREA_PREFIX + part.trim());
  }
  // A pin inside the Strip is a Gaza event whatever country the report named (e.g. "Israel").
  if (pinInGaza) out.add('gaza');
  if (out.size === 0 && e.locationPrecision) {
    const a = areaAt(e.latitude, e.longitude);
    if (a) out.add(a);
  }
  areaCache.set(e, out);
  return out;
}

export function placeKind(e: PublicEvent): PlaceKind {
  const p = e.locationPrecision;
  if (!p) return 'none';
  if (p === 'country') return 'country';
  // A region with no place name is the broad fallback ("Middle East"): not a real location.
  if (p === 'region' && !e.locationName && !(e.places?.length)) return 'none';
  return 'place';
}

/** Only events with a specific place get a pin; country-only / no-location events stay in the feed. */
export const isOnMap = (e: PublicEvent) => placeKind(e) === 'place';

const HOST_KIND: [RegExp, SourceKind][] = [
  [/(^|\.)(t\.me|telegram\.(me|org))$/, 'telegram'],
  [/(^|\.)(wa\.me|whatsapp\.com)$/, 'whatsapp'],
  [/(^|\.)(x\.com|twitter\.com)$/, 'x'],
  [/(^|\.)(facebook\.com|fb\.com|fb\.watch)$/, 'facebook'],
  [/(^|\.)instagram\.com$/, 'instagram'],
  [/(^|\.)tiktok\.com$/, 'tiktok'],
];

export function sourceKind(e: PublicEvent): SourceKind {
  const name = e.sourceName ?? '';
  if (/^whatsapp/i.test(name)) return 'whatsapp';
  if (/^telegram/i.test(name)) return 'telegram';
  if (e.sourceUrl) {
    try {
      const host = new URL(e.sourceUrl).hostname.toLowerCase();
      for (const [re, kind] of HOST_KIND) if (re.test(host)) return kind;
    } catch {
      /* not a URL */
    }
  }
  if (/^(x|twitter)\b/i.test(name)) return 'x';
  if (/^facebook/i.test(name)) return 'facebook';
  if (/^instagram/i.test(name)) return 'instagram';
  if (/^tiktok/i.test(name)) return 'tiktok';
  if (e.sourceType === 'news_website') return 'news';
  return 'other';
}

export function mediaKinds(e: PublicEvent): MediaFilter[] {
  return e.mediaKinds?.length ? e.mediaKinds : ['none'];
}

// ─── Drawn area ────────────────────────────────────────────────────
export function pointInPolygon([lat, lng]: LatLng, poly: LatLng[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [yi, xi] = poly[i];
    const [yj, xj] = poly[j];
    if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** A regular octagon around `center` through `edge` (corners in lat/lng, corrected for latitude). */
export function octagon(center: LatLng, edge: LatLng): LatLng[] {
  const k = Math.cos((center[0] * Math.PI) / 180) || 1;
  const dy = edge[0] - center[0];
  const dx = (edge[1] - center[1]) * k;
  const r = Math.hypot(dx, dy);
  const start = Math.atan2(dy, dx) + Math.PI / 8;
  return Array.from({ length: 8 }, (_, i) => {
    const a = start + (i * Math.PI) / 4;
    return [center[0] + r * Math.sin(a), center[1] + (r * Math.cos(a)) / k] as LatLng;
  });
}

function eventPoints(e: PublicEvent): LatLng[] {
  return [[e.latitude, e.longitude], ...(e.places ?? []).map((p) => [p.latitude, p.longitude] as LatLng)];
}

// ─── Matching ──────────────────────────────────────────────────────
export function matchesFilters(e: PublicEvent, f: EventFilters, now = Date.now()): boolean {
  const win = timeWindow(f, now);
  if (win) {
    const t = new Date(e.occurredAt).getTime();
    if (t < win.from || t > win.to) return false;
  }
  if (f.areas.length) {
    const areas = eventAreas(e);
    if (!f.areas.some((a) => areas.has(a))) return false;
  }
  if (f.categories.length && !f.categories.includes(e.category.slug)) return false;
  if (f.severities.length && !f.severities.includes(e.severity)) return false;
  if (f.sources.length && !f.sources.includes(sourceKind(e))) return false;
  if (f.media?.length && !mediaKinds(e).some((m) => f.media.includes(m))) return false;
  if (f.breakingOnly && !e.isBreaking) return false;
  if (f.verifiedOnly && !e.isVerified) return false;
  if (f.placeKinds.length && !f.placeKinds.includes(placeKind(e))) return false;
  if (f.polygon && f.polygon.length >= 3 && !eventPoints(e).some((p) => pointInPolygon(p, f.polygon!))) return false;
  return true;
}

/** How many filter groups are active (for the badge on the Filters button). */
export function activeFilterCount(f: EventFilters): number {
  return (
    (f.preset !== 'live' ? 1 : 0) +
    (f.areas.length ? 1 : 0) +
    (f.categories.length ? 1 : 0) +
    (f.severities.length ? 1 : 0) +
    (f.sources.length ? 1 : 0) +
    (f.media?.length ? 1 : 0) +
    (f.breakingOnly ? 1 : 0) +
    (f.verifiedOnly ? 1 : 0) +
    (f.placeKinds.length ? 1 : 0) +
    (f.polygon ? 1 : 0)
  );
}

/** Does this filter reach back past the live 24 hours (so the archive must be loaded)? */
export function needsArchive(f: EventFilters, now = Date.now()): { from: string; to: string } | null {
  const win = timeWindow(f, now);
  if (!win || win.from >= now - 24 * 3600_000) return null;
  return { from: new Date(win.from).toISOString(), to: new Date(Math.min(win.to, now + 60_000)).toISOString() };
}
