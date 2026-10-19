import { useCallback, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

/** feed = card click, map = marker click, popup = "View event" in a popup, url = restored from ?event= */
export type SelectionSource = 'feed' | 'map' | 'popup' | 'url';

export interface FocusRequest {
  id: string;
  source: SelectionSource;
  /** Changes on every request so re-clicking the same card re-centres the map. */
  nonce: number;
}

/**
 * Shared selection state between the feed and the map, mirrored into the
 * URL (?event=<id>) so a selected event can be shared or restored on reload.
 */
export function useMapSelection() {
  const [params, setParams] = useSearchParams();
  const selectedId = params.get('event');
  const [focusRequest, setFocusRequest] = useState<FocusRequest | null>(() =>
    selectedId ? { id: selectedId, source: 'url', nonce: Date.now() } : null,
  );

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
