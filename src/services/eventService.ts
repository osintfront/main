import { supabase } from '@/integrations/supabase/client';
import { FALLBACK_CATEGORY, safeColor } from '@/data/categoryRegistry';
import { LOCATION_PRECISIONS, SEVERITIES, SOURCE_TYPES, type EventPlace, type EventSource, type LocationPrecision, type MediaKind, type PublicEvent, type Severity, type SourceType } from '@/types/event';
import { safeExternalUrl } from '@/utils/url';
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

/** Extra places from the database, minus anything sitting on the main pin (within ~300 m). */
function toPlaces(v: unknown, mainLat: number, mainLng: number): EventPlace[] {
  if (!Array.isArray(v)) return [];
  const out: EventPlace[] = [];
  for (const [index, p] of v.entries()) {
    if (!p || typeof p !== 'object') continue;
    const o = p as { name?: unknown; name_en?: unknown; lat?: unknown; lng?: unknown; precision?: unknown };
    const lat = toNumber(typeof o.lat === 'number' || typeof o.lat === 'string' ? o.lat : null);
    const lng = toNumber(typeof o.lng === 'number' || typeof o.lng === 'string' ? o.lng : null);
    if (lat === null || lng === null || lat < -90 || lat > 90 || lng < -180 || lng > 180) continue;
    if (Math.abs(lat - mainLat) < 0.003 && Math.abs(lng - mainLng) < 0.003) continue;
    if (out.some((q) => Math.abs(q.latitude - lat) < 0.003 && Math.abs(q.longitude - lng) < 0.003)) continue;
    out.push({
      index,
      name: typeof o.name === 'string' ? o.name.slice(0, 120) : '',
      nameEn: typeof o.name_en === 'string' ? o.name_en.slice(0, 120) : '',
      latitude: lat,
      longitude: lng,
      precision: (LOCATION_PRECISIONS as readonly string[]).includes(String(o.precision)) ? (o.precision as LocationPrecision) : null,
    });
    if (out.length >= 10) break;
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

  return {
    id: row.id,
    title: row.title ?? '',
    description: cleanReportText(row.description ?? ''),
    severity: asSeverity(row.severity),
    latitude: latitude ?? 0,
    longitude: longitude ?? 0,
    locationName: row.location_name ?? '',
    locationNameHe: row.location_name_he ?? '',
    locationNameEn: row.location_name_en ?? '',
    locationPrecision: pinned && (LOCATION_PRECISIONS as readonly string[]).includes(row.location_precision ?? '')
      ? (row.location_precision as LocationPrecision)
      : null,
    country: row.country ?? '',
    region: row.region ?? '',
    city: row.city ?? '',
    sourceName: row.source_name,
    // Never pass an unvalidated URL to the UI.
    sourceUrl: safeExternalUrl(row.source_url),
    sources: toSources(row.sources),
    places: pinned ? toPlaces(row.locations, latitude!, longitude!) : [],
    sourceType: asSourceType(row.source_type),
    occurredAt: row.occurred_at,
    publishedAt: row.published_at,
    isBreaking: !!row.is_breaking,
    isVerified: !!row.is_verified,
    category,
    translations: row.translations && typeof row.translations === 'object' ? (row.translations as PublicEvent['translations']) : {},
    mediaKinds: Array.isArray(row.media_kinds) ? (row.media_kinds.filter((k) => k === 'image' || k === 'video' || k === 'document') as MediaKind[]) : [],
  };
}

export async function fetchPublishedEvents(limit = 500): Promise<PublicEvent[]> {
  if (!supabase) throw new ServiceError('not_configured', 'Supabase is not configured.');
  const { data, error } = await supabase
    .from('published_events')
    .select(PUBLIC_EVENT_COLUMNS)
    .order('occurred_at', { ascending: false })
    .limit(limit);
  if (error) throw toServiceError(error);
  return ((data ?? []) as unknown as PublishedEventRow[])
    .map(mapPublishedEventRow)
    .filter((e): e is PublicEvent => e !== null);
}

/**
 * Events that left the live map after their 24-hour lifetime (the public
 * `archived_events` view), for one time window.
 */
export async function fetchArchivedEvents(fromIso: string, toIso: string, limit = 1000): Promise<PublicEvent[]> {
  if (!supabase) throw new ServiceError('not_configured', 'Supabase is not configured.');
  const { data, error } = await supabase
    .from('archived_events')
    .select(PUBLIC_EVENT_COLUMNS)
    .gte('occurred_at', fromIso)
    .lt('occurred_at', toIso)
    .order('occurred_at', { ascending: false })
    .limit(limit);
  if (error) throw toServiceError(error);
  return ((data ?? []) as unknown as PublishedEventRow[])
    .map(mapPublishedEventRow)
    .filter((e): e is PublicEvent => e !== null);
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
