import { useCallback, useEffect, useRef, useState } from 'react';
import { isSupabaseConfigured } from '@/integrations/supabase/client';
import { fetchPublishedEvents } from '@/services/eventService';
import { subscribeToPulse } from '@/services/realtime';
import { toServiceError } from '@/services/serviceError';
import { buildDemoEvents } from '@/data/demoEvents';
import type { PublicEvent } from '@/types/event';

export type LoadStatus = 'loading' | 'ready' | 'error';

/** Changes arrive by Realtime push; this slower poll is only a safety net. */
const REFRESH_INTERVAL_MS = 60_000;
/** How long a newly arrived event stays highlighted. */
const NEW_HIGHLIGHT_MS = 90_000;

interface UsePublicEvents {
  events: PublicEvent[];
  status: LoadStatus;
  error: string | null;
  isDemo: boolean;
  lastUpdated: Date | null;
  reload: () => void;
  /** Events that arrived by push since the page loaded (highlighted for a while). */
  newIds: ReadonlySet<string>;
}

export function usePublicEvents(enabled = true): UsePublicEvents {
  const isDemo = !isSupabaseConfigured;
  const [events, setEvents] = useState<PublicEvent[]>(() => (isDemo ? buildDemoEvents() : []));
  const [status, setStatus] = useState<LoadStatus>(isDemo ? 'ready' : 'loading');
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(isDemo ? new Date() : null);
  const inFlight = useRef(false);
  const again = useRef(false);
  const hasData = useRef(false);
  const knownIds = useRef<Set<string> | null>(null);
  const [newIds, setNewIds] = useState<ReadonlySet<string>>(() => new Set());

  const load = useCallback(
    async (background: boolean) => {
      if (isDemo) return;
      if (inFlight.current) {
        again.current = true; // a push arrived mid-request: fetch once more afterwards
        return;
      }
      inFlight.current = true;
      if (!background) setStatus('loading');
      try {
        const next = await fetchPublishedEvents();
        // Highlight events that were not there before (not on the first load).
        if (knownIds.current) {
          const known = knownIds.current;
          const fresh = next.filter((e) => !known.has(e.id)).map((e) => e.id);
          if (fresh.length) {
            setNewIds((prev) => new Set([...prev, ...fresh]));
            window.setTimeout(() => {
              setNewIds((prev) => {
                const copy = new Set(prev);
                fresh.forEach((id) => copy.delete(id));
                return copy;
              });
            }, NEW_HIGHLIGHT_MS);
          }
        }
        knownIds.current = new Set(next.map((e) => e.id));
        setEvents(next);
        hasData.current = true;
        setStatus('ready');
        setError(null);
        setLastUpdated(new Date());
      } catch (err) {
        // A failed background refresh keeps the events already on screen.
        if (!background || !hasData.current) {
          setError(toServiceError(err).message);
          setStatus('error');
        }
      } finally {
        inFlight.current = false;
        if (again.current) {
          again.current = false;
          void load(true);
        }
      }
    },
    [isDemo],
  );

  useEffect(() => {
    if (!enabled) return;
    void load(false);
    if (isDemo) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void load(true);
    }, REFRESH_INTERVAL_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void load(true);
    };
    document.addEventListener('visibilitychange', onVisible);
    const unsubscribe = subscribeToPulse('events_pulse', () => void load(true));
    return () => {
      unsubscribe();
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [isDemo, load, enabled]);

  const reload = useCallback(() => void load(false), [load]);

  return { events, status, error, isDemo, lastUpdated, reload, newIds };
}
