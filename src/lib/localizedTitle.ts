import type { PublicEvent } from '@/types/event';

/** The event's headline in the reader's language, falling back to the stored (original) title. */
export function localizedTitle(event: Pick<PublicEvent, 'title' | 'translations'>, lang: string): string {
  return event.translations[lang]?.title || event.title;
}

/** Map pin hover label: the localized headline, followed by the place name when a pin is one of several. */
export function markerLabel(event: Pick<PublicEvent, 'title' | 'translations'>, lang: string, placeName?: string | null): string {
  const title = localizedTitle(event, lang);
  return placeName ? `${title} — ${placeName}` : title;
}
