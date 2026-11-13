/**
 * One shared store of saved media readings per event (the media-translation service fills it) and
 * whether the event's pictures show the translation. Module-level; `import type` only, so the node
 * unit tests load it as is.
 */
import type { MediaTranslation } from './mediaReading.ts';

const readings = new Map<string, MediaTranslation | null>();
const overlays = new Map<string, boolean>();
const subs = new Set<() => void>();
const emit = () => subs.forEach((cb) => cb());

/** undefined = not loaded yet; null = not allowed / not readable. */
export function getReading(eventId: string): MediaTranslation | null | undefined {
  return readings.get(eventId);
}
export function setReading(eventId: string, m: MediaTranslation | null): void {
  if (readings.has(eventId) && readings.get(eventId) === m) return;
  readings.set(eventId, m);
  emit();
}
export function dropReading(eventId: string): void {
  if (!readings.delete(eventId)) return;
  emit();
}
export function overlayOn(eventId: string): boolean {
  return overlays.get(eventId) ?? false;
}
export function setOverlayOn(eventId: string, on: boolean): void {
  if (overlayOn(eventId) === on) return;
  overlays.set(eventId, on);
  emit();
}
export function subscribeReadings(cb: () => void): () => void {
  subs.add(cb);
  return () => {
    subs.delete(cb);
  };
}
