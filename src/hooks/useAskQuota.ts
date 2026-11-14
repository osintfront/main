import { useCallback, useEffect, useState } from 'react';
import { creditsLeft } from '@/lib/askStats';
import { fetchAskQuota } from '@/services/askService';

/** "Ask the map": whole AI credits left today (null = nothing limits this user, or not known). */
export function useAskQuota(active: boolean): { left: number | null; refresh: () => void } {
  const [left, setLeft] = useState<number | null>(null);
  const refresh = useCallback(() => {
    if (!active) return;
    void fetchAskQuota().then((q) => setLeft(creditsLeft(q)));
  }, [active]);
  useEffect(() => {
    if (active) refresh();
    else setLeft(null);
  }, [active, refresh]);
  return { left, refresh };
}
