import { supabase } from '@/integrations/supabase/client';
import { FALLBACK_CATEGORY, safeColor } from '@/data/categoryRegistry';
import { LOCATION_PRECISIONS, SEVERITIES, SOURCE_TYPES, type LocationPrecision, type PublicEvent, type Severity, type SourceType } from '@/types/event';
import { safeExternalUrl } from '@/utils/url';
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
  'location_precision',
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
].join(',');

interface PublishedEventRow {
  id: string;
  title: string | null;
  description: string | null;
  severity: string | null;
  latitude: number | string | null;
  longitude: number | string | null;
  location_name: string | null;
  location_precision?: string | null;
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

export function mapPublishedEventRow(row: PublishedEventRow): PublicEvent | null {
  const latitude = toNumber(row.latitude);
  const longitude = toNumber(row.longitude);
  if (latitude === null || longitude === null) return null;
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null;

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
    description: row.description ?? '',
    severity: asSeverity(row.severity),
    latitude,
    longitude,
    locationName: row.location_name ?? '',
    locationPrecision: (LOCATION_PRECISIONS as readonly string[]).includes(row.location_precision ?? '')
      ? (row.location_precision as LocationPrecision)
      : null,
    country: row.country ?? '',
    region: row.region ?? '',
    city: row.city ?? '',
    sourceName: row.source_name,
    // Never pass an unvalidated URL to the UI.
    sourceUrl: safeExternalUrl(row.source_url),
    sourceType: asSourceType(row.source_type),
    occurredAt: row.occurred_at,
    publishedAt: row.published_at,
    isBreaking: !!row.is_breaking,
    isVerified: !!row.is_verified,
    category,
    translations: row.translations && typeof row.translations === 'object' ? (row.translations as PublicEvent['translations']) : {},
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
