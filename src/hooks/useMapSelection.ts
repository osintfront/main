import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

/** feed = card click, map = marker click, popup = "View event" in a popup, url = restored from ?event= */
export type SelectionSource = 'feed' | 'map' | 'popup' | 'url';

export interface FocusRequest {
  id: string;
  source: SelectionSource;
  /** Changes on every request so re-clicking the same card re-centres the map. */
  nonce: number;
}

/** Page was reloaded (F5), not opened from a link. */
function isReload(): boolean {
  try {
    const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
    return nav?.type === 'reload';
  } catch {
    return false;
  }
}
// Evaluated once per page load: a reload starts at the newest events, a shared link still opens its event.
const RELOADED = typeof window !== 'undefined' && isReload();
let reloadHandled = false;
/** The page was reloaded (F5): a selected event in the URL is not reopened. */
export const PAGE_RELOADED = RELOADED;

/**
 * Shared selection state between the feed and the map, mirrored into the
 * URL (?event=<id>) so a selected event can be shared or restored on reload.
 */
export function useMapSelection() {
  const [params, setParams] = useSearchParams();
  const dropOnReload = RELOADED && !reloadHandled;
  const selectedId = dropOnReload ? null : params.get('event');
  const [focusRequest, setFocusRequest] = useState<FocusRequest | null>(() =>
    selectedId ? { id: selectedId, source: 'url', nonce: Date.now() } : null,
  );

  // Refresh = back to the top of the feed: forget the event selected before the reload.
  useEffect(() => {
    if (!dropOnReload) return;
    reloadHandled = true;
    if (params.has('event')) {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.delete('event');
          return next;
        },
        { replace: true },
      );
    }
  }, [dropOnReload, params, setParams]);

  const select = useCallback(
    (id: string, source: SelectionSource) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.set('event', id);
          return next;
        },
        { replace: true },
      );
      setFocusRequest({ id, source, nonce: Date.now() + Math.random() });
    },
    [setParams],
  );

  const clear = useCallback(() => {
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete('event');
        return next;
      },
      { replace: true },
    );
    setFocusRequest(null);
  }, [setParams]);

  return { selectedId, focusRequest, select, clear };
}
