import {
  Bomb,
  Car,
  CircleDot,
  CloudLightning,
  Construction,
  Cpu,
  Crosshair,
  Flame,
  Footprints,
  HeartHandshake,
  Landmark,
  Megaphone,
  Plane,
  Rocket,
  ShieldAlert,
  Siren,
  Swords,
  type LucideIcon,
} from 'lucide-react';
import type { CategoryRef, CategorySlug, EventCategory } from '@/types/category';
import { FixedWingUav, Infiltration, Quadcopter } from './customIcons';

/**
 * Icons a category may reference by name. Category rows store the icon as a
 * string; only names listed here are rendered (unknown names fall back), which
 * keeps the bundle tree-shaken and stops arbitrary strings reaching the DOM.
 */
export const CATEGORY_ICONS: Record<string, LucideIcon> = {
  Crosshair,
  Rocket,
  Plane,
  Bomb,
  Footprints,
  ShieldAlert,
  Siren,
  Swords,
  Landmark,
  Megaphone,
  CloudLightning,
  Flame,
  Construction,
  Cpu,
  Car,
  HeartHandshake,
  CircleDot,
  Quadcopter,
  FixedWingUav,
  Infiltration,
};

export function getCategoryIcon(name: string | null | undefined): LucideIcon {
  return (name && CATEGORY_ICONS[name]) || CircleDot;
}

const HEX = /^#[0-9a-fA-F]{6}$/;
/** Colours come from the database and are injected into marker styles — validate first. */
export function safeColor(value: string | null | undefined, fallback = '#78716c'): string {
  return value && HEX.test(value) ? value : fallback;
}

interface CategoryDefinition {
  slug: CategorySlug;
  name: string;
  icon: string;
  color: string;
}

/** Mirrors supabase/migrations/20261019000003_default_categories.sql (+ 0007). */
export const DEFAULT_CATEGORIES: readonly CategoryDefinition[] = [
  // Filled automatically from Home Front Command alerts (migration 0007), not by staff.
  { slug: 'home-front-alerts', name: 'Home Front Command Alerts', icon: 'Siren', color: '#ff2d2d' },
  { slug: 'shooting-gunfire', name: 'Shooting / Gunfire', icon: 'Crosshair', color: '#e11d48' },
  { slug: 'missile-rocket-attack', name: 'Missile or Rocket Attack', icon: 'Rocket', color: '#f97316' },
  { slug: 'airstrike', name: 'Airstrike', icon: 'Plane', color: '#9333ea' },
  { slug: 'explosion', name: 'Explosion', icon: 'Bomb', color: '#dc2626' },
  { slug: 'infiltration', name: 'Infiltration', icon: 'Infiltration', color: '#a16207' },
  { slug: 'drone', name: 'Drone', icon: 'Quadcopter', color: '#0284c7' },
  { slug: 'uav', name: 'UAV', icon: 'FixedWingUav', color: '#6d28d9' },
  { slug: 'terror-security-incident', name: 'Terror or Security Incident', icon: 'ShieldAlert', color: '#7f1d1d' },
  { slug: 'military-activity', name: 'Military Activity', icon: 'Swords', color: '#4d7c0f' },
  { slug: 'political-event', name: 'Political Event', icon: 'Landmark', color: '#2563eb' },
  { slug: 'protest-civil-unrest', name: 'Protest or Civil Unrest', icon: 'Megaphone', color: '#db2777' },
  { slug: 'natural-disaster', name: 'Natural Disaster', icon: 'CloudLightning', color: '#0d9488' },
  { slug: 'fire', name: 'Fire', icon: 'Flame', color: '#f59e0b' },
  { slug: 'infrastructure-incident', name: 'Infrastructure Incident', icon: 'Construction', color: '#64748b' },
  { slug: 'cyber-incident', name: 'Cyber Incident', icon: 'Cpu', color: '#0891b2' },
  { slug: 'transportation-incident', name: 'Transportation Incident', icon: 'Car', color: '#4f46e5' },
  { slug: 'humanitarian-event', name: 'Humanitarian Event', icon: 'HeartHandshake', color: '#16a34a' },
  { slug: 'other', name: 'Other', icon: 'CircleDot', color: '#78716c' },
];

/** Demo-mode categories (used only when Supabase is not configured). */
export const DEMO_CATEGORIES: EventCategory[] = DEFAULT_CATEGORIES.map((c, i) => ({
  id: `demo-cat-${c.slug}`,
  name: c.name,
  slug: c.slug,
  description: '',
  icon: c.icon,
  color: c.color,
  markerColor: c.color,
  isActive: true,
  sortOrder: (i + 1) * 10,
}));

export const FALLBACK_CATEGORY: CategoryRef = {
  id: null,
  slug: 'other',
  name: 'Other',
  icon: 'CircleDot',
  color: '#78716c',
  markerColor: '#78716c',
};

export function demoCategoryRef(slug: CategorySlug): CategoryRef {
  const c = DEMO_CATEGORIES.find((x) => x.slug === slug);
  if (!c) return FALLBACK_CATEGORY;
  return { id: c.id, slug: c.slug, name: c.name, icon: c.icon, color: c.color, markerColor: c.markerColor };
}
