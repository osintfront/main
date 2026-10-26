import type { AuthError } from '@supabase/supabase-js';
import { authConfig } from '@/config/auth';
import { supabase } from '@/integrations/supabase/client';

export type SignInFailure =
  | { code: 'invalid_credentials' }
  | { code: 'email_not_confirmed' }
  | { code: 'rate_limited'; retryAfterSeconds: number }
  | { code: 'network' }
  | { code: 'not_configured' }
  | { code: 'other'; message: string };

// ── Client-side login throttle ─────────────────────────────────────
const THROTTLE_KEY = 'ofm.loginThrottle';

interface ThrottleState {
  failures: number[];
  lockedUntil: number;
}

function readThrottle(): ThrottleState {
  try {
    const raw = sessionStorage.getItem(THROTTLE_KEY);
    if (raw) return JSON.parse(raw) as ThrottleState;
  } catch {
    /* ignore */
  }
  return { failures: [], lockedUntil: 0 };
}

function writeThrottle(state: ThrottleState) {
  try {
    sessionStorage.setItem(THROTTLE_KEY, JSON.stringify(state));
  } catch {
    /* ignore */
  }
}

/** Seconds until another attempt is allowed, or 0. */
export function loginLockRemaining(now = Date.now()): number {
  const { lockedUntil } = readThrottle();
  return lockedUntil > now ? Math.ceil((lockedUntil - now) / 1000) : 0;
}

function registerFailure(now = Date.now()): number {
  const { freeAttempts, windowMs, baseLockMs, maxLockMs } = authConfig.loginThrottle;
  const state = readThrottle();
  state.failures = [...state.failures.filter((t) => now - t < windowMs), now];
  const over = state.failures.length - freeAttempts;
  if (over >= 0) {
    state.lockedUntil = now + Math.min(baseLockMs * 2 ** over, maxLockMs);
  }
  writeThrottle(state);
  return loginLockRemaining(now);
}

function clearThrottle() {
  writeThrottle({ failures: [], lockedUntil: 0 });
}

function classify(error: AuthError | Error): SignInFailure {
  const code = (error as AuthError).code;
  const status = (error as AuthError).status;
  if (code === 'invalid_credentials' || (status === 400 && /invalid login credentials/i.test(error.message))) {
    return { code: 'invalid_credentials' };
  }
  if (code === 'email_not_confirmed') return { code: 'email_not_confirmed' };
  if (code === 'over_request_rate_limit' || status === 429) return { code: 'rate_limited', retryAfterSeconds: 60 };
  if (error.name === 'AuthRetryableFetchError' || status === 0 || /failed to fetch|network/i.test(error.message)) {
    return { code: 'network' };
  }
  return { code: 'other', message: error.message };
}

export async function signInWithPassword(email: string, password: string): Promise<SignInFailure | null> {
  if (!supabase) return { code: 'not_configured' };
  const locked = loginLockRemaining();
  if (locked > 0) return { code: 'rate_limited', retryAfterSeconds: locked };

  const { error } = await supabase.auth.signInWithPassword({ email: email.trim().toLowerCase(), password });
  if (!error) {
    clearThrottle();
    return null;
  }
  const failure = classify(error);
  if (failure.code === 'invalid_credentials') {
    const wait = registerFailure();
    if (wait > 0) return { code: 'rate_limited', retryAfterSeconds: wait };
  }
  return failure;
}

export async function signOut(): Promise<void> {
  if (!supabase) return;
  // 'local' clears this browser's session even if the network call fails.
  await supabase.auth.signOut({ scope: 'local' });
}

/** Always resolves the same way for unknown emails, so the form can't be used to probe accounts. */
export async function sendPasswordResetEmail(email: string): Promise<{ error: string | null }> {
  if (!supabase) return { error: 'Supabase is not configured.' };
  const { error } = await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), {
    redirectTo: `${authConfig.siteUrl}/reset-password`,
  });
  if (error && (error.status === 429 || error.code === 'over_email_send_rate_limit')) {
    return { error: 'rate_limited' };
  }
  if (error && (error.name === 'AuthRetryableFetchError' || error.status === 0)) return { error: 'network' };
  return { error: null };
}

/** 12+ characters with an uppercase letter, a lowercase letter, a digit and a special character. */
export function strongPassword(p: string): boolean {
  return p.length >= 12 && /[A-Z]/.test(p) && /[a-z]/.test(p) && /\d/.test(p) && /[^A-Za-z0-9]/.test(p);
}

/** Is this the signed-in user's current password? (signs in again with it) */
export async function checkCurrentPassword(password: string): Promise<boolean> {
  if (!supabase) return false;
  const { data } = await supabase.auth.getUser();
  const email = data.user?.email;
  if (!email || !password) return false;
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  return !error;
}

export async function updatePassword(password: string): Promise<{ error: string | null }> {
  if (!supabase) return { error: 'Supabase is not configured.' };
  const { error } = await supabase.auth.updateUser({ password });
  return { error: error ? error.message : null };
}
