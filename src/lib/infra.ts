// Airfields and ports: loading the static files and building the popups. No Leaflet / Supabase here,
// so it runs in node tests as is (the map part is components/map/InfraLayers.tsx).

export type AirfieldClass = 'civil' | 'military' | 'strip' | 'closed';
export interface AirfieldProps { k: AirfieldClass; n: string; t: string; icao?: string; iata?: string; cc: string; el?: number; rw?: { l: number; s: string; lit: boolean }[] }
export interface PortProps { n: string; cc: string; sz?: 'L' | 'M' | 'S' | 'V'; ty?: string; ch?: number; an?: number; cp?: number }
type Lang = 'he' | 'en';

export const INFRA_TXT = {
  he: {
    title: 'שדות תעופה ונמלים', civil: 'אזרחי', military: 'צבאי (לפי השם)', strip: 'מנחת / מנחת מסוקים', closed: 'סגור', ports: 'נמלים',
    civilToggle: 'אזרחיים', militaryToggle: 'צבאיים', stripToggle: 'מנחתים ומנחתי מסוקים', closedToggle: 'סגורים', unavailable: 'לא זמין',
    near: 'ליד', type: 'סוג', codes: 'קודים', country: 'מדינה', elevation: 'גובה', runways: 'מסלולים', lit: 'מואר',
    size: 'גודל נמל', harbor: 'סוג נמל', channel: 'עומק תעלה', anchorage: 'עומק מעגן', pier: 'עומק רציף', L: 'גדול', M: 'בינוני', S: 'קטן', V: 'קטן מאוד',
    aircraft: 'מטוסים בזמן אמת בסביבה', ships: 'אוניות בזמן אמת בסביבה',
  },
  en: {
    title: 'Airfields & ports', civil: 'civil', military: 'military (by name)', strip: 'strip / helipad', closed: 'closed', ports: 'Ports',
    civilToggle: 'Civil', militaryToggle: 'Military', stripToggle: 'Strips & helipads', closedToggle: 'Closed', unavailable: 'Unavailable',
    near: 'near', type: 'Type', codes: 'Codes', country: 'Country', elevation: 'Elevation', runways: 'Runways', lit: 'lit',
    size: 'Harbour size', harbor: 'Harbour type', channel: 'Channel depth', anchorage: 'Anchorage depth', pier: 'Cargo pier depth', L: 'Large', M: 'Medium', S: 'Small', V: 'Very small',
    aircraft: 'Live aircraft nearby', ships: 'Live ships nearby',
  },
} as const;

const SURFACE: Record<string, [string, string]> = {
  ASP: ['asphalt', 'אספלט'], ASPH: ['asphalt', 'אספלט'], CON: ['concrete', 'בטון'], CONC: ['concrete', 'בטון'], PEM: ['asphalt/concrete', 'אספלט/בטון'],
  GRS: ['grass', 'דשא'], GRASS: ['grass', 'דשא'], TURF: ['grass', 'דשא'], GRE: ['gravel', 'חצץ'], GRVL: ['gravel', 'חצץ'], GVL: ['gravel', 'חצץ'],
  DIRT: ['dirt', 'עפר'], SAND: ['sand', 'חול'], UNK: ['unknown', 'לא ידוע'],
};

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const DASH = '—';
const m = (ft: number) => Math.round(ft * 0.3048);

function countryName(cc: string, lang: Lang): string {
  try {
    return new Intl.DisplayNames([lang === 'he' ? 'he' : 'en'], { type: 'region' }).of(cc) ?? cc;
  } catch {
    return cc;
  }
}

function row(label: string, value: string): string {
  return `<div style="display:flex;justify-content:space-between;gap:12px"><span style="color:#64748b">${esc(label)}</span><span dir="auto">${value}</span></div>`;
}

function shell(lang: Lang, name: string, near: string | null, kind: string, rows: string[], button: string, credit: string): string {
  const T = INFRA_TXT[lang];
  return `<div dir="${lang === 'he' ? 'rtl' : 'ltr'}" style="min-width:220px;font-size:12px;line-height:1.5">`
    + `<div style="font-weight:600;font-size:13px" dir="auto">${esc(name)}</div>`
    + (near ? `<div style="color:#475569">${esc(T.near)} ${esc(near)}</div>` : '')
    + `<div style="color:#64748b;margin-bottom:4px">${esc(kind)}</div>`
    + rows.join('')
    + `<button type="button" data-infra-traffic style="margin-top:6px;width:100%;border-radius:6px;background:#0284c7;color:#fff;padding:4px 8px;font-weight:600">${esc(button)}</button>`
    + `<div style="margin-top:4px;font-size:10px;color:#94a3b8">${esc(credit)}</div></div>`;
}

export function airfieldPopup(p: AirfieldProps, lang: Lang, near: string | null): string {
  const T = INFRA_TXT[lang];
  const codes = [p.icao, p.iata].filter(Boolean).map(esc).join(' · ') || DASH;
  const el = typeof p.el === 'number' ? `${p.el} ft (${m(p.el)} m)` : DASH;
  const rws = p.rw?.length
    ? p.rw.map((r) => {
      const surf = SURFACE[r.s?.toUpperCase()]?.[lang === 'he' ? 1 : 0] ?? (r.s || DASH);
      return `${m(r.l)} m (${r.l} ft) · ${esc(surf)}${r.lit ? ` · ${esc(T.lit)}` : ''}`;
    }).join('<br>')
    : DASH;
  return shell(lang, p.n, near, T[p.k], [
    row(T.codes, codes), row(T.country, esc(countryName(p.cc, lang))), row(T.elevation, el), row(T.runways, rws),
  ], T.aircraft, 'OurAirports');
}

export function portPopup(p: PortProps, lang: Lang, near: string | null): string {
  const T = INFRA_TXT[lang];
  const depth = (v?: number) => (typeof v === 'number' ? `${v} m` : DASH);
  return shell(lang, p.n, near, T.ports, [
    row(T.country, esc(countryName(p.cc, lang))), row(T.size, p.sz ? esc(T[p.sz]) : DASH), row(T.harbor, p.ty ? esc(p.ty) : DASH),
    row(T.channel, depth(p.ch)), row(T.anchorage, depth(p.an)), row(T.pier, depth(p.cp)),
  ], T.ships, 'NGA World Port Index');
}

const cache = new Map<string, Promise<GeoJSON.FeatureCollection>>();
/** /data/<kind>.geojson, fetched once per page; a failed load is forgotten so the next call retries. */
export function loadInfra(kind: 'airfields' | 'ports', fetcher: typeof fetch = fetch): Promise<GeoJSON.FeatureCollection> {
  let p = cache.get(kind);
  if (!p) {
    p = (async () => {
      const res = await fetcher(`/data/${kind}.geojson`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const fc = await res.json();
      if (!Array.isArray(fc?.features)) throw new Error('bad file');
      return fc as GeoJSON.FeatureCollection;
    })();
    cache.set(kind, p);
    p.catch(() => cache.delete(kind));
  }
  return p;
}
