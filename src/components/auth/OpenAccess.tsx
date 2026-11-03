import type { ReactNode } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { AccountGates } from './AccountGates';
import { AccessDenied } from './AccessDenied';

/**
 * Guard for pages open to everyone (the live map). Guests and unverified accounts see the page;
 * a signed-in active account still passes the account gates first (temporary password, terms);
 * a suspended account is stopped.
 */
export function OpenAccess({ children }: { children: ReactNode }) {
  const { status, profile } = useAuth();
  if (status === 'signed_in' && profile?.status === 'suspended') return <AccessDenied reason="suspended" />;
  if (status === 'signed_in' && profile?.status === 'active') return <AccountGates>{children}</AccountGates>;
  return <>{children}</>;
}
