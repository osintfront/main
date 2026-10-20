import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { isSupabaseConfigured } from '@/integrations/supabase/client';
import { fetchActiveHfcAlerts, fetchActiveHfcShapes, subscribeHfcPulse } from '@/services/hfcAlertService';
import type { HfcAlert, HfcShape } from '@/types/hfcAlert';

/** Fallback poll; new alerts normally arrive through Realtime within a second or two. */
const POLL_MS = 15_000;

interface UseHfcAlerts {
  /** Alerts still on their timer, newest first. Stable identity between ticks. */
  alerts: HfcAlert[];
  /** Ticks every second while alerts are active (for countdowns). */
  now: number;
  /** Touching polygons merged for display; null = not available (draw each alert's own polygon). */
  shapes: HfcShape[] | null;
}

export function useHfcAlerts(enabled = true): UseHfcAlerts {
  const [all, setAll] = useState<HfcAlert[]>([]);
  const [shapes, setShapes] = useState<HfcShape[] | null>(null);
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
      const [nextAlerts, nextShapes] = await Promise.all([
        fetchActiveHfcAlerts(),
        // Shapes are cosmetic: if they fail, each alert draws its own polygon.
        fetchActiveHfcShapes().catch(() => null),
      ]);
      setAll(nextAlerts);
      setShapes(nextShapes);
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
    if (!isSupabaseConfigured || !enabled) {
      setAll([]);
      setShapes(null);
      return;
    }
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
  }, [load, enabled]);

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

  // When an area's timer runs out, refetch so merged shapes shrink with it.
  const activeCount = alerts.length;
  const prevCount = useRef(activeCount);
  useEffect(() => {
    if (activeCount < prevCount.current) void load();
    prevCount.current = activeCount;
  }, [activeCount, load]);

  // Only shapes that still contain an active alert.
  const visibleShapes = useMemo(() => {
    if (!shapes) return null;
    const ids = new Set(alerts.map((a) => a.id));
    return shapes.filter((sh) => sh.alertIds.some((id) => ids.has(id)));
  }, [shapes, alerts]);

  return { alerts, now, shapes: visibleShapes };
}
