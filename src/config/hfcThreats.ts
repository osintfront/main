import type { CategoryRef } from '@/types/category';
import type { HfcAlert } from '@/types/hfcAlert';

export const HFC_THREAT_KEYS = [
  'missiles',
  'hazmat',
  'infiltration',
  'earthquake',
  'tsunami',
  'aircraft',
  'radiological',
  'unconventional',
  'general',
  'drill',
] as const;
export type HfcThreatKey = (typeof HFC_THREAT_KEYS)[number];

/** Threat codes used by the Tzofar feed (index = code). */
const THREATS: Record<number, { key: HfcThreatKey; color: string }> = {
  0: { key: 'missiles', color: '#ff2d2d' },
  1: { key: 'hazmat', color: '#eab308' },
  2: { key: 'infiltration', color: '#a855f7' },
  3: { key: 'earthquake', color: '#c2410c' },
  4: { key: 'tsunami', color: '#0ea5e9' },
  5: { key: 'aircraft', color: '#f97316' },
  6: { key: 'radiological', color: '#84cc16' },
  7: { key: 'unconventional', color: '#16a34a' },
  8: { key: 'general', color: '#ff2d2d' },
  9: { key: 'drill', color: '#64748b' },
};

export function threatInfo(code: number): { key: HfcThreatKey; color: string } {
  return THREATS[code] ?? THREATS[8];
}

/** The category alert cards and the legend show. Mirrors migration 0007. */
export const HFC_CATEGORY: CategoryRef = {
  id: null,
  slug: 'home-front-alerts',
  name: 'Home Front Command Alerts',
  icon: 'Siren',
  color: '#ff2d2d',
  markerColor: '#ff2d2d',
};

/** Area / zone names in the reader's language (Hebrew is the source). */
export function alertNames(alert: HfcAlert, lang: string): { areas: string[]; zones: string[] } {
  const he = lang === 'he';
  return {
    areas: he || alert.areasEn.length !== alert.areas.length ? alert.areas : alert.areasEn,
    zones: he ? alert.zonesHe : alert.zonesEn.length ? alert.zonesEn : alert.zonesHe,
  };
}

/** Headline: the place itself for a single-area alert, else "Upper Galilee, Haifa Bay +2". */
export function zoneHeadline(zones: string[], areas: string[], max = 3): string {
  if (areas.length === 1) return areas[0];
  const list = zones.length ? zones : areas;
  const head = list.slice(0, max).join(', ');
  return list.length > max ? `${head} +${list.length - max}` : head;
}

/** mm:ss until the alert disappears. */
export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}
