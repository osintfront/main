const UNITS: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ['year', 365 * 24 * 3600],
  ['month', 30 * 24 * 3600],
  ['week', 7 * 24 * 3600],
  ['day', 24 * 3600],
  ['hour', 3600],
  ['minute', 60],
];

export function isValidDate(value: string | null | undefined): value is string {
  return !!value && !Number.isNaN(new Date(value).getTime());
}

/** "12 min ago" style label. Returns `justNow` for anything under a minute. */
export function formatRelative(iso: string, locale: string, justNow: string, now = Date.now()): string {
  if (!isValidDate(iso)) return '';
  const diffSeconds = Math.round((new Date(iso).getTime() - now) / 1000);
  const abs = Math.abs(diffSeconds);
  if (abs < 60) return justNow;
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto', style: 'short' });
  for (const [unit, seconds] of UNITS) {
    if (abs >= seconds) return rtf.format(Math.round(diffSeconds / seconds), unit);
  }
  return justNow;
}

/** Clock time for today, date + time otherwise. Always 24h for operational clarity. */
export function formatEventTime(iso: string, locale: string, now = new Date()): string {
  if (!isValidDate(iso)) return '';
  const d = new Date(iso);
  const sameDay = d.toDateString() === now.toDateString();
  return new Intl.DateTimeFormat(locale, {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    ...(sameDay ? {} : { day: 'numeric', month: 'short' }),
  }).format(d);
}

export function formatDateTime(iso: string | null | undefined, locale: string): string {
  if (!isValidDate(iso)) return '';
  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
    hourCycle: 'h23',
  }).format(new Date(iso));
}
