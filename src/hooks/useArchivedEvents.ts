import { useCallback, useEffect, useRef, useState } from 'react';
import { isSupabaseConfigured } from '@/integrations/supabase/client';
import { fetchArchivedEvents } from '@/services/eventService';
import { toServiceError } from '@/services/serviceError';
import type { PublicEvent } from '@/types/event';
import type { LoadStatus } from './useEvents';

/** YYYY-MM-DD of a date in the browser's time zone. */
export function toDayString(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function shiftDay(day: string, delta: number): string {
  const [y, m, d] = day.split('-').map(Number);
  return toDayString(new Date(y, m - 1, d + delta));
}

export function isValidDay(day: string | null): day is string {
  if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
  const [y, m, d] = day.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d;
}

interface UseArchivedEvents {
  events: PublicEvent[];
  status: LoadStatus;
  error: string | null;
  reload: () => void;
}

/** Archived (expired) events whose event time falls on `day` (local calendar day). */
export function useArchivedEvents(day: string, enabled = true): UseArchivedEvents {
  const [events, setEvents] = useState<PublicEvent[]>([]);
  const [status, setStatus] = useState<LoadStatus>(isSupabaseConfigured ? 'loading' : 'ready');
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(0);

  const load = useCallback(async () => {
    if (!isSupabaseConfigured) return;
    const id = ++requestId.current;
    setStatus('loading');
    const [y, m, d] = day.split('-').map(Number);
    const from = new Date(y, m - 1, d);
    const to = new Date(y, m - 1, d + 1);
    try {
      const next = await fetchArchivedEvents(from.toISOString(), to.toISOString());
      if (id !== requestId.current) return; // a newer day was picked meanwhile
      setEvents(next);
      setError(null);
      setStatus('ready');
    } catch (err) {
      if (id !== requestId.current) return;
      setError(toServiceError(err).message);
      setStatus('error');
    }
  }, [day]);

  useEffect(() => {
    if (enabled) void load();
  }, [load, enabled]);

  return { events, status, error, reload: () => void load() };
}
