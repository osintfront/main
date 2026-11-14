import { useCallback, useSyncExternalStore } from 'react';
import { getReading, overlayOn, setOverlayOn, subscribeReadings } from '@/lib/readingStore';
import type { MediaTranslation } from '@/lib/mediaReading';

/** The event's saved media reading (when loaded) and its overlay switch. Never fetches. */
export function useEventReading(eventId: string): { reading: MediaTranslation | null; overlay: boolean; setOverlay(on: boolean): void } {
  const reading = useSyncExternalStore(subscribeReadings, () => getReading(eventId) ?? null, () => null);
  const overlay = useSyncExternalStore(subscribeReadings, () => overlayOn(eventId), () => false);
  const setOverlay = useCallback((on: boolean) => setOverlayOn(eventId, on), [eventId]);
  return { reading, overlay, setOverlay };
}
