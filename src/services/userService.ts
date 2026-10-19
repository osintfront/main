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
