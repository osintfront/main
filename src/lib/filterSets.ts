import type { PublicEvent } from '@/types/event';
import {
  EMPTY_FILTERS, eventAreas, eventPoints, matchesFilters, needsArchive, pointInPolygon, sanitizeFilters,
  type EventFilters, type LatLng,
} from './eventFilters.ts';

/**
 * Filter sets ("several filters"): up to 6 named, coloured filters, each a full filter of its own.
 * An event shows when it fits at least one set that is in force; while any set is in force the
 * general filter is paused. Pure rules only (no React, no storage) — tests/filters/filterSets.test.ts.
 *
 * Inside a set the fields work like the general filter (AND across fields, OR within one), with one
 * difference: the place is the chosen countries OR the drawn areas.
 */

export const MAX_SETS = 6;
export const MAX_POLYGONS = 3;
export const MAX_POLYGON_POINTS = 200;
export const MAX_NAME = 40;
export const SET_COLORS: readonly string[] = ['#7c3aed', '#d97706', '#059669', '#db2777', '#0891b2', '#65a30d'];

export type SetFilter = Omit<EventFilters, 'polygon' | 'eeis'> & { polygons: LatLng[][] };

export interface FilterSet {
  id: string;
  name: string;
  color: string;
  enabled: boolean;
  filter: SetFilter;
  /** Reserved for the free-text EEI feature; ignored for now. */
  text?: string;
}

export function fromEventFilters(f: EventFilters, polygons: LatLng[][]): SetFilter {
  const { polygon: _p, eeis: _e, ...rest } = f;
  return { ...rest, polygons };
}

export const EMPTY_SET_FILTER: SetFilter = fromEventFilters(EMPTY_FILTERS, []);

export function toEventFilters(f: SetFilter): EventFilters {
  const { polygons: _p, ...rest } = f;
  return { ...rest, polygon: null, eeis: [] };
}

function inAnyPolygon(points: LatLng[], polygons: LatLng[][]): boolean {
  return polygons.some((poly) => points.some((p) => pointInPolygon(p, poly)));
}

export function matchesSetFilter(e: PublicEvent, f: SetFilter, now = Date.now()): boolean {
  if (!matchesFilters(e, { ...toEventFilters(f), areas: [] }, now)) return false;
  if (!f.areas.length && !f.polygons.length) return true;
  if (f.areas.length) {
    const areas = eventAreas(e);
    if (f.areas.some((a) => areas.has(a))) return true;
  }
  return f.polygons.length > 0 && inAnyPolygon(eventPoints(e), f.polygons);
}

/** How many sets the plan allows: no feature → 0; otherwise its limit, at most 6. */
export function planSetLimit(hasFeature: boolean, limit: number | null): number {
  if (!hasFeature) return 0;
  return Math.max(0, Math.min(limit ?? MAX_SETS, MAX_SETS));
}

/** A set past the plan's limit (by its place in the list) is kept but cannot be in force. */
export function isLocked(sets: FilterSet[], id: string, limit: number): boolean {
  return sets.findIndex((s) => s.id === id) >= limit;
}

export function setsOn(sets: FilterSet[], limit: number): FilterSet[] {
  return sets.slice(0, Math.max(0, limit)).filter((s) => s.enabled);
}

/** The sets in force that the event fits, in list order (the first one colours it). */
export function matchingSets(e: PublicEvent, active: FilterSet[], now = Date.now()): FilterSet[] {
  return active.filter((s) => matchesSetFilter(e, s.filter, now));
}

/** One archive range covering every set in force that reaches past the live 24 hours. */
export function setsArchiveRange(active: FilterSet[], now = Date.now()): { from: string; to: string } | null {
  let out: { from: string; to: string } | null = null;
  for (const s of active) {
    const r = needsArchive(toEventFilters(s.filter), now);
    if (!r) continue;
    if (!out) out = { ...r };
    else {
      if (r.from < out.from) out.from = r.from;
      if (r.to > out.to) out.to = r.to;
    }
  }
  return out;
}

/** Does this set let a home-front alert through (its type and place)? */
export function setAcceptsAlert(set: FilterSet, points: LatLng[], alertCategory: string): boolean {
  const f = set.filter;
  if (f.categories.length && !f.categories.includes(alertCategory)) return false;
  if (!f.areas.length && !f.polygons.length) return true;
  if (f.areas.includes('israel')) return true;
  return inAnyPolygon(points, f.polygons);
}

/** Nothing chosen besides the time. */
export function isEmptySet(f: SetFilter): boolean {
  return (
    !f.areas.length && !f.polygons.length && !f.categories.length && !f.severities.length && !f.sources.length &&
    !f.media.length && !f.placeKinds.length && !f.breakingOnly && !f.verifiedOnly
  );
}

function freeColor(used: Iterable<string>): string {
  const taken = new Set(used);
  return SET_COLORS.find((c) => !taken.has(c)) ?? SET_COLORS[0];
}

let seq = 0;
export function newSet(existing: FilterSet[], name: string): FilterSet {
  return {
    id: `fs-${Date.now().toString(36)}-${(seq++).toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    name: name.trim().slice(0, MAX_NAME),
    color: freeColor(existing.map((s) => s.color)),
    enabled: true,
    filter: { ...EMPTY_SET_FILTER, polygons: [] },
  };
}

const validPolygon = (p: unknown): p is LatLng[] =>
  Array.isArray(p) && p.length >= 3 && p.length <= MAX_POLYGON_POINTS &&
  p.every((pt) => Array.isArray(pt) && pt.length === 2 && pt.every((x) => typeof x === 'number' && Number.isFinite(x)));

/** A drawn area added to a set. Same array back when it cannot be added (unknown/locked/full set, bad shape). */
export function addPolygon(sets: FilterSet[], id: string, points: LatLng[], limit: number): FilterSet[] {
  const i = sets.findIndex((s) => s.id === id);
  if (i < 0 || i >= limit || !validPolygon(points)) return sets;
  const s = sets[i];
  if (s.filter.polygons.length >= MAX_POLYGONS) return sets;
  const out = [...sets];
  out[i] = { ...s, filter: { ...s.filter, polygons: [...s.filter.polygons, points] } };
  return out;
}

/** Saved sets (already parsed) cleaned: whatever is stored, the page gets valid sets and never throws. */
export function sanitizeSets(raw: unknown): FilterSet[] {
  if (!Array.isArray(raw)) return [];
  const out: FilterSet[] = [];
  const ids = new Set<string>();
  for (const item of raw) {
    if (out.length >= MAX_SETS) break;
    if (!item || typeof item !== 'object') continue;
    const r = item as Record<string, unknown>;
    if (typeof r.id !== 'string' || !r.id || ids.has(r.id)) continue;
    ids.add(r.id);
    const rawFilter = r.filter && typeof r.filter === 'object' ? (r.filter as Record<string, unknown>) : null;
    const polygons = (Array.isArray(rawFilter?.polygons) ? rawFilter.polygons : []).filter(validPolygon).slice(0, MAX_POLYGONS);
    const color = typeof r.color === 'string' && SET_COLORS.includes(r.color) ? r.color : freeColor(out.map((s) => s.color));
    const set: FilterSet = {
      id: r.id,
      name: typeof r.name === 'string' ? r.name.slice(0, MAX_NAME) : '',
      color,
      enabled: typeof r.enabled === 'boolean' ? r.enabled : true,
      filter: fromEventFilters(sanitizeFilters(rawFilter), polygons),
    };
    if (typeof r.text === 'string') set.text = r.text;
    out.push(set);
  }
  return out;
}
