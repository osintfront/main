/**
 * Control-room screen (מסך חמ"ל): a per-browser choice to stay signed in on a wall screen.
 * When it is on (and the plan allows it), the 24-hour session renews by itself instead of asking,
 * and the idle sign-out does not run. Kept in localStorage: it belongs to this screen, not the account.
 * Allowed on plans with no idle sign-out (Max, Intel) and for staff; others see the upgrade window.
 */
const KEY = 'ofm.controlRoom';

export function controlRoomOn(storage: Pick<Storage, 'getItem'> | null = safeStorage()): boolean {
  try {
    return storage?.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

export function setControlRoom(on: boolean, storage: Pick<Storage, 'setItem' | 'removeItem'> | null = safeStorage()): void {
  try {
    if (on) storage?.setItem(KEY, '1');
    else storage?.removeItem(KEY);
  } catch {
    /* storage blocked: the choice is simply not kept */
  }
}

/** The plan's idle sign-out limit (minutes, null = none) decides: only plans without one may use it. */
export function controlRoomAllowed(signedIn: boolean, idleLimitMin: number | null): boolean {
  return signedIn && idleLimitMin === null;
}

export type SessionAction = 'none' | 'warn' | 'extend' | 'expire';

/**
 * What the 24-hour session clock should do now. left = ms until it ends (null = not running).
 * In control-room mode the warning and the end are replaced by a silent renewal.
 */
export function sessionAction(left: number | null, warnMs: number, controlRoom: boolean): SessionAction {
  if (left === null || left > warnMs) return 'none';
  if (controlRoom) return 'extend';
  return left <= 0 ? 'expire' : 'warn';
}

export const CONTROL_ROOM_KEY = KEY;

function safeStorage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}
