/**
 * Returns a normalised http(s) URL, or null when the value is not safe to put
 * in an href. Blocks javascript:, data:, credentials in the URL and malformed
 * input. Used for every source link shown to the public.
 */
export function safeExternalUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (trimmed.length > 2048) return null;
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
  if (parsed.username || parsed.password) return null;
  if (!parsed.hostname.includes('.')) return null;
  return parsed.toString();
}

export function hostnameOf(value: string): string {
  try {
    return new URL(value).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
export function isValidEmail(value: string): boolean {
  return EMAIL.test(value.trim()) && value.length <= 254;
}

/** Only allow in-app relative redirect targets after sign-in (prevents open redirects). */
export function safeRedirectPath(value: unknown, fallback = '/admin'): string {
  if (typeof value !== 'string') return fallback;
  if (!value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return fallback;
  return value;
}
