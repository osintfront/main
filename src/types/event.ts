import type { CategoryRef } from './category';

export const EVENT_STATUSES = ['draft', 'pending_review', 'published', 'rejected', 'archived'] as const;
export type EventStatus = (typeof EVENT_STATUSES)[number];

export const SEVERITIES = ['low', 'medium', 'high', 'critical'] as const;
export type Severity = (typeof SEVERITIES)[number];

export const SOURCE_TYPES = [
  'manual_report',
  'news_website',
  'social_media',
  'official_statement',
  'emergency_service',
  'government_source',
  'military_source',
  'other',
] as const;
export type SourceType = (typeof SOURCE_TYPES)[number];

/**
 * How precisely the pin marks the event. 'region' / 'country' mean the report
 * named only an area, and the server placed the pin at that area's centre.
 */
export const LOCATION_PRECISIONS = ['exact', 'city', 'region', 'country'] as const;
export type LocationPrecision = (typeof LOCATION_PRECISIONS)[number];

export function isApproximateLocation(p: LocationPrecision | null | undefined): p is 'region' | 'country' {
  return p === 'region' || p === 'country';
}

/** A further outlet/channel that reported the same event (link when known, else just the name). */
export interface EventSource {
  name: string;
  url: string | null;
  at: string | null;
}

/** Optional per-language overrides, prepared for future translated titles/summaries. */
export type EventTranslations = Partial<Record<string, { title?: string; description?: string }>>;

/**
 * An event as the public site sees it. Built from the `published_events`
 * view, which exposes only public columns (no report text, notes, owners).
 */
export interface PublicEvent {
  id: string;
  title: string;
  description: string;
  severity: Severity;
  latitude: number;
  longitude: number;
  locationName: string;
  locationPrecision?: LocationPrecision | null;
  country: string;
  region: string;
  city: string;
  sourceName: string | null;
  sourceUrl: string | null;
  /** Additional sources for the same event. */
  sources?: EventSource[];
  sourceType: SourceType;
  occurredAt: string;
  publishedAt: string | null;
  isBreaking: boolean;
  isVerified: boolean;
  category: CategoryRef;
  translations: EventTranslations;
}

/** Full event as staff see it in the back office. */
export interface AdminEvent {
  id: string;
  title: string;
  description: string;
  originalReportText: string;
  categoryId: string | null;
  status: EventStatus;
  severity: Severity;
  latitude: number | null;
  longitude: number | null;
  locationName: string;
  country: string;
  region: string;
  city: string;
  address: string | null;
  locationPrecision: LocationPrecision | null;
  sourceName: string | null;
  sourceUrl: string | null;
  sourceType: SourceType;
  occurredAt: string;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  createdByName: string | null;
  approvedBy: string | null;
  isBreaking: boolean;
  isVerified: boolean;
  geocodingConfidence: number | null;
  classificationConfidence: number | null;
  coordinatesManuallyCorrected: boolean;
  rejectionReason: string | null;
  duplicateOfEventId: string | null;
  deletedAt: string | null;
  /** WhatsApp-ready text written by the editor agent (staff only). */
  whatsappText: string | null;
}

/** Editable fields of an event (what the form submits). */
export interface EventInput {
  title: string;
  description: string;
  originalReportText: string;
  categoryId: string | null;
  severity: Severity;
  latitude: number | null;
  longitude: number | null;
  locationName: string;
  country: string;
  region: string;
  city: string;
  address: string;
  locationPrecision: LocationPrecision | null;
  sourceName: string;
  sourceUrl: string;
  sourceType: SourceType;
  occurredAt: string;
  isBreaking: boolean;
  isVerified: boolean;
  geocodingConfidence: number | null;
  coordinatesManuallyCorrected: boolean;
}

export interface EventHistoryEntry {
  id: string;
  action: string;
  previousValues: Record<string, unknown>;
  newValues: Record<string, unknown>;
  changedBy: string | null;
  createdAt: string;
}
