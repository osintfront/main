import { useEffect } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { featureLimit, usePlanVersion } from '@/lib/plans';
import { useControlRoom } from '@/hooks/useControlRoom';

/**
 * Plan idle sign-out (plan_features 'idle_logout_min'): after that many minutes with no
 * activity in any tab, the visitor is signed out. Free: 30 min, Pro: 12 h, Max: never.
 * The last activity time is shared by every open tab (localStorage).
 * A control-room screen never signs out for being idle.
 */
const KEY = 'ofm.lastActive';
const EVENTS = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const;

function mark() {
  try {
    localStorage.setItem(KEY, String(Date.now()));
  } catch {
    /* storage blocked */
  }
}
function lastActive(): number {
  try {
    const v = Number(localStorage.getItem(KEY));
    return Number.isFinite(v) && v > 0 ? v : Date.now();
  } catch {
    return Date.now();
  }
}

export function IdleSignOut() {
  const { status, profile, signOut } = useAuth();
  usePlanVersion();
  const controlRoom = useControlRoom().active;
  const limit = status === 'signed_in' && profile && !controlRoom ? featureLimit('idle_logout_min', profile) : null;

  useEffect(() => {
    if (!limit) return;
    mark();
    let last = 0;
    const onActive = () => {
      const now = Date.now();
      if (now - last > 15_000) { last = now; mark(); } // at most every 15 s
    };
    for (const e of EVENTS) window.addEventListener(e, onActive, { passive: true });
    const timer = window.setInterval(() => {
      if (Date.now() - lastActive() > limit * 60_000) void signOut();
    }, 30_000);
    return () => {
      for (const e of EVENTS) window.removeEventListener(e, onActive);
      window.clearInterval(timer);
    };
  }, [limit, signOut]);

  return null;
}
