/**
 * NASA FIRMS active-fire layers on NASA GIBS (WMS) and which days to ask for.
 *
 * Each satellite is requested on its own: GIBS fails the whole tile (an XML error instead
 * of a PNG) when any one layer in a request has no data for that day. Suomi NPP's VIIRS
 * has had no data since late October 2026, which blanked the combined layer for every
 * recent day; only older days (e.g. a chosen satellite-picture day) still showed fires.
 */
export const FIRE_LAYERS = [
  'VIIRS_NOAA20_Thermal_Anomalies_375m_All',
  'VIIRS_NOAA21_Thermal_Anomalies_375m_All',
  'VIIRS_SNPP_Thermal_Anomalies_375m_All',
] as const;

export interface FireRequest {
  layer: string;
  time: string; // YYYY-MM-DD (UTC)
}

/** A chosen day: that day and the one before; else yesterday and today (UTC). */
export function firesRequests(date: string | null, now: number = Date.now()): FireRequest[] {
  const base = date ? Date.parse(`${date}T12:00:00Z`) : now;
  const day = (offset: number) => new Date(base - offset * 86400_000).toISOString().slice(0, 10);
  const days = [day(1), day(0)];
  return days.flatMap((time) => FIRE_LAYERS.map((layer) => ({ layer, time })));
}
