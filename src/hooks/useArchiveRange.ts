import { useEffect, useRef, useState } from 'react';
import { fetchArchivedEvents } from '@/services/eventService';
import type { PublicEvent } from '@/types/event';

const NONE: PublicEvent[] = [];

/**
 * Archived (expired) events in a time range — loaded when a time filter reaches
 * back past the live 24 hours. `range` null = nothing to load.
 */
export function useArchiveRange(range: { from: string; to: string } | null): { events: PublicEvent[]; loading: boolean } {
  const [events, setEvents] = useState<PublicEvent[]>(NONE);
  const [loading, setLoading] = useState(false);
  const requestId = useRef(0);
  const from = range?.from ?? '';
  const to = range?.to ?? '';

  useEffect(() => {
    const id = ++requestId.current;
    if (!from) {
      setEvents(NONE);
      setLoading(false);
      return;
    }
    setLoading(true);
    fetchArchivedEvents(from, to, 2000)
      .then((rows) => {
        if (id === requestId.current) setEvents(rows);
      })
      .catch(() => {
        if (id === requestId.current) setEvents(NONE);
      })
      .finally(() => {
        if (id === requestId.current) setLoading(false);
      });
  }, [from, to]);

  return { events, loading };
}
