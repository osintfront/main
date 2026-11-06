// Ships upgrade: chokepoint stats (our own AIS history), silent ships and sanctioned vessels.
// No Leaflet here; the Supabase client is passed in, so this file runs in node tests.
import type { Vessel } from './intelLayers';

export type ChokepointId = 'hormuz' | 'bab_el_mandeb' | 'suez' | 'tiran' | 'bosphorus' | 'dardanelles';
export interface ChokepointStat {
  id: ChokepointId; crossings_24h: number; tankers_24h: number; avg_7d: number; days: number; pct_normal: number | null;
  waiting: { en: string; he: string; n: number }[];
  last: { mmsi: number; name: string | null; ship_type: number | null; dir_en: string; dir_he: string; at: string } | null;
}
export type Status = 'normal' | 'below' | 'low' | 'collecting';
export interface Sanction { n: string; l: string[] }

export const CHOKEPOINT_TXT = {
  he: {
    hormuz: 'מצר הורמוז', bab_el_mandeb: 'באב אל-מנדב', suez: 'תעלת סואץ', tiran: 'מצרי טיראן', bosphorus: 'הבוספורוס', dardanelles: 'הדרדנלים',
    title: 'נקודות חנק עכשיו', onMap: 'אוניות במפה', sanctioned: 'בסנקציות בים', silent: 'שקטות 24 ש׳+',
    normal: 'תקין', below: 'מתחת לרגיל', low: 'נמוך', collecting: 'אוסף נתוני בסיס', ofNormal: 'מהתנועה הרגילה',
    collectingDays: 'אוסף נתוני בסיס ({n} ימים)', crossings: 'מעברים ב-24 ש׳', tankers: 'מכליות', avg: 'ממוצע יומי, 7 ימים',
    waiting: 'ממתינות', last: 'מעבר אחרון', none: 'אין מעברים עדיין', seeMap: 'הצגה במפה', ago: 'לפני',
    footer: 'אוניות מסחריות שנקלטו בתחנות AIS חופיות; אונייה שה-AIS שלה כבוי לא נספרת.',
    silentLabel: 'AIS שקט 24 ש׳+ (ייתכן שמחוץ לטווח הקליטה)', silentSince: 'שקטה מאז', showSilent: 'הצגת אוניות שקטות', sanctionedLabel: 'בסנקציות',
  },
  en: {
    hormuz: 'Strait of Hormuz', bab_el_mandeb: 'Bab el-Mandeb', suez: 'Suez Canal', tiran: 'Strait of Tiran', bosphorus: 'Bosphorus', dardanelles: 'Dardanelles',
    title: 'Chokepoints now', onMap: 'ships on the map', sanctioned: 'sanctioned at sea', silent: 'silent 24 h+',
    normal: 'Normal', below: 'Below normal', low: 'Low', collecting: 'Collecting baseline', ofNormal: 'of normal traffic',
    collectingDays: 'Collecting baseline ({n} days)', crossings: 'crossings in 24 h', tankers: 'tankers', avg: 'a day, 7-day average',
    waiting: 'waiting', last: 'Last crossing', none: 'No crossings yet', seeMap: 'See it on the map', ago: 'ago',
    footer: 'Commercial ships seen by AIS shore receivers; a ship with AIS off is not counted.',
    silentLabel: 'AIS silent 24 h+ (may be out of receiver range)', silentSince: 'Silent since', showSilent: 'Show silent ships', sanctionedLabel: 'Sanctioned',
  },
} as const;

export function statusOf(pct: number | null): Status {
  if (pct === null || pct === undefined) return 'collecting';
  return pct >= 70 ? 'normal' : pct >= 30 ? 'below' : 'low';
}

export function imoValid(imo: number | string | null | undefined): boolean {
  const s = imo === null || imo === undefined ? '' : String(imo).trim();
  if (!/^\d{7}$/.test(s)) return false;
  let sum = 0;
  for (let i = 0; i < 6; i++) sum += Number(s[i]) * (7 - i);
  return sum % 10 === Number(s[6]);
}

export function sanctionOf(v: { imo: number | null }, list: Map<string, Sanction> | null): Sanction | null {
  if (!list || !imoValid(v.imo)) return null;
  return list.get(String(v.imo)) ?? null;
}

let sanctions: Map<string, Sanction> | null = null;
/** public/data/sanctioned-vessels.json → IMO → { name, lists }; null when it cannot be read (not cached). */
export async function loadSanctions(fetcher: typeof fetch = fetch): Promise<Map<string, Sanction> | null> {
  if (sanctions) return sanctions;
  try {
    const res = await fetcher('/data/sanctioned-vessels.json');
    if (!res.ok) return null;
    const out = await res.json();
    // The committed placeholder ({updated: null, vessels: {}}) means "not built yet": unknown, not zero.
    if (!out || !out.updated || typeof out.vessels !== 'object' || !Object.keys(out.vessels).length) return null;
    sanctions = new Map(Object.entries(out.vessels as Record<string, Sanction>));
    return sanctions;
  } catch {
    return null;
  }
}

export async function fetchChokepoints(rpc: (fn: string) => PromiseLike<{ data: unknown; error: unknown }>): Promise<ChokepointStat[]> {
  const { data, error } = await rpc('chokepoint_stats');
  if (error) throw new Error(String((error as { message?: string })?.message ?? error));
  return Array.isArray(data) ? (data as ChokepointStat[]) : [];
}

type Client = { from: (t: string) => any }; // eslint-disable-line @typescript-eslint/no-explicit-any
/** Ships last heard 24–72 h ago inside the given bounds. */
export async function fetchSilentVessels(db: Client, b: { south: number; west: number; north: number; east: number }): Promise<Vessel[]> {
  const now = Date.now();
  const { data, error } = await db.from('ais_vessels')
    .select('mmsi,name,callsign,imo,ship_type,destination,eta,length_m,lat,lng,sog,cog,heading,nav_status,updated_at')
    .gte('lat', b.south).lte('lat', b.north).gte('lng', b.west).lte('lng', b.east)
    .lt('updated_at', new Date(now - 24 * 3600_000).toISOString())
    .gte('updated_at', new Date(now - 72 * 3600_000).toISOString())
    .limit(3000);
  if (error) throw error;
  return (data ?? []) as Vessel[];
}
