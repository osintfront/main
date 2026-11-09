/** A pin of an event: its main pin (place null) or one of its further places (index in locations). */
export interface PinRef {
  id: string;
  place: number | null;
}

/**
 * Which pin the phone card's "Move" acts on. Phones have no pin popups, so the pin is the one
 * that was last tapped on the map when it belongs to this event; otherwise (the card was opened
 * from the feed, a link or another event) the event's main pin.
 */
export function pinTarget(eventId: string, tapped: PinRef | null): PinRef {
  return tapped && tapped.id === eventId ? { id: eventId, place: tapped.place } : { id: eventId, place: null };
}
