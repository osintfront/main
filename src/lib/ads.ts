import { useEffect, useSyncExternalStore } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { effectivePlan } from '@/lib/plans';
import type { Profile } from '@/types/user';

/**
 * Ads (Stage C): Google AdSense, only for guests and Free accounts.
 * Switches in app_settings: ads_enabled (off until AdSense approves the site), ads_feed_every.
 * Paid plans and staff never see ads: they get an "ad-free" flag in this browser that index.html
 * reads before Google's script runs (pauseAdRequests), which also stops Google's anchor ad.
 */
export const AD_CLIENT = 'ca-pub-2232590000274943';
export const FEED_AD = { slot: '3071595781', layoutKey: '-fb+5w+4e-db+86' } as const;
const AD_FREE_KEY = 'ofm.adfree';

interface AdsConfig { enabled: boolean; every: number }
let config: AdsConfig = { enabled: false, every: 3 };
let loaded = false;
const listeners = new Set<() => void>();

async function load() {
  if (loaded || !supabase) return;
  loaded = true;
  const { data } = await supabase.from('app_settings').select('key,value').in('key', ['ads_enabled', 'ads_feed_every']);
  const v = Object.fromEntries((data ?? []).map((r: { key: string; value: unknown }) => [r.key, r.value]));
  const every = Number(v.ads_feed_every);
  config = { enabled: v.ads_enabled === true, every: Number.isFinite(every) && every >= 2 ? Math.round(every) : 3 };
  listeners.forEach((l) => l());
}

/** Does this viewer get ads? Guests and Free viewers yes; paid plans and staff no. */
export function viewerGetsAds(profile: Pick<Profile, 'plan' | 'planExpiresAt' | 'role'> | null): boolean {
  if (!profile) return true;
  if (profile.role !== 'viewer') return false;
  return effectivePlan(profile) === 'free';
}

/** Remember in this browser whether Google may request ads (read by index.html on the next load). */
export function setAdFree(adFree: boolean) {
  try {
    if (adFree) localStorage.setItem(AD_FREE_KEY, '1');
    else localStorage.removeItem(AD_FREE_KEY);
  } catch {
    /* storage blocked: ads behave as for a guest */
  }
  if (adFree) {
    const w = window as unknown as { adsbygoogle?: unknown[] & { pauseAdRequests?: number } };
    (w.adsbygoogle ??= [] as unknown[] & { pauseAdRequests?: number }).pauseAdRequests = 1;
  }
}

/** Ad switches + whether the current viewer gets ads. */
export function useAds(profile: Pick<Profile, 'plan' | 'planExpiresAt' | 'role'> | null, authReady: boolean) {
  useEffect(() => void load(), []);
  const cfg = useSyncExternalStore((l) => (listeners.add(l), () => listeners.delete(l)), () => config, () => config);
  const forViewer = viewerGetsAds(profile);
  useEffect(() => {
    if (authReady) setAdFree(!forViewer);
  }, [authReady, forViewer]);
  return { show: cfg.enabled && forViewer && authReady, every: cfg.every };
}
