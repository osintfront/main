import { supabase } from '@/integrations/supabase/client';
import type { AlertGeometry, HfcAlert, HfcShape } from '@/types/hfcAlert';
import { ServiceError, toServiceError } from './serviceError';
import { subscribeToPulse } from './realtime';

/** Columns of the public `active_hfc_alerts` view (only clusters still on their 10-minute timer). */
const COLUMNS =
  'id,threat,started_at,last_alert_at,expires_at,areas,areas_en,zones_he,zones_en,alert_count,geojson,center_lat,center_lng,area_points';

interface Row {
  id: string;
  threat: number | null;
  started_at: string;
  last_alert_at: string;
  expires_at: string;
  areas: string[] | null;
  areas_en: string[] | null;
  zones_he: string[] | null;
  zones_en: string[] | null;
  alert_count: number | null;
  geojson: unknown;
  center_lat: number | string | null;
  center_lng: number | string | null;
  area_points?: unknown;
}

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

function num(v: number | string | null): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Accept only Polygon / MultiPolygon with numeric coordinates. */
function toGeometry(v: unknown): AlertGeometry | null {
  if (!v || typeof v !== 'object') return null;
  const g = v as { type?: unknown; coordinates?: unknown };
  if (!Array.isArray(g.coordinates)) return null;
  const ok = (ring: unknown) =>
    Array.isArray(ring) &&
    ring.every((p) => Array.isArray(p) && p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]));
  if (g.type === 'Polygon' && g.coordinates.every(ok)) return { type: 'Polygon', coordinates: g.coordinates as number[][][] };
  if (g.type === 'MultiPolygon' && g.coordinates.every((poly) => Array.isArray(poly) && poly.every(ok))) {
    return { type: 'MultiPolygon', coordinates: g.coordinates as number[][][][] };
  }
  return null;
}

function toPoints(v: unknown): HfcAlert['areaPoints'] {
  if (!Array.isArray(v)) return [];
  return v.flatMap((p) => {
    if (!p || typeof p !== 'object') return [];
    const o = p as { name?: unknown; name_en?: unknown; lat?: unknown; lng?: unknown };
    const lat = Number(o.lat);
    const lng = Number(o.lng);
    if (typeof o.name !== 'string' || !Number.isFinite(lat) || !Number.isFinite(lng)) return [];
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return [];
    return [{ name: o.name, nameEn: typeof o.name_en === 'string' ? o.name_en : null, lat, lng }];
  });
}

function mapRow(r: Row): HfcAlert {
  const lat = num(r.center_lat);
  const lng = num(r.center_lng);
  return {
    id: r.id,
    threat: typeof r.threat === 'number' ? r.threat : 8,
    startedAt: r.started_at,
    lastAlertAt: r.last_alert_at,
    expiresAt: r.expires_at,
    areas: strings(r.areas),
    areasEn: strings(r.areas_en),
    zonesHe: strings(r.zones_he),
    zonesEn: strings(r.zones_en),
    alertCount: r.alert_count ?? 0,
    geometry: toGeometry(r.geojson),
    center: lat !== null && lng !== null ? [lat, lng] : null,
    areaPoints: toPoints(r.area_points),
  };
}

export async function fetchActiveHfcAlerts(): Promise<HfcAlert[]> {
  if (!supabase) throw new ServiceError('not_configured', 'Supabase is not configured.');
  const { data, error } = await supabase
    .from('active_hfc_alerts')
    .select(COLUMNS)
    .order('last_alert_at', { ascending: false })
    .limit(100);
  if (error) throw toServiceError(error);
  return ((data ?? []) as unknown as Row[]).map(mapRow);
}

/** Merged polygons of neighbouring active alerts (display only). */
export async function fetchActiveHfcShapes(): Promise<HfcShape[]> {
  if (!supabase) throw new ServiceError('not_configured', 'Supabase is not configured.');
  const { data, error } = await supabase.rpc('active_hfc_shapes');
  if (error) throw toServiceError(error);
  if (!Array.isArray(data)) return [];
  return (data as { threat?: unknown; geojson?: unknown; alert_ids?: unknown }[]).flatMap((r) => {
    const geometry = toGeometry(r.geojson);
    if (!geometry) return [];
    return [{ threat: typeof r.threat === 'number' ? r.threat : 8, geometry, alertIds: strings(r.alert_ids) }];
  });
}

/** Calls `onChange` whenever the server records a new alert. Returns an unsubscribe function. */
export function subscribeHfcPulse(onChange: () => void): () => void {
  return subscribeToPulse('hfc_pulse', onChange, 150);
}
