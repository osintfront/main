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
