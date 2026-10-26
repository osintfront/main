// Data for the map's intelligence layers: satellite pictures, ships (AIS) and aircraft (ADS-B).
import { supabase } from '@/integrations/supabase/client';

async function authHeader(): Promise<Record<string, string>> {
  if (!supabase) return {};
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return token ? { authorization: `Bearer ${token}` } : {};
}

// ── Satellite ──────────────────────────────────────────────────────
export type SatSource = 's2' | 'hlss30' | 'hlsl30' | 'viirs';
export const SAT_SOURCES: SatSource[] = ['s2', 'hlss30', 'hlsl30', 'viirs'];
export interface SatDay { date: string; cloud: number | null }

/** Tile URL of a source on a day ({z}/{x}/{y} for Leaflet), with its deepest real zoom. */
export function satTiles(src: SatSource, date: string, key: string): { url: string; maxNativeZoom: number; minZoom: number; attribution: string } {
  const gibs = (layer: string, level: number, ext: string) =>
    `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/${layer}/default/${date}/GoogleMapsCompatible_Level${level}/{z}/{y}/{x}.${ext}`;
  const nasa = 'Imagery: <a href="https://earthdata.nasa.gov/gibs">NASA GIBS</a>';
  switch (src) {
    case 's2':
      return { url: `/api/sat?tile={z}/{x}/{y}&date=${date}&k=${encodeURIComponent(key)}`, maxNativeZoom: 15, minZoom: 8, attribution: 'Contains modified Copernicus Sentinel data' };
    case 'hlss30':
      return { url: gibs('HLS_S30_Nadir_BRDF_Adjusted_Reflectance', 12, 'png'), maxNativeZoom: 12, minZoom: 1, attribution: `${nasa} · HLS Sentinel-2` };
    case 'hlsl30':
      return { url: gibs('HLS_L30_Nadir_BRDF_Adjusted_Reflectance', 12, 'png'), maxNativeZoom: 12, minZoom: 1, attribution: `${nasa} · HLS Landsat` };
    default:
      return { url: gibs('VIIRS_NOAA20_CorrectedReflectance_TrueColor', 9, 'jpeg'), maxNativeZoom: 9, minZoom: 1, attribution: `${nasa} · VIIRS NOAA-20` };
  }
}

export async function satKey(): Promise<{ k: string; sentinel2: boolean }> {
  const res = await fetch('/api/sat?key=1', { headers: await authHeader() });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/** Days with a picture of this area, newest first. VIIRS takes a picture every day. */
export async function satDays(src: SatSource, bbox: [number, number, number, number], days = 90): Promise<SatDay[]> {
  if (src === 'viirs') {
    return Array.from({ length: 45 }, (_, i) => ({ date: new Date(Date.now() - (i + 1) * 86400_000).toISOString().slice(0, 10), cloud: null }));
  }
  const res = await fetch(`/api/sat?dates=1&src=${src}&bbox=${bbox.map((v) => v.toFixed(3)).join(',')}&days=${days}`, { headers: await authHeader() });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const out = await res.json();
  return Array.isArray(out?.dates) ? out.dates : [];
}

// ── Ships (AIS) ────────────────────────────────────────────────────
export interface Vessel {
  mmsi: number; name: string | null; callsign: string | null; imo: number | null; ship_type: number | null;
  destination: string | null; eta: string | null; length_m: number | null; lat: number; lng: number;
  sog: number | null; cog: number | null; heading: number | null; nav_status: number | null; updated_at: string;
}

export const SHIP_KINDS = ['cargo', 'tanker', 'passenger', 'fishing', 'military', 'service', 'pleasure', 'fast', 'other'] as const;
export type ShipKind = (typeof SHIP_KINDS)[number];
export const SHIP_COLORS: Record<ShipKind, string> = {
  cargo: '#16a34a', tanker: '#dc2626', passenger: '#2563eb', fishing: '#f59e0b', military: '#111827',
  service: '#0891b2', pleasure: '#c026d3', fast: '#eab308', other: '#94a3b8',
};

/** The AIS ship type code → a kind for the map. */
export function shipKind(type: number | null): ShipKind {
  if (type === null) return 'other';
  if (type >= 70 && type <= 79) return 'cargo';
  if (type >= 80 && type <= 89) return 'tanker';
  if (type >= 60 && type <= 69) return 'passenger';
  if (type === 30) return 'fishing';
  if (type === 35 || type === 55) return 'military';
  if ([31, 32, 33, 34, 50, 51, 52, 53, 54, 58].includes(type)) return 'service';
  if (type === 36 || type === 37) return 'pleasure';
  if (type >= 40 && type <= 49) return 'fast';
  return 'other';
}

// The first three digits of the MMSI (MID) name the flag state.
const MID: Record<string, string> = {
  '201': 'AL', '205': 'BE', '209': 'CY', '210': 'CY', '211': 'DE', '212': 'CY', '215': 'MT', '218': 'DE', '219': 'DK', '220': 'DK',
  '224': 'ES', '225': 'ES', '226': 'FR', '227': 'FR', '228': 'FR', '229': 'MT', '230': 'FI', '232': 'GB', '233': 'GB', '234': 'GB', '235': 'GB',
  '236': 'GI', '237': 'GR', '238': 'HR', '239': 'GR', '240': 'GR', '241': 'GR', '244': 'NL', '245': 'NL', '246': 'NL', '247': 'IT', '248': 'MT',
  '249': 'MT', '255': 'PT', '256': 'MT', '257': 'NO', '258': 'NO', '259': 'NO', '261': 'PL', '263': 'PT', '265': 'SE', '266': 'SE', '271': 'TR',
  '272': 'UA', '273': 'RU', '304': 'AG', '305': 'AG', '308': 'BS', '309': 'BS', '311': 'BS', '312': 'BZ', '338': 'US', '341': 'KN', '351': 'PA',
  '352': 'PA', '353': 'PA', '354': 'PA', '355': 'PA', '356': 'PA', '357': 'PA', '366': 'US', '367': 'US', '368': 'US', '369': 'US', '370': 'PA',
  '371': 'PA', '372': 'PA', '373': 'PA', '374': 'PA', '375': 'VC', '376': 'VC', '377': 'VC', '403': 'SA', '405': 'BD', '408': 'BH', '412': 'CN',
  '413': 'CN', '414': 'CN', '416': 'TW', '419': 'IN', '422': 'IR', '425': 'IQ', '428': 'IL', '431': 'JP', '432': 'JP', '438': 'JO', '440': 'KR',
  '441': 'KR', '445': 'KP', '447': 'KW', '450': 'LB', '457': 'MN', '461': 'OM', '463': 'PK', '466': 'QA', '468': 'SY', '470': 'AE', '471': 'AE',
  '473': 'YE', '475': 'YE', '477': 'HK', '511': 'PW', '533': 'MY', '538': 'MH', '548': 'PH', '563': 'SG', '564': 'SG', '565': 'SG', '566': 'SG',
  '567': 'TH', '574': 'VN', '577': 'VU', '603': 'AO', '605': 'DZ', '613': 'CM', '616': 'KM', '620': 'KM', '621': 'DJ', '622': 'EG', '624': 'ER',
  '625': 'ER', '627': 'GA', '636': 'LR', '637': 'LR', '642': 'LY', '645': 'MU', '657': 'NG', '659': 'NA', '667': 'SL', '668': 'ST', '670': 'TD',
  '671': 'TG', '672': 'TN', '674': 'TZ', '677': 'TZ', '666': 'SO', '662': 'SD', '663': 'SN', '664': 'SC', '701': 'AR', '710': 'BR', '725': 'CL',
};
export function shipFlag(mmsi: number): string {
  return MID[String(mmsi).slice(0, 3)] ?? '';
}

export async function fetchVessels(bounds: { south: number; west: number; north: number; east: number }, maxAgeHours: number): Promise<Vessel[]> {
  if (!supabase) return [];
  const since = new Date(Date.now() - maxAgeHours * 3600_000).toISOString();
  const { data, error } = await supabase
    .from('ais_vessels')
    .select('mmsi,name,callsign,imo,ship_type,destination,eta,length_m,lat,lng,sog,cog,heading,nav_status,updated_at')
    .gte('lat', bounds.south).lte('lat', bounds.north).gte('lng', bounds.west).lte('lng', bounds.east)
    .gte('updated_at', since)
    .order('updated_at', { ascending: false })
    .limit(5000);
  if (error) throw error;
  return (data ?? []) as Vessel[];
}

// ── Aircraft (ADS-B) ───────────────────────────────────────────────
export interface Plane {
  hex: string; flight: string; reg: string; type: string; desc: string; lat: number; lon: number;
  alt: number | 'ground' | null; gs: number | null; track: number | null; squawk: string; mil: boolean; category: string; seen: number | null;
}

export async function fetchPlanes(center: { lat: number; lng: number }, radiusNm: number, militaryWorld: boolean): Promise<Plane[]> {
  const url = militaryWorld ? '/api/aircraft?mil=1' : `/api/aircraft?lat=${center.lat.toFixed(2)}&lon=${center.lng.toFixed(2)}&dist=${Math.round(radiusNm)}`;
  const res = await fetch(url, { headers: await authHeader() });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const out = await res.json();
  return Array.isArray(out?.planes) ? out.planes : [];
}

export const EMERGENCY_SQUAWKS = ['7500', '7600', '7700'];
