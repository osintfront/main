import { supabase } from '@/integrations/supabase/client';
import { LOCATION_PRECISIONS, SEVERITIES, SOURCE_TYPES, type AdminEvent, type LocationPrecision, type EventHistoryEntry, type EventInput, type EventStatus, type Severity, type SourceType } from '@/types/event';
import { safeExternalUrl } from '@/utils/url';
import { ServiceError, toServiceError } from './serviceError';

/** Staff-facing service for events. Every rule here is also enforced by RLS + triggers. */

const ADMIN_EVENT_COLUMNS = [
  'id', 'title', 'description', 'original_report_text', 'category_id', 'status', 'severity',
  'latitude', 'longitude', 'location_name', 'country', 'region', 'city', 'address', 'location_precision',
  'source_name', 'source_url', 'source_type', 'occurred_at', 'published_at', 'created_at', 'updated_at',
  'created_by', 'approved_by', 'is_breaking', 'is_verified', 'geocoding_confidence', 'classification_confidence',
  'coordinates_manually_corrected', 'rejection_reason', 'duplicate_of_event_id', 'deleted_at', 'review_requested_at',
  // Name of the reporter. RLS on profiles returns null for staff who may not read other profiles.
  'creator:profiles!events_created_by_fkey(full_name,email)',
].join(',');

interface EventRow {
  id: string;
  title: string;
  description: string;
  original_report_text: string;
  category_id: string | null;
  status: EventStatus;
  severity: string;
  latitude: number | string | null;
  longitude: number | string | null;
  location_name: string;
  country: string;
  region: string;
  city: string;
  address: string | null;
  location_precision: string | null;
  source_name: string | null;
  source_url: string | null;
  source_type: string;
  occurred_at: string;
  published_at: string | null;
  created_at: string;
  updated_at: string;
  created_by: string;
  approved_by: string | null;
  is_breaking: boolean;
  is_verified: boolean;
  geocoding_confidence: number | string | null;
  classification_confidence: number | string | null;
  coordinates_manually_corrected: boolean;
  rejection_reason: string | null;
  duplicate_of_event_id: string | null;
  deleted_at: string | null;
  review_requested_at?: string | null;
  creator?: { full_name: string; email: string } | null;
}

function num(v: number | string | null): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function mapRow(r: EventRow): AdminEvent {
  return {
    id: r.id,
    title: r.title,
    description: r.description,
    originalReportText: r.original_report_text,
    categoryId: r.category_id,
    status: r.status,
    severity: (SEVERITIES as readonly string[]).includes(r.severity) ? (r.severity as Severity) : 'medium',
    latitude: num(r.latitude),
    longitude: num(r.longitude),
    locationName: r.location_name,
    country: r.country,
    region: r.region,
    city: r.city,
    address: r.address,
    locationPrecision: (LOCATION_PRECISIONS as readonly string[]).includes(r.location_precision ?? '')
      ? (r.location_precision as LocationPrecision)
      : null,
    sourceName: r.source_name,
    sourceUrl: r.source_url,
    sourceType: (SOURCE_TYPES as readonly string[]).includes(r.source_type) ? (r.source_type as SourceType) : 'other',
    occurredAt: r.occurred_at,
    publishedAt: r.published_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    createdBy: r.created_by,
    createdByName: r.creator ? r.creator.full_name || r.creator.email : null,
    approvedBy: r.approved_by,
    isBreaking: r.is_breaking,
    isVerified: r.is_verified,
    geocodingConfidence: num(r.geocoding_confidence),
    classificationConfidence: num(r.classification_confidence),
    coordinatesManuallyCorrected: r.coordinates_manually_corrected,
    rejectionReason: r.rejection_reason,
    duplicateOfEventId: r.duplicate_of_event_id,
    deletedAt: r.deleted_at,
    reviewRequestedAt: r.review_requested_at ?? null,
  };
}

/** Plain-text normalisation for user input. Descriptions are never rendered as HTML. */
function clean(s: string, max: number): string {
  // Drop control characters except newlines/tabs; trim; cap length.
  return s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim().slice(0, max);
}

function toRow(input: EventInput) {
  return {
    title: clean(input.title, 200),
    description: clean(input.description, 5000),
    original_report_text: clean(input.originalReportText, 10000),
    category_id: input.categoryId,
    severity: input.severity,
    latitude: input.latitude === null ? null : Math.round(input.latitude * 1e6) / 1e6,
    longitude: input.longitude === null ? null : Math.round(input.longitude * 1e6) / 1e6,
    location_name: clean(input.locationName, 200),
    country: clean(input.country, 100),
    region: clean(input.region, 100),
    city: clean(input.city, 100),
    address: clean(input.address, 300) || null,
    // No coordinates → null, and the server places the pin from the place names.
    location_precision: input.latitude === null || input.longitude === null ? null : (input.locationPrecision ?? 'exact'),
    source_name: clean(input.sourceName, 200) || null,
    source_url: safeExternalUrl(input.sourceUrl),
    source_type: input.sourceType,
    occurred_at: new Date(input.occurredAt).toISOString(),
    is_breaking: input.isBreaking,
    is_verified: input.isVerified,
    geocoding_confidence: input.geocodingConfidence,
    coordinates_manually_corrected: input.coordinatesManuallyCorrected,
    ...(input.locations
      ? {
          locations: input.locations.slice(0, 30).map((l) => ({
            name: clean(l.name, 120),
            name_en: clean(l.name_en, 120),
            lat: l.lat,
            lng: l.lng,
            ...(l.precision ? { precision: l.precision } : {}),
            ...(l.category_slug ? { category_slug: l.category_slug } : {}),
          })),
        }
      : {}),
  };
}

function client() {
  if (!supabase) throw new ServiceError('not_configured', 'Supabase is not configured.');
  return supabase;
}

// ── Queries ─────────────────────────────────────────────────────────

export interface EventFilters {
  search?: string;
  status?: EventStatus | 'all' | 'deleted' | 'review';
  categoryId?: string;
  severity?: Severity | '';
  country?: string;
  verified?: 'yes' | 'no' | '';
  breaking?: 'yes' | 'no' | '';
  from?: string; // yyyy-mm-dd
  to?: string;
  mine?: boolean;
  userId?: string | null;
}

export const PAGE_SIZE = 25;

/** Escapes a value for use inside a PostgREST `or=(…ilike…)` filter. */
function likeTerm(s: string): string {
  return s.replace(/[\\%_,()*"]/g, ' ').trim();
}

export async function listEvents(filters: EventFilters, page = 0): Promise<{ events: AdminEvent[]; total: number }> {
  let q = client()
    .from('events')
    .select(ADMIN_EVENT_COLUMNS, { count: 'exact' })
    .order('occurred_at', { ascending: false })
    .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);

  if (filters.status === 'deleted') q = q.not('deleted_at', 'is', null);
  else {
    q = q.is('deleted_at', null);
    // Waiting for an admin: in review, or a live event an editor changed.
    if (filters.status === 'review') q = q.or('status.eq.pending_review,review_requested_at.not.is.null');
    else if (filters.status && filters.status !== 'all') q = q.eq('status', filters.status);
  }
  if (filters.categoryId) q = q.eq('category_id', filters.categoryId);
  if (filters.severity) q = q.eq('severity', filters.severity);
  if (filters.country?.trim()) q = q.ilike('country', `%${likeTerm(filters.country)}%`);
  if (filters.verified) q = q.eq('is_verified', filters.verified === 'yes');
  if (filters.breaking) q = q.eq('is_breaking', filters.breaking === 'yes');
  if (filters.from) q = q.gte('occurred_at', new Date(`${filters.from}T00:00:00`).toISOString());
  if (filters.to) q = q.lte('occurred_at', new Date(`${filters.to}T23:59:59`).toISOString());
  if (filters.mine && filters.userId) q = q.eq('created_by', filters.userId);
  const term = likeTerm(filters.search ?? '');
  if (term) {
    q = q.or(
      ['title', 'description', 'location_name', 'city', 'country', 'original_report_text']
        .map((c) => `${c}.ilike.*${term}*`)
        .join(','),
    );
  }

  const { data, error, count } = await q;
  if (error) throw toServiceError(error);
  return { events: ((data ?? []) as unknown as EventRow[]).map(mapRow), total: count ?? 0 };
}

export async function getEvent(id: string): Promise<AdminEvent> {
  const { data, error } = await client().from('events').select(ADMIN_EVENT_COLUMNS).eq('id', id).maybeSingle();
  if (error) throw toServiceError(error);
  if (!data) throw new ServiceError('not_found', 'This event does not exist or you do not have access to it.');
  return mapRow(data as unknown as EventRow);
}

export async function getInternalNotes(eventId: string): Promise<string> {
  const { data, error } = await client().from('event_internal_notes').select('notes').eq('event_id', eventId).maybeSingle();
  if (error) throw toServiceError(error);
  return (data as { notes: string } | null)?.notes ?? '';
}

export async function saveInternalNotes(eventId: string, notes: string): Promise<void> {
  const { error } = await client()
    .from('event_internal_notes')
    .upsert({ event_id: eventId, notes: clean(notes, 5000) }, { onConflict: 'event_id' });
  if (error) throw toServiceError(error);
}

export async function getHistory(eventId: string): Promise<EventHistoryEntry[]> {
  const { data, error } = await client()
    .from('event_history')
    .select('id,action,previous_values,new_values,changed_by,created_at')
    .eq('event_id', eventId)
    .order('created_at', { ascending: false })
    .limit(100);
  if (error) throw toServiceError(error);
  return ((data ?? []) as Array<{ id: string; action: string; previous_values: Record<string, unknown>; new_values: Record<string, unknown>; changed_by: string | null; created_at: string }>).map((h) => ({
    id: h.id,
    action: h.action,
    previousValues: h.previous_values ?? {},
    newValues: h.new_values ?? {},
    changedBy: h.changed_by,
    createdAt: h.created_at,
  }));
}

// ── Mutations ───────────────────────────────────────────────────────

export async function createEvent(input: EventInput, status: EventStatus, notes: string): Promise<AdminEvent> {
  // created_by is set by the database trigger from the session; sending it only satisfies RLS.
  const { data: auth } = await client().auth.getSession();
  const uid = auth.session?.user.id;
  if (!uid) throw new ServiceError('permission_denied', 'Your session has expired. Sign in again.');
  const { data, error } = await client()
    .from('events')
    .insert({ ...toRow(input), status, created_by: uid })
    .select(ADMIN_EVENT_COLUMNS)
    .single();
  if (error) throw toServiceError(error);
  const event = mapRow(data as unknown as EventRow);
  if (notes.trim()) await saveInternalNotes(event.id, notes);
  return event;
}

/**
 * Updates fields and optionally the status. `expectedStatus` makes the write
 * conditional, so two people can't publish/reject the same event at once.
 */
export async function updateEvent(
  id: string,
  input: EventInput | null,
  opts: { expectedStatus: EventStatus; status?: EventStatus; rejectionReason?: string },
): Promise<AdminEvent> {
  const patch: Record<string, unknown> = input ? toRow(input) : {};
  if (opts.status) patch.status = opts.status;
  if (opts.status === 'rejected') patch.rejection_reason = clean(opts.rejectionReason ?? '', 1000);
  const { data, error } = await client()
    .from('events')
    .update(patch)
    .eq('id', id)
    .eq('status', opts.expectedStatus)
    .select(ADMIN_EVENT_COLUMNS)
    .maybeSingle();
  if (error) throw toServiceError(error);
  if (!data) {
    throw new ServiceError(
      'conflict',
      'This event was changed by someone else or you no longer have permission to edit it. Reload and try again.',
    );
  }
  return mapRow(data as unknown as EventRow);
}

export async function softDeleteEvent(id: string): Promise<void> {
  const { data, error } = await client()
    .from('events')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id)
    .is('deleted_at', null)
    .select('id')
    .maybeSingle();
  if (error) throw toServiceError(error);
  if (!data) throw new ServiceError('conflict', 'The event was already deleted or you lack permission.');
}

export async function restoreEvent(id: string): Promise<void> {
  const { error } = await client().from('events').update({ deleted_at: null }).eq('id', id);
  if (error) throw toServiceError(error);
}

export async function duplicateEvent(event: AdminEvent): Promise<AdminEvent> {
  return createEvent(
    {
      ...eventToInput(event),
      title: event.title ? `${event.title} (copy)`.slice(0, 200) : '',
    },
    'draft',
    '',
  );
}

export function eventToInput(e: AdminEvent): EventInput {
  return {
    title: e.title,
    description: e.description,
    originalReportText: e.originalReportText,
    categoryId: e.categoryId,
    severity: e.severity,
    latitude: e.latitude,
    longitude: e.longitude,
    locationName: e.locationName,
    country: e.country,
    region: e.region,
    city: e.city,
    address: e.address ?? '',
    locationPrecision: e.locationPrecision,
    sourceName: e.sourceName ?? '',
    sourceUrl: e.sourceUrl ?? '',
    sourceType: e.sourceType,
    occurredAt: e.occurredAt,
    isBreaking: e.isBreaking,
    isVerified: e.isVerified,
    geocodingConfidence: e.geocodingConfidence,
    coordinatesManuallyCorrected: e.coordinatesManuallyCorrected,
  };
}

// ── Dashboard ───────────────────────────────────────────────────────

export interface DashboardStats {
  published: number;
  draft: number;
  pending: number;
  critical: number;
  createdToday: number;
  activeStaff: number | null;
}

async function countEvents(apply: (q: any) => any): Promise<number> {
  const { count, error } = await apply(client().from('events').select('id', { count: 'exact', head: true }).is('deleted_at', null));
  if (error) throw toServiceError(error);
  return count ?? 0;
}

export async function getDashboardStats(canSeeStaff: boolean): Promise<DashboardStats> {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const [published, draft, pending, critical, createdToday, activeStaff] = await Promise.all([
    countEvents((q) => q.eq('status', 'published')),
    countEvents((q) => q.eq('status', 'draft')),
    countEvents((q) => q.eq('status', 'pending_review')),
    countEvents((q) => q.eq('severity', 'critical').in('status', ['published', 'pending_review'])),
    countEvents((q) => q.gte('created_at', startOfDay.toISOString())),
    canSeeStaff
      ? client()
          .from('profiles')
          .select('id', { count: 'exact', head: true })
          .eq('status', 'active')
          .then(({ count, error }: { count: number | null; error: unknown }) => {
            if (error) throw toServiceError(error);
            return count ?? 0;
          })
      : Promise.resolve(null),
  ]);
  return { published, draft, pending, critical, createdToday, activeStaff };
}

export async function recentEvents(order: 'created_at' | 'updated_at' | 'published_at', limit = 6): Promise<AdminEvent[]> {
  let q = client().from('events').select(ADMIN_EVENT_COLUMNS).is('deleted_at', null).order(order, { ascending: false }).limit(limit);
  if (order === 'published_at') q = q.eq('status', 'published');
  const { data, error } = await q;
  if (error) throw toServiceError(error);
  return ((data ?? []) as unknown as EventRow[]).map(mapRow);
}

export interface AuditEntry {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  actorName: string | null;
}

export async function recentAudit(limit = 8): Promise<AuditEntry[]> {
  const { data, error } = await client()
    .from('audit_logs')
    .select('id,action,entity_type,entity_id,metadata,created_at,actor:profiles!audit_logs_user_id_fkey(full_name,email)')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw toServiceError(error);
  return ((data ?? []) as Array<{ id: string; action: string; entity_type: string; entity_id: string | null; metadata: Record<string, unknown>; created_at: string; actor: { full_name: string; email: string } | null }>).map((a) => ({
    id: a.id,
    action: a.action,
    entityType: a.entity_type,
    entityId: a.entity_id,
    metadata: a.metadata ?? {},
    createdAt: a.created_at,
    actorName: a.actor ? a.actor.full_name || a.actor.email : null,
  }));
}

/** Move an event's pin (staff; the database learns the place from it). */
export async function moveEventPin(id: string, latitude: number, longitude: number, locationName?: string): Promise<void> {
  const { error } = await client().rpc('move_event_pin', {
    p_id: id,
    p_lat: latitude,
    p_lng: longitude,
    p_location_name: locationName ?? null,
  });
  if (error) throw toServiceError(error);
}

/** Change an event's category (staff; the classifier learns from it). */
export async function setEventCategory(id: string, slug: string): Promise<void> {
  const { error } = await client().rpc('set_event_category', { p_id: id, p_slug: slug });
  if (error) throw toServiceError(error);
}

/** Move one of an event's extra places (index in events.locations); the place is learned. */
export async function moveEventPlace(id: string, index: number, latitude: number, longitude: number): Promise<void> {
  const { error } = await client().rpc('move_event_place', { p_id: id, p_index: index, p_lat: latitude, p_lng: longitude });
  if (error) throw toServiceError(error);
}

/** Editors/admins: take a pin off the map. index = an extra place; null = the main pin
 *  (the next place becomes the main pin; with none, the event stays in the feed only). */
export async function removeEventPin(id: string, index: number | null): Promise<void> {
  const { error } = await client().rpc('remove_event_pin', { p_id: id, p_index: index });
  if (error) throw toServiceError(error);
}

/** Admin: approve an editor's change on a live event (clears the review flag). */
export async function approveEventReview(id: string): Promise<void> {
  const { error } = await client().rpc('approve_event_review', { p_id: id });
  if (error) throw toServiceError(error);
}

/** Map "duplicate": keep the pin and add another one (same place name) at the new position. */
export async function addEventPlace(id: string, latitude: number, longitude: number, fromIndex: number | null): Promise<void> {
  const { error } = await client().rpc('add_event_place', { p_id: id, p_lat: latitude, p_lng: longitude, p_from: fromIndex });
  if (error) throw toServiceError(error);
}

/** Map icon: give one place of a report another category (it moves to that kind's event). Returns the event that now holds it. */
export async function setPlaceCategory(id: string, index: number | null, slug: string): Promise<string> {
  const { data, error } = await client().rpc('set_place_category', { p_id: id, p_index: index, p_slug: slug });
  if (error) throw toServiceError(error);
  return String(data ?? id);
}

/** Map icon: put one place (null = the main pin) on a searched place; the place is learned. */
export async function setPlaceLocation(id: string, index: number | null, latitude: number, longitude: number, name: string): Promise<void> {
  const { error } = await client().rpc('set_place_location', { p_id: id, p_index: index, p_lat: latitude, p_lng: longitude, p_name: name });
  if (error) throw toServiceError(error);
}
