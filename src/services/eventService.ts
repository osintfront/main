import { supabase } from '@/integrations/supabase/client';
import { FALLBACK_CATEGORY, categoryRefBySlug, safeColor } from '@/data/categoryRegistry';
import type { CategoryRef } from '@/types/category';
import { LOCATION_PRECISIONS, SEVERITIES, SOURCE_TYPES, type EventPlace, type EventSource, type LocationPrecision, type MediaKind, type PublicEvent, type Severity, type SourceType } from '@/types/event';
import { safeExternalUrl } from '@/utils/url';
import { sameNamedPlace } from '@/utils/places';
import { cleanReportText } from '@/utils/text';
import { ServiceError, toServiceError } from './serviceError';

/**
 * Columns of the `published_events` view. The view itself filters to
 * status = 'published' and exposes no internal fields; listing columns
 * explicitly (instead of `*`) keeps the contract obvious and reviewable.
 */
const PUBLIC_EVENT_COLUMNS = [
  'id',
  'title',
  'description',
  'severity',
  'latitude',
  'longitude',
  'location_name',
  'location_name_he',
  'location_name_en',
  'location_precision',
  'sources',
  'locations',
  'country',
  'region',
  'city',
  'source_name',
  'source_url',
  'source_type',
  'occurred_at',
  'published_at',
  'is_breaking',
  'is_verified',
  'translations',
  'category_id',
  'category_slug',
  'category_name',
  'category_icon',
  'category_color',
  'category_marker_color',
  'media_kinds',
  'report_group',
  'source_count',
  'secondary_categories',
].join(',');

interface PublishedEventRow {
  id: string;
  title: string | null;
  description: string | null;
  severity: string | null;
  latitude: number | string | null;
  longitude: number | string | null;
  location_name: string | null;
  location_name_he?: string | null;
  location_name_en?: string | null;
  location_precision?: string | null;
  sources?: unknown;
  locations?: unknown;
  country: string | null;
  region: string | null;
  city: string | null;
  source_name: string | null;
  source_url: string | null;
  source_type: string | null;
  occurred_at: string;
  published_at: string | null;
  is_breaking: boolean | null;
  is_verified: boolean | null;
  translations: unknown;
  category_id: string | null;
  category_slug: string | null;
  category_name: string | null;
  category_icon: string | null;
  category_color: string | null;
  category_marker_color: string | null;
  media_kinds?: string[] | null;
  report_group?: string | null;
  source_count?: number | null;
  secondary_categories?: string[] | null;
}

/** Secondary type slugs → known categories, without the main one, at most two. */
function secondaryRefs(raw: unknown, main: string): CategoryRef[] {
  if (!Array.isArray(raw)) return [];
  const out: CategoryRef[] = [];
  for (const s of raw) {
    if (typeof s !== 'string' || s === main || out.some((c) => c.slug === s)) continue;
    const ref = categoryRefBySlug(s);
    if (ref) out.push(ref);
  }
  return out.slice(0, 2);
}

function toNumber(value: number | string | null): number | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function asSeverity(value: string | null): Severity {
  return (SEVERITIES as readonly string[]).includes(value ?? '') ? (value as Severity) : 'medium';
}

function asSourceType(value: string | null): SourceType {
  return (SOURCE_TYPES as readonly string[]).includes(value ?? '') ? (value as SourceType) : 'other';
}

/** Validate the sources list from the database; only http(s) links pass. */
function toSources(v: unknown): EventSource[] {
  if (!Array.isArray(v)) return [];
  return v.flatMap((s) => {
    if (!s || typeof s !== 'object') return [];
    const o = s as { name?: unknown; url?: unknown; at?: unknown; kind?: unknown };
    const name = typeof o.name === 'string' ? o.name.trim().slice(0, 200) : '';
    const url = typeof o.url === 'string' ? safeExternalUrl(o.url) : null;
    if (!name && !url) return [];
    return [{ name, url, at: typeof o.at === 'string' ? o.at : null, kind: o.kind === 'context' ? ('context' as const) : null }];
  });
}

/** Extra places from the database, minus anything that is the main pin: within ~300 m, or the
 *  same place under another spelling or language (Mansuri / Mansouri, איסטנבול / Istanbul). */
function toPlaces(v: unknown, mainLat: number, mainLng: number, mainNames: string[] = []): EventPlace[] {
  if (!Array.isArray(v)) return [];
  const out: EventPlace[] = [];
  for (const [index, p] of v.entries()) {
    if (!p || typeof p !== 'object') continue;
    const o = p as { name?: unknown; name_en?: unknown; lat?: unknown; lng?: unknown; precision?: unknown; category_slug?: unknown };
    const lat = toNumber(typeof o.lat === 'number' || typeof o.lat === 'string' ? o.lat : null);
    const lng = toNumber(typeof o.lng === 'number' || typeof o.lng === 'string' ? o.lng : null);
    if (lat === null || lng === null || lat < -90 || lat > 90 || lng < -180 || lng > 180) continue;
    if (Math.abs(lat - mainLat) < 0.003 && Math.abs(lng - mainLng) < 0.003) continue;
    if (out.some((q) => Math.abs(q.latitude - lat) < 0.003 && Math.abs(q.longitude - lng) < 0.003)) continue;
    const names = [o.name, o.name_en].filter((x): x is string => typeof x === 'string');
    // The same place under another spelling/language, up to ~50 km off (the two came from
    // different geocoders): not a second place.
    const near = (a: number, b: number, c: number, d: number) => Math.abs(a - c) < 0.5 && Math.abs(b - d) < 0.5;
    if (near(lat, lng, mainLat, mainLng) && sameNamedPlace(names, mainNames)) continue;
    if (out.some((q) => near(q.latitude, q.longitude, lat, lng) && sameNamedPlace([q.name, q.nameEn], names))) continue;
    out.push({
      index,
      name: typeof o.name === 'string' ? o.name.slice(0, 120) : '',
      nameEn: typeof o.name_en === 'string' ? o.name_en.slice(0, 120) : '',
      latitude: lat,
      longitude: lng,
      precision: (LOCATION_PRECISIONS as readonly string[]).includes(String(o.precision)) ? (o.precision as LocationPrecision) : null,
      categorySlug: typeof o.category_slug === 'string' ? o.category_slug.slice(0, 60) : null,
    });
    if (out.length >= 30) break;
  }
  return out;
}

export function mapPublishedEventRow(row: PublishedEventRow): PublicEvent | null {
  let latitude = toNumber(row.latitude);
  let longitude = toNumber(row.longitude);
  // Published without a pin: listed in the feed only (no location precision → not on the map).
  const pinned = latitude !== null && longitude !== null && latitude >= -90 && latitude <= 90 && longitude >= -180 && longitude <= 180;
  if (!pinned) {
    latitude = 0;
    longitude = 0;
  }

  const category = row.category_slug
    ? {
        id: row.category_id,
        slug: row.category_slug,
        name: row.category_name ?? row.category_slug,
        icon: row.category_icon ?? FALLBACK_CATEGORY.icon,
        color: safeColor(row.category_color, FALLBACK_CATEGORY.color),
        markerColor: safeColor(row.category_marker_color ?? row.category_color, FALLBACK_CATEGORY.markerColor),
      }
    : FALLBACK_CATEGORY;

  const mainNames = [row.location_name ?? '', row.location_name_he ?? '', row.location_name_en ?? ''];
  let precision: LocationPrecision | null = pinned && (LOCATION_PRECISIONS as readonly string[]).includes(row.location_precision ?? '')
    ? (row.location_precision as LocationPrecision)
    : null;
  // The main pin is only the city ("Ankara") while the report's own place list has the exact
  // spot under the same name ("Ankara Esenboga Airport"): one pin, on the exact spot.
  if (pinned && precision !== 'exact' && Array.isArray(row.locations)) {
    for (const p of row.locations as { name?: unknown; name_en?: unknown; lat?: unknown; lng?: unknown; precision?: unknown }[]) {
      const lat = toNumber(typeof p?.lat === 'number' || typeof p?.lat === 'string' ? p.lat : null);
      const lng = toNumber(typeof p?.lng === 'number' || typeof p?.lng === 'string' ? p.lng : null);
      if (lat === null || lng === null || p?.precision !== 'exact') continue;
      if (Math.abs(lat - latitude!) >= 0.5 || Math.abs(lng - longitude!) >= 0.5) continue;
      if (!sameNamedPlace([String(p.name ?? ''), String(p.name_en ?? '')], mainNames)) continue;
      latitude = lat;
      longitude = lng;
      precision = 'exact';
      break;
    }
  }
  let places = pinned ? toPlaces(row.locations, latitude!, longitude!, mainNames) : [];
  let locationName = row.location_name ?? '';
  let locationNameHe = row.location_name_he ?? '';
  let locationNameEn = row.location_name_en ?? '';
  // The main pin is only the country or a wide area ("Lebanon") and the report lists a place
  // ("South Lebanon", a town): one pin, on the most specific place — not both.
  const rank = (p: LocationPrecision | null) => (p === 'country' ? 3 : p === 'region' ? 2 : p === 'city' ? 1 : 0);
  if (places.length && (precision === 'country' || precision === 'region' || (!locationName.trim() && precision !== 'exact'))) {
    const best = places.reduce((a, b) => (rank(b.precision) < rank(a.precision) ? b : a));
    if (rank(best.precision) <= rank(precision)) {
      latitude = best.latitude;
      longitude = best.longitude;
      precision = best.precision ?? 'exact';
      locationName = best.name || best.nameEn;
      locationNameHe = /[\u0590-\u05FF]/.test(best.name) ? best.name : '';
      locationNameEn = best.nameEn;
      places = places.filter((p) => p !== best);
    }
  }

  return {
    id: row.id,
    title: row.title ?? '',
    description: cleanReportText(row.description ?? ''),
    severity: asSeverity(row.severity),
    latitude: latitude ?? 0,
    longitude: longitude ?? 0,
    locationName,
    locationNameHe,
    locationNameEn,
    locationPrecision: precision,
    country: row.country ?? '',
    region: row.region ?? '',
    city: row.city ?? '',
    sourceName: row.source_name,
    // Never pass an unvalidated URL to the UI.
    sourceUrl: safeExternalUrl(row.source_url),
    sources: toSources(row.sources),
    sourceCount: typeof row.source_count === 'number' ? row.source_count : 0,
    places,
    sourceType: asSourceType(row.source_type),
    occurredAt: row.occurred_at,
    publishedAt: row.published_at,
    isBreaking: !!row.is_breaking,
    isVerified: !!row.is_verified,
    category,
    secondaryCategories: secondaryRefs(row.secondary_categories, category.slug),
    translations: row.translations && typeof row.translations === 'object' ? (row.translations as PublicEvent['translations']) : {},
    reportGroup: typeof row.report_group === 'string' && row.report_group ? row.report_group : null,
    mediaKinds: Array.isArray(row.media_kinds) ? (row.media_kinds.filter((k) => k === 'image' || k === 'video' || k === 'document') as MediaKind[]) : [],
  };
}

/** A live event as loaded, with its last-change stamp (`updated_at` in the view). */
export interface StampedEvent {
  event: PublicEvent;
  stamp: string;
}

/** Live view columns plus the change stamp (only the live view is read with a stamp). */
const STAMPED_COLUMNS = `${PUBLIC_EVENT_COLUMNS},updated_at`;

function toStamped(rows: (PublishedEventRow & { updated_at?: string | null })[]): StampedEvent[] {
  return rows.flatMap((row) => {
    const event = mapPublishedEventRow(row);
    return event ? [{ event, stamp: row.updated_at ?? '' }] : [];
  });
}

/** Every live event with its change stamp (the full load: first visit and the periodic safety reload). */
export async function fetchPublishedEventsStamped(max = 5000): Promise<StampedEvent[]> {
  if (!supabase) throw new ServiceError('not_configured', 'Supabase is not configured.');
  const PAGE = 1000;
  const rows: (PublishedEventRow & { updated_at?: string | null })[] = [];
  for (let from = 0; from < max; from += PAGE) {
    const { data, error } = await supabase
      .from('published_events')
      .select(STAMPED_COLUMNS)
      .order('occurred_at', { ascending: false })
      .order('id', { ascending: true })
      .range(from, Math.min(from + PAGE, max) - 1);
    if (error) throw toServiceError(error);
    const page = (data ?? []) as unknown as (PublishedEventRow & { updated_at?: string | null })[];
    rows.push(...page);
    if (page.length < PAGE) break;
  }
  return toStamped(rows);
}

/**
 * Just the id and change stamp of every live event, in feed order — about 3% of the full rows.
 * A refresh compares these with what is on screen and loads full rows only for what changed.
 */
export async function fetchPublishedEventStamps(max = 5000): Promise<{ id: string; stamp: string }[]> {
  if (!supabase) throw new ServiceError('not_configured', 'Supabase is not configured.');
  const PAGE = 1000;
  const out: { id: string; stamp: string }[] = [];
  for (let from = 0; from < max; from += PAGE) {
    const { data, error } = await supabase
      .from('published_events')
      .select('id,updated_at')
      .order('occurred_at', { ascending: false })
      .order('id', { ascending: true })
      .range(from, Math.min(from + PAGE, max) - 1);
    if (error) throw toServiceError(error);
    const page = (data ?? []) as { id: string; updated_at: string | null }[];
    for (const r of page) out.push({ id: r.id, stamp: r.updated_at ?? '' });
    if (page.length < PAGE) break;
  }
  return out;
}

/** Full rows of some live events (the new or changed ones), in batches that keep the URL short. */
export async function fetchPublishedEventsByIds(ids: string[]): Promise<StampedEvent[]> {
  if (!supabase) throw new ServiceError('not_configured', 'Supabase is not configured.');
  const BATCH = 150;
  const out: StampedEvent[] = [];
  for (let i = 0; i < ids.length; i += BATCH) {
    const { data, error } = await supabase.from('published_events').select(STAMPED_COLUMNS).in('id', ids.slice(i, i + BATCH));
    if (error) throw toServiceError(error);
    out.push(...toStamped((data ?? []) as unknown as (PublishedEventRow & { updated_at?: string | null })[]));
  }
  return out;
}

/**
 * Events that left the live map after their 24-hour lifetime (the public
 * `archived_events` view), for one time window.
 */
export async function fetchArchivedEvents(fromIso: string, toIso: string, max = 10000): Promise<PublicEvent[]> {
  if (!supabase) throw new ServiceError('not_configured', 'Supabase is not configured.');
  // Pages of 1000 (the API's page size): a busy day has more than 1000 events.
  const PAGE = 1000;
  const rows: PublishedEventRow[] = [];
  for (let from = 0; from < max; from += PAGE) {
    const { data, error } = await supabase
      .from('archived_events')
      .select(PUBLIC_EVENT_COLUMNS)
      .gte('occurred_at', fromIso)
      .lt('occurred_at', toIso)
      .order('occurred_at', { ascending: false })
      .order('id', { ascending: true })
      .range(from, Math.min(from + PAGE, max) - 1);
    if (error) throw toServiceError(error);
    const page = (data ?? []) as unknown as PublishedEventRow[];
    rows.push(...page);
    if (page.length < PAGE) break;
  }
  return rows.map(mapPublishedEventRow).filter((e): e is PublicEvent => e !== null);
}

/** Several public events by id (live and archived), e.g. the results of "ask the map". */
export async function fetchPublicEventsByIds(ids: string[]): Promise<PublicEvent[]> {
  const clean = ids.filter((id) => /^[0-9a-f-]{36}$/i.test(id)).slice(0, 200);
  if (!supabase || !clean.length) return [];
  const out = new Map<string, PublicEvent>();
  for (const view of ['published_events', 'archived_events']) {
    const missing = clean.filter((id) => !out.has(id));
    if (!missing.length) break;
    const { data, error } = await supabase.from(view).select(PUBLIC_EVENT_COLUMNS).in('id', missing);
    if (error) throw toServiceError(error);
    for (const row of (data ?? []) as unknown as PublishedEventRow[]) {
      const ev = mapPublishedEventRow(row);
      if (ev) out.set(ev.id, ev);
    }
  }
  return clean.map((id) => out.get(id)).filter((e): e is PublicEvent => !!e);
}

/** One event for a shared link (?event=<id>): live first, then the archive. */
export async function fetchPublicEvent(id: string): Promise<PublicEvent | null> {
  if (!supabase || !/^[0-9a-f-]{36}$/i.test(id)) return null;
  for (const view of ['published_events', 'archived_events']) {
    const { data } = await supabase.from(view).select(PUBLIC_EVENT_COLUMNS).eq('id', id).maybeSingle();
    if (data) return mapPublishedEventRow(data as unknown as PublishedEventRow);
  }
  return null;
}

/** fetchPublicEventsByIds for any number of ids (it takes 200 at a time). */
export async function fetchPublicEventsByIdsAll(ids: string[]): Promise<PublicEvent[]> {
  const out: PublicEvent[] = [];
  for (let i = 0; i < ids.length; i += 200) out.push(...(await fetchPublicEventsByIds(ids.slice(i, i + 200))));
  return out;
}
