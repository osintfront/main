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
  country: string;
  region: string;
  city: string;
  sourceName: string | null;
  sourceUrl: string | null;
  sourceType: SourceType;
  occurredAt: string;
  publishedAt: string | null;
  isBreaking: boolean;
  isVerified: boolean;
  category: CategoryRef;
  translations: EventTranslations;
}
