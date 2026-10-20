/** GeoJSON geometry of an alert polygon (lng/lat order, as in GeoJSON). */
export type AlertGeometry =
  | { type: 'Polygon'; coordinates: number[][][] }
  | { type: 'MultiPolygon'; coordinates: number[][][][] };

/**
 * An active Home Front Command alert as the public map sees it: one or more
 * neighbouring alert areas of the same threat, merged into one polygon.
 * It disappears `expiresAt` (10 minutes after the last alert in it).
 */
export interface HfcAlert {
  id: string;
  /** Tzofar threat code (see src/config/hfcThreats.ts). */
  threat: number;
  startedAt: string;
  lastAlertAt: string;
  expiresAt: string;
  /** Area names in Hebrew, as published by the Home Front Command. */
  areas: string[];
  areasEn: string[];
  zonesHe: string[];
  zonesEn: string[];
  alertCount: number;
  geometry: AlertGeometry | null;
  center: [number, number] | null;
  /** One point per alerted place, so each place gets its own pin. */
  areaPoints: { name: string; nameEn: string | null; lat: number; lng: number }[];
}

/**
 * Display-only union of touching alert polygons of the same threat. The
 * alerts inside stay separate events (own card, pin and timer).
 */
export interface HfcShape {
  threat: number;
  geometry: AlertGeometry;
  alertIds: string[];
}
