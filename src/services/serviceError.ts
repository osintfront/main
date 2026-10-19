import type { TranslationKey } from '@/i18n/en';

export type ServiceErrorCode =
  | 'not_configured'
  | 'network'
  | 'permission_denied'
  | 'not_found'
  | 'conflict'
  | 'validation'
  | 'unknown';

/** A specific, user-presentable error. Avoids "Something went wrong" messages. */
export class ServiceError extends Error {
  constructor(
    public readonly code: ServiceErrorCode,
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'ServiceError';
  }
}

interface PostgrestLikeError {
  message?: string;
  code?: string;
  details?: string | null;
  hint?: string | null;
}

export function toServiceError(error: unknown): ServiceError {
  if (error instanceof ServiceError) return error;
  if (error instanceof TypeError && /fetch|network/i.test(error.message)) {
    return new ServiceError('network', 'The server could not be reached. Check your connection and try again.', error);
  }
  const e = (error ?? {}) as PostgrestLikeError;
  const message = e.message || 'Unexpected server response.';
  switch (e.code) {
    case '42501':
    case 'PGRST301':
      return new ServiceError('permission_denied', message, error);
    case 'PGRST116':
      return new ServiceError('not_found', message, error);
    case '23505':
      return new ServiceError('conflict', message, error);
    case '23514':
    case '22P02':
    case '22023':
      return new ServiceError('validation', message, error);
    default:
      return new ServiceError('unknown', message, error);
  }
}

type Translate = (key: TranslationKey, vars?: Record<string, string | number>) => string;

/** Turns any error into a specific, translated, user-facing message. */
export function friendlyError(err: unknown, t: Translate): string {
  const e = toServiceError(err);
  const msg = e.message || '';
  if (msg.includes('events_publish_requirements')) return t('validation.publishRequirements');
  if (msg.includes('events_rejection_reason_required')) return t('validation.reasonRequired');
  if (msg.includes('events_occurred_at_sane')) return t('validation.timeFuture');
  if (msg.includes('row-level security')) return t('validation.noPermission');
  switch (e.code) {
    case 'not_configured':
      return t('setup.title');
    case 'network':
      return t('auth.errorNetwork');
    default:
      return msg;
  }
}
