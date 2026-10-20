import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { isSupabaseConfigured } from '@/integrations/supabase/client';
import { fetchActiveHfcAlerts, subscribeHfcPulse } from '@/services/hfcAlertService';
import type { HfcAlert } from '@/types/hfcAlert';

/** Fallback poll; new alerts normally arrive through Realtime within a second or two. */
const POLL_MS = 15_000;

interface UseHfcAlerts {
  /** Alerts still on their timer, newest first. Stable identity between ticks. */
  alerts: HfcAlert[];
  /** Ticks every second while alerts are active (for countdowns). */
  now: number;
}

export function useHfcAlerts(): UseHfcAlerts {
  const [all, setAll] = useState<HfcAlert[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const inFlight = useRef(false);
  const again = useRef(false);

  const load = useCallback(async () => {
    if (!isSupabaseConfigured) return;
    if (inFlight.current) {
      again.current = true; // a pulse arrived mid-request: fetch once more afterwards
      return;
    }
    inFlight.current = true;
    try {
      setAll(await fetchActiveHfcAlerts());
      setNow(Date.now());
    } catch {
      // Keep what is on screen; the next pulse or poll retries.
    } finally {
      inFlight.current = false;
      if (again.current) {
        again.current = false;
        void load();
      }
    }
  }, []);

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    void load();
    const unsubscribe = subscribeHfcPulse(() => void load());
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void load();
    }, POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void load();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      unsubscribe();
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [load]);

  // Second-by-second clock only while something is on the map.
  useEffect(() => {
    if (all.length === 0) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [all.length]);

  // Drop alerts whose timer ran out, but keep the same array object while the
  // set is unchanged so the map doesn't redraw polygons every second.
  const activeKey = all
    .filter((a) => Date.parse(a.expiresAt) > now)
    .map((a) => `${a.id}:${a.lastAlertAt}:${a.areas.length}`)
    .join('|');
  const alerts = useMemo(
    () => all.filter((a) => activeKey.includes(`${a.id}:${a.lastAlertAt}:`)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activeKey],
  );

  return { alerts, now };
}
