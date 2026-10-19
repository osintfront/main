import { useCallback, useEffect, useRef, useState } from 'react';
import { isSupabaseConfigured } from '@/integrations/supabase/client';
import { fetchPublishedEvents } from '@/services/eventService';
import { toServiceError } from '@/services/serviceError';
import { buildDemoEvents } from '@/data/demoEvents';
import type { PublicEvent } from '@/types/event';

export type LoadStatus = 'loading' | 'ready' | 'error';

/** Safe periodic refresh. Realtime push arrives in Phase 6 and keeps this as its fallback. */
const REFRESH_INTERVAL_MS = 60_000;

interface UsePublicEvents {
  events: PublicEvent[];
  status: LoadStatus;
  error: string | null;
  isDemo: boolean;
  lastUpdated: Date | null;
  reload: () => void;
}

export function usePublicEvents(): UsePublicEvents {
  const isDemo = !isSupabaseConfigured;
  const [events, setEvents] = useState<PublicEvent[]>(() => (isDemo ? buildDemoEvents() : []));
  const [status, setStatus] = useState<LoadStatus>(isDemo ? 'ready' : 'loading');
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(isDemo ? new Date() : null);
  const inFlight = useRef(false);
  const hasData = useRef(false);

  const load = useCallback(
    async (background: boolean) => {
      if (isDemo || inFlight.current) return;
      inFlight.current = true;
      if (!background) setStatus('loading');
      try {
        const next = await fetchPublishedEvents();
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
      }
    },
    [isDemo],
  );

  useEffect(() => {
    void load(false);
    if (isDemo) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void load(true);
    }, REFRESH_INTERVAL_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void load(true);
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [isDemo, load]);

  const reload = useCallback(() => void load(false), [load]);

  return { events, status, error, isDemo, lastUpdated, reload };
}
