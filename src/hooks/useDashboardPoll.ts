import { useEffect, useMemo, useRef } from 'react';
import { applyStatus, POLL_MS, pollGivesUp, type StatusPayload } from '@/lib/askStats';
import { dashboardStatus, type AskAnswer } from '@/services/askService';

/** The build id a turn waits for: a period rebuild first, else its own running build. */
const waitingFor = (t: AskAnswer) => t.dashboard?.rebuild?.id ?? (t.dashboard?.status === 'running' ? t.dashboard.id : null);

/** Polls every running dashboard build (and period rebuild) of the conversation every 1.5 s. Three failed
 *  requests in a row or 15 minutes → shown as failed (the server decides when a build is dead). A turn removed meanwhile (New chat) is skipped. */
export function useDashboardPoll(turns: AskAnswer[], setTurns: (f: (t: AskAnswer[]) => AskAnswer[]) => void): void {
  const ids = useMemo(() => turns.map(waitingFor).filter((x): x is string => !!x), [turns]);
  const key = ids.join(',');
  const counts = useRef(new Map<string, number>());
  const inFlight = useRef(new Set<string>());
  const errorsInRow = useRef(new Map<string, number>());
  const setRef = useRef(setTurns);
  setRef.current = setTurns;

  useEffect(() => {
    if (!key) return;
    const list = key.split(',');
    const apply = (id: string, s: StatusPayload) =>
      setRef.current((cur) => cur.map((t) => (t.dashboard && (t.dashboard.id === id || t.dashboard.rebuild?.id === id) ? { ...t, dashboard: applyStatus(t.dashboard, id, s) } : t)));
    const tick = () => {
      for (const id of list) {
        if (inFlight.current.has(id)) continue;
        const n = (counts.current.get(id) ?? 0) + 1;
        counts.current.set(id, n);
        const failed: StatusPayload = { status: 'failed', stage: 'finding', progress: null, result: null, cached: false };
        if (pollGivesUp(errorsInRow.current.get(id) ?? 0, n)) {
          apply(id, failed);
          continue;
        }
        inFlight.current.add(id);
        dashboardStatus(id)
          .then((s) => { errorsInRow.current.set(id, 0); apply(id, s); })
          .catch(() => {
            const e = (errorsInRow.current.get(id) ?? 0) + 1;
            errorsInRow.current.set(id, e);
            if (pollGivesUp(e, n)) apply(id, failed);
          })
          .finally(() => inFlight.current.delete(id));
      }
    };
    const timer = window.setInterval(tick, POLL_MS);
    tick();
    return () => window.clearInterval(timer);
  }, [key]);
}
