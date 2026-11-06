// Military bases: names, flags and popups for the static files built by tools/military/build_military.py.
// No Leaflet / Supabase here, so it runs in node tests as is (the map part is components/map/MilitaryLayers.tsx).
import { INFRA_TXT, countryName, esc, infoRow } from './infra.ts';

export type MilKind = 'base' | 'naval' | 'range' | 'minor';
export interface MilProps {
  k: MilKind; n?: string; en?: string; he?: string; cc: string;
  op?: string; opn?: string; f?: true; air?: true; km2?: number; osm?: string; wd?: string;
}
type Lang = 'he' | 'en';

export const MIL_TXT = {
  he: {
    title: 'בסיסים צבאיים', base: 'בסיסים', naval: 'בסיסים ימיים', range: 'שטחי אימונים ואזורים צבאיים', minor: 'בונקרים ומחסומים',
    kind: { base: 'בסיס צבאי', naval: 'בסיס ימי', range: 'שטח אימונים / אזור צבאי', minor: 'בונקר / מחסום' }, air: 'בסיס אווירי',
    foreignOnly: 'רק בהפעלה זרה', foreign: 'בהפעלה זרה', zoomIn: 'יש להתקרב כדי לראות', notBuilt: 'טרם נבנה', unavailable: INFRA_TXT.he.unavailable,
    unnamed: 'אתר ללא שם', operatedBy: 'מופעל על ידי', size: 'שטח', coords: 'קואורדינטות', country: 'מדינה', near: INFRA_TXT.he.near,
  },
  en: {
    title: 'Military bases', base: 'Bases', naval: 'Naval bases', range: 'Ranges & zones', minor: 'Bunkers & checkpoints',
    kind: { base: 'military base', naval: 'naval base', range: 'range / military zone', minor: 'bunker / checkpoint' }, air: 'air base',
    foreignOnly: 'Foreign-operated only', foreign: 'Foreign-operated', zoomIn: 'zoom in to see', notBuilt: 'Not built yet', unavailable: INFRA_TXT.en.unavailable,
    unnamed: 'Unnamed site', operatedBy: 'Operated by', size: 'Size', coords: 'Coordinates', country: 'Country', near: INFRA_TXT.en.near,
  },
} as const;

export const MIL_COLORS: Record<MilKind, string> = { base: '#4d7c0f', naval: '#1e3a8a', range: '#b45309', minor: '#475569' };
export const MIL_GLYPH: Record<MilKind, string> = { base: '★', naval: '⚓', range: '◎', minor: '' };
export const FOREIGN_RING = '#eab308';
const DASH = '—';
const OSM_TYPES: Record<string, string> = { n: 'node', w: 'way', r: 'relation' };

/** The flag emoji for a two-letter code ('' when there is none). */
export function flag(cc?: string): string {
  if (!cc || !/^[A-Za-z]{2}$/.test(cc)) return '';
  return String.fromCodePoint(...[...cc.toUpperCase()].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
}

/** Hebrew UI: Hebrew → English → local name; English UI: English → local name. */
export function milName(p: MilProps, lang: Lang): string | null {
  return (lang === 'he' ? p.he || p.en || p.n : p.en || p.n) || null;
}

export function militaryPopup(p: MilProps, lang: Lang, near: string | null, lat: number, lng: number): string {
  const T = MIL_TXT[lang];
  const rows = [infoRow(T.country, esc(countryName(p.cc, lang)))];
  if (p.op || p.opn) {
    const cn = p.op ? countryName(p.op, lang) : '';
    const who = `${flag(p.op)} ${esc(p.opn || cn)}${p.opn && cn && lang === 'he' ? ` (${esc(cn)})` : ''}`.trim();
    rows.push(infoRow(T.operatedBy, p.f
      ? `<span style="background:#fef9c3;border:1px solid ${FOREIGN_RING};border-radius:4px;padding:0 4px;color:#713f12">${who}</span>`
      : who));
  }
  rows.push(infoRow(T.size, typeof p.km2 === 'number' ? `≈ ${p.km2} km²` : DASH));
  rows.push(infoRow(T.coords, `<span dir="ltr">${lat.toFixed(5)}, ${lng.toFixed(5)}</span>`));
  const links = [];
  const osm = p.osm?.match(/^([nwr])(\d+)$/);
  if (osm) links.push(`<a href="https://www.openstreetmap.org/${OSM_TYPES[osm[1]]}/${osm[2]}" target="_blank" rel="noopener noreferrer">OpenStreetMap</a>`);
  if (p.wd && /^Q\d+$/.test(p.wd)) links.push(`<a href="https://www.wikidata.org/wiki/${p.wd}" target="_blank" rel="noopener noreferrer">Wikidata</a>`);
  const credit = p.wd ? '© OpenStreetMap contributors · Wikidata' : '© OpenStreetMap contributors';
  return `<div dir="${lang === 'he' ? 'rtl' : 'ltr'}" style="min-width:220px;font-size:12px;line-height:1.5">`
    + `<div style="font-weight:600;font-size:13px" dir="auto">${esc(milName(p, lang) ?? T.unnamed)}</div>`
    + (near ? `<div style="color:#475569">${esc(T.near)} ${esc(near)}</div>` : '')
    + `<div style="color:#64748b;margin-bottom:4px">${esc(p.air ? T.air : T.kind[p.k])}</div>`
    + rows.join('')
    + (links.length ? `<div style="margin-top:6px;display:flex;gap:10px;color:#0369a1">${links.join('')}</div>` : '')
    + `<div style="margin-top:4px;font-size:10px;color:#94a3b8">${esc(credit)}</div></div>`;
}
