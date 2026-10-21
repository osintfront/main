/** Canonical category slugs. Stored in English; display names are translated in src/i18n. */
export const CATEGORY_SLUGS = [
  'home-front-alerts',
  'shooting-gunfire',
  'missile-rocket-attack',
  'airstrike',
  'explosion',
  'infiltration',
  'drone',
  'uav',
  'terror-security-incident',
  'military-activity',
  'political-event',
  'protest-civil-unrest',
  'natural-disaster',
  'fire',
  'infrastructure-incident',
  'cyber-incident',
  'transportation-incident',
  'humanitarian-event',
  'other',
] as const;

export type CategorySlug = (typeof CATEGORY_SLUGS)[number];

export interface EventCategory {
  id: string;
  /** Canonical English name. Use `categoryLabel()` from i18n for display. */
  name: string;
  slug: string;
  description: string;
  /** Lucide icon component name, e.g. "Rocket". Resolved through the icon registry. */
  icon: string;
  color: string;
  markerColor: string;
  isActive: boolean;
  sortOrder: number;
}

/** The subset of category data that travels with a public event. */
export interface CategoryRef {
  id: string | null;
  slug: string;
  name: string;
  icon: string;
  color: string;
  markerColor: string;
}
