import { supabase } from '@/integrations/supabase/client';
import type { AppRole, Profile, UserStatus } from '@/types/user';
import { ServiceError, toServiceError } from './serviceError';

const PROFILE_COLUMNS = 'id,full_name,email,role,status,can_publish,created_at,last_login_at';

interface ProfileRow {
  id: string;
  full_name: string;
  email: string;
  role: AppRole;
  status: UserStatus;
  can_publish: boolean;
  created_at: string;
  last_login_at: string | null;
}

function mapProfile(row: ProfileRow): Profile {
  return {
    id: row.id,
    fullName: row.full_name,
    email: row.email,
    role: row.role,
    status: row.status,
    canPublish: row.can_publish,
    createdAt: row.created_at,
    lastLoginAt: row.last_login_at,
  };
}

function client() {
  if (!supabase) throw new ServiceError('not_configured', 'Supabase is not configured.');
  return supabase;
}

/** The signed-in user's staff profile, or null when they have none (not invited). */
export async function fetchOwnProfile(userId: string): Promise<Profile | null> {
  const { data, error } = await client().from('profiles').select(PROFILE_COLUMNS).eq('id', userId).maybeSingle();
  if (error) throw toServiceError(error);
  return data ? mapProfile(data as ProfileRow) : null;
}

/** Users may change only their own display name; the database guard enforces it. */
export async function updateOwnFullName(userId: string, fullName: string): Promise<Profile> {
  const { data, error } = await client()
    .from('profiles')
    .update({ full_name: fullName.trim() })
    .eq('id', userId)
    .select(PROFILE_COLUMNS)
    .single();
  if (error) throw toServiceError(error);
  return mapProfile(data as ProfileRow);
}

// ── User management (staff who may manage users) ──────────────────────

export async function listProfiles(): Promise<Profile[]> {
  const { data, error } = await client().from('profiles').select(PROFILE_COLUMNS).order('created_at', { ascending: false });
  if (error) throw toServiceError(error);
  return ((data ?? []) as ProfileRow[]).map(mapProfile);
}

/** Role / status / publishing grant — the database guard decides what the caller may change. */
export async function updateProfile(id: string, patch: { role?: AppRole; status?: UserStatus; canPublish?: boolean }): Promise<Profile> {
  const row: Record<string, unknown> = {};
  if (patch.role) row.role = patch.role;
  if (patch.status) row.status = patch.status;
  if (patch.canPublish !== undefined) row.can_publish = patch.canPublish;
  const { data, error } = await client().from('profiles').update(row).eq('id', id).select(PROFILE_COLUMNS).single();
  if (error) throw toServiceError(error);
  return mapProfile(data as ProfileRow);
}

async function userAdmin(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const { data, error } = await client().functions.invoke('user-admin', { body });
  if (error) {
    // The function answers errors as JSON { error }; surface its message.
    let msg = error.message;
    try {
      const ctx = (error as { context?: Response }).context;
      if (ctx) msg = (await ctx.json())?.error ?? msg;
    } catch {
      /* keep the generic message */
    }
    throw new ServiceError('unknown', msg);
  }
  return (data ?? {}) as Record<string, unknown>;
}

/** Create a user with a temporary password (returned once, to hand over). */
export async function createUser(email: string, fullName: string, role: AppRole): Promise<string> {
  const r = await userAdmin({ action: 'create', email, full_name: fullName, role });
  return String(r.password ?? '');
}

export async function resetUserPassword(id: string): Promise<string> {
  const r = await userAdmin({ action: 'reset_password', user_id: id });
  return String(r.password ?? '');
}

export async function removeUser(id: string): Promise<void> {
  await userAdmin({ action: 'remove', user_id: id });
}
