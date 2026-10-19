import type { Permission } from '@/lib/permissions';
import type { AdminEvent, EventInput, EventStatus } from '@/types/event';
import { safeExternalUrl } from '@/utils/url';
import { isValidDate } from '@/utils/time';

/**
 * Mirror of public.is_valid_event_transition(). The database enforces it;
 * the UI uses this copy to only offer actions that will succeed.
 */
const TRANSITIONS: Record<EventStatus, readonly EventStatus[]> = {
  draft: ['pending_review', 'published', 'archived'],
  pending_review: ['draft', 'published', 'rejected', 'archived'],
  rejected: ['draft', 'pending_review', 'archived'],
  published: ['archived'],
  archived: ['draft', 'published'],
};

export function canTransition(from: EventStatus, to: EventStatus): boolean {
  return from === to || TRANSITIONS[from].includes(to);
}

/** Permission required to move an event INTO a status (mirrors events_before_update). */
const TARGET_PERMISSION: Partial<Record<EventStatus, Permission>> = {
  published: 'event.publish',
  rejected: 'event.review',
  archived: 'event.archive',
};

export type WorkflowAction = 'submit' | 'publish' | 'reject' | 'archive' | 'toDraft';

export const ACTION_TARGET: Record<WorkflowAction, EventStatus> = {
  submit: 'pending_review',
  publish: 'published',
  reject: 'rejected',
  archive: 'archived',
  toDraft: 'draft',
};

interface Subject {
  can: (p: Permission) => boolean;
  userId: string | null;
}

/** May this user edit the event's fields at all? (Mirrors the events UPDATE policy.) */
export function canEditEvent(event: Pick<AdminEvent, 'createdBy' | 'status' | 'deletedAt'>, who: Subject): boolean {
  if (who.can('event.edit.any')) return true;
  return (
    !event.deletedAt &&
    event.createdBy === who.userId &&
    who.can('event.edit.own') &&
    (event.status === 'draft' || event.status === 'rejected')
  );
}

/** Status actions offered for an existing event. */
export function availableActions(event: Pick<AdminEvent, 'createdBy' | 'status' | 'deletedAt'>, who: Subject): WorkflowAction[] {
  if (event.deletedAt || !canEditEvent(event, who)) return [];
  const actions: WorkflowAction[] = [];
  (Object.keys(ACTION_TARGET) as WorkflowAction[]).forEach((action) => {
    const target = ACTION_TARGET[action];
    if (target === event.status || !canTransition(event.status, target)) return;
    const needed = TARGET_PERMISSION[target];
    if (needed && !who.can(needed)) return;
    // Editors (edit.own only) may only move between draft and pending review.
    if (!who.can('event.edit.any') && !(target === 'pending_review' || target === 'draft' || (target === 'published' && who.can('event.publish')))) return;
    actions.push(action);
  });
  return actions;
}

export type FieldErrors = Partial<Record<keyof EventInput | 'form', string>>;

/** Validation keys are i18n keys (see en.ts "validation.*"). */
export function validateEvent(input: EventInput, target: EventStatus): FieldErrors {
  const errors: FieldErrors = {};
  if (!input.originalReportText.trim() && !input.description.trim()) errors.originalReportText = 'validation.reportRequired';
  if (!isValidDate(input.occurredAt)) errors.occurredAt = 'validation.timeInvalid';
  else if (new Date(input.occurredAt).getTime() > Date.now() + 5 * 60_000) errors.occurredAt = 'validation.timeFuture';
  if (input.latitude !== null && (input.latitude < -90 || input.latitude > 90)) errors.latitude = 'validation.latRange';
  if (input.longitude !== null && (input.longitude < -180 || input.longitude > 180)) errors.longitude = 'validation.lngRange';
  if ((input.latitude === null) !== (input.longitude === null)) errors.latitude = 'validation.coordsPair';
  if (input.sourceUrl.trim() && !safeExternalUrl(input.sourceUrl)) errors.sourceUrl = 'validation.urlInvalid';
  if (input.title.length > 200) errors.title = 'validation.titleLong';

  if (target === 'pending_review' || target === 'published') {
    if (!input.title.trim()) errors.title = 'validation.titleRequired';
  }
  if (target === 'published') {
    if (!input.categoryId) errors.categoryId = 'validation.categoryRequired';
    // Without coordinates the server places the pin from the place names,
    // so publishing needs either coordinates or at least one place name.
    const hasPlace = [input.locationName, input.city, input.region, input.country].some((v) => v.trim());
    if ((input.latitude === null || input.longitude === null) && !hasPlace) {
      errors.latitude = errors.latitude ?? 'validation.coordsRequired';
      errors.locationName = 'validation.locationRequired';
    }
  }
  return errors;
}
