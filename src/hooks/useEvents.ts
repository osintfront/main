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
/** Busy feeds push many changes a minute: refetch at most this often. */
const MIN_REFETCH_GAP_MS = 6_000;

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
  /** Last version of each event (and its fingerprint): unchanged events keep the same object,
   *  so the map and the feed only redraw what actually changed. */
  const previous = useRef<Map<string, { event: PublicEvent; sig: string }>>(new Map());
  const lastLoadAt = useRef(0);
  const pending = useRef<number | undefined>(undefined);
  const [newIds, setNewIds] = useState<ReadonlySet<string>>(() => new Set());

  const load = useCallback(
    async (background: boolean) => {
      if (isDemo) return;
      if (inFlight.current) {
        again.current = true; // a push arrived mid-request: fetch once more afterwards
        return;
      }
      inFlight.current = true;
      lastLoadAt.current = Date.now();
      if (!background) setStatus('loading');
      try {
        const fetched = await fetchPublishedEvents();
        const prevMap = previous.current;
        const nextMap = new Map<string, { event: PublicEvent; sig: string }>();
        let changed = fetched.length !== prevMap.size;
        const next = fetched.map((e) => {
          const sig = JSON.stringify(e);
          const old = prevMap.get(e.id);
          const keep = old && old.sig === sig ? old.event : e;
          if (keep !== old?.event) changed = true;
          nextMap.set(e.id, { event: keep, sig });
          return keep;
        });
        previous.current = nextMap;
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
        if (changed || !hasData.current) setEvents(next);
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
    // Pushes come in bursts (new event, then the editor's rewrite, then extra sources):
    // coalesce them into one refetch at most every MIN_REFETCH_GAP_MS.
    const onPulse = () => {
      window.clearTimeout(pending.current);
      const wait = Math.max(400, lastLoadAt.current + MIN_REFETCH_GAP_MS - Date.now());
      pending.current = window.setTimeout(() => void load(true), wait);
    };
    const unsubscribe = subscribeToPulse('events_pulse', onPulse);
    return () => {
      unsubscribe();
      window.clearTimeout(pending.current);
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [isDemo, load, enabled]);

  const reload = useCallback(() => void load(false), [load]);

  return { events, status, error, isDemo, lastUpdated, reload, newIds };
}
