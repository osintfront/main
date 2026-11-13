import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { featureLimit, planConfigReady, usePlanVersion } from '@/lib/plans';
import { CONTROL_ROOM_KEY, controlRoomAllowed, controlRoomOn, setControlRoom } from '@/lib/controlRoom';

/**
 * Control-room screen for this browser. on = the choice saved here; allowed = the plan permits it
 * (no idle sign-out: Max, Intel, staff); active = both, so the session should stay open.
 */
export function useControlRoom() {
  const { status, profile } = useAuth();
  usePlanVersion();
  const [on, setOn] = useState(() => controlRoomOn());

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === CONTROL_ROOM_KEY) setOn(controlRoomOn());
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const signedIn = status === 'signed_in' && !!profile;
  // Until the plan rows are read, featureLimit answers "no limit" for everyone: wait for them.
  const allowed = signedIn && planConfigReady() && controlRoomAllowed(true, featureLimit('idle_logout_min', profile));

  const set = useCallback((next: boolean) => {
    setControlRoom(next);
    setOn(next);
  }, []);

  return { on, allowed, active: on && allowed, set };
}
