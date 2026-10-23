/**
 * Session length (members-only site): a sign-in lasts 24 hours. Two minutes before the end
 * the visitor is asked whether to keep going (another 24 hours) — SessionTimeout.
 * The start time is kept per browser (localStorage) so every open tab agrees.
 */
export const SESSION_MS = 24 * 3600_000;
export const WARN_MS = 2 * 60_000;
const KEY = 'ofm.session.started';

export function sessionStarted(): number | null {
  try {
    const v = Number(window.localStorage.getItem(KEY));
    return Number.isFinite(v) && v > 0 ? v : null;
  } catch {
    return null;
  }
}

export function startSessionClock(at = Date.now()): void {
  try {
    window.localStorage.setItem(KEY, String(at));
  } catch {
    /* storage blocked: the session simply is not time-boxed in this browser */
  }
}

export function clearSessionClock(): void {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

export const SESSION_CLOCK_KEY = KEY;
