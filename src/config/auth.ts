import type { AppRole } from '@/types/user';

/**
 * Authentication settings.
 *
 * MFA is prepared, not enforced: list roles here to require an AAL2 session
 * (Supabase TOTP) before the admin area opens. Pair it with an RLS check on
 * `(auth.jwt() ->> 'aal') = 'aal2'` for those roles when you switch it on.
 */
export const authConfig = {
  requireMfaForRoles: [] as AppRole[],
  minPasswordLength: 10,
  /** Client-side brake on repeated failures. Supabase Auth rate limits apply server-side too. */
  loginThrottle: {
    freeAttempts: 5,
    windowMs: 10 * 60_000,
    baseLockMs: 30_000,
    maxLockMs: 15 * 60_000,
  },
  siteUrl: ((import.meta.env.VITE_SITE_URL as string | undefined) || window.location.origin).replace(/\/$/, ''),
};
