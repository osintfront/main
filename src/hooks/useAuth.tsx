import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { clearSessionClock, startSessionClock } from '@/lib/sessionClock';
import type { Session, User } from '@supabase/supabase-js';
import { authConfig } from '@/config/auth';
import { supabase } from '@/integrations/supabase/client';
import * as authService from '@/services/authService';
import { recordLogin } from '@/services/auditService';
import { toServiceError } from '@/services/serviceError';
import { fetchOwnProfile, updateOwnFullName } from '@/services/userService';
import type { Profile } from '@/types/user';

export type AuthStatus = 'unconfigured' | 'loading' | 'signed_out' | 'signed_in';

interface MfaState {
  /** The user's role requires MFA (see src/config/auth.ts). */
  required: boolean;
  /** The current session is AAL2. */
  satisfied: boolean;
}

interface AuthContextValue {
  status: AuthStatus;
  session: Session | null;
  user: User | null;
  /** Staff profile; null when signed in without an invitation-created profile. */
  profile: Profile | null;
  profileError: string | null;
  /** True when the session ended without the user signing out (expiry / revoked refresh token). */
  sessionExpired: boolean;
  /** True after arriving from a password-recovery email link. */
  passwordRecovery: boolean;
  mfa: MfaState;
  signIn: (email: string, password: string) => Promise<authService.SignInFailure | null>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  updateFullName: (fullName: string) => Promise<string | null>;
  acknowledgeSessionExpired: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [initializing, setInitializing] = useState<boolean>(!!supabase);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [profileUserId, setProfileUserId] = useState<string | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [sessionExpired, setSessionExpired] = useState(false);
  const [passwordRecovery, setPasswordRecovery] = useState(false);
  const [aal2, setAal2] = useState(false);

  const explicitSignOut = useRef(false);
  const hadSession = useRef(false);

  // Session bootstrap + subscription.
  useEffect(() => {
    if (!supabase) return;
    let active = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      hadSession.current = !!data.session;
      setSession(data.session);
      setInitializing(false);
    });

    // Note: never await Supabase calls inside this callback (it can deadlock the
    // client); profile loading reacts to the session state below instead.
    const { data: sub } = supabase.auth.onAuthStateChange((event, next) => {
      if (event === 'SIGNED_OUT') {
        if (hadSession.current && !explicitSignOut.current) setSessionExpired(true);
        explicitSignOut.current = false;
        setPasswordRecovery(false);
      }
      if (event === 'SIGNED_IN') setSessionExpired(false);
      if (event === 'PASSWORD_RECOVERY') setPasswordRecovery(true);
      hadSession.current = !!next;
      setSession(next);
      setInitializing(false);
    });

    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const userId = session?.user.id ?? null;

  const loadProfile = useCallback(async (uid: string) => {
    try {
      const next = await fetchOwnProfile(uid);
      setProfile(next);
      setProfileError(null);
    } catch (err) {
      setProfile(null);
      setProfileError(toServiceError(err).message);
    } finally {
      setProfileUserId(uid);
    }
  }, []);

  // Load the staff profile whenever the signed-in user changes.
  useEffect(() => {
    if (!userId) {
      setProfile(null);
      setProfileUserId(null);
      setProfileError(null);
      return;
    }
    void loadProfile(userId);
  }, [userId, loadProfile]);

  // MFA assurance level (only consulted when the role requires MFA).
  const mfaRequired = !!profile && authConfig.requireMfaForRoles.includes(profile.role);
  useEffect(() => {
    if (!supabase || !mfaRequired) return;
    supabase.auth.mfa.getAuthenticatorAssuranceLevel().then(({ data }) => setAal2(data?.currentLevel === 'aal2'));
  }, [mfaRequired, session?.access_token]);

  const signIn = useCallback(async (email: string, password: string) => {
    const failure = await authService.signInWithPassword(email, password);
    if (!failure) {
      setSessionExpired(false);
      startSessionClock();
      void recordLogin();
    }
    return failure;
  }, []);

  const signOut = useCallback(async () => {
    explicitSignOut.current = true;
    setSessionExpired(false);
    clearSessionClock();
    await authService.signOut();
  }, []);

  const refreshProfile = useCallback(async () => {
    if (userId) await loadProfile(userId);
  }, [userId, loadProfile]);

  const updateFullName = useCallback(
    async (fullName: string) => {
      if (!userId) return 'Not signed in.';
      try {
        setProfile(await updateOwnFullName(userId, fullName));
        return null;
      } catch (err) {
        return toServiceError(err).message;
      }
    },
    [userId],
  );

  const acknowledgeSessionExpired = useCallback(() => setSessionExpired(false), []);

  const status: AuthStatus = !supabase
    ? 'unconfigured'
    : initializing
      ? 'loading'
      : !session
        ? 'signed_out'
        : profileUserId !== userId
          ? 'loading'
          : 'signed_in';

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      session,
      user: session?.user ?? null,
      profile,
      profileError,
      sessionExpired,
      passwordRecovery,
      mfa: { required: mfaRequired, satisfied: !mfaRequired || aal2 },
      signIn,
      signOut,
      refreshProfile,
      updateFullName,
      acknowledgeSessionExpired,
    }),
    [
      status,
      session,
      profile,
      profileError,
      sessionExpired,
      passwordRecovery,
      mfaRequired,
      aal2,
      signIn,
      signOut,
      refreshProfile,
      updateFullName,
      acknowledgeSessionExpired,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
