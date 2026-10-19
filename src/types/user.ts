export const APP_ROLES = ['super_admin', 'admin', 'editor', 'viewer'] as const;
export type AppRole = (typeof APP_ROLES)[number];

export const USER_STATUSES = ['active', 'pending', 'suspended'] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

export interface Profile {
  id: string;
  fullName: string;
  email: string;
  role: AppRole;
  status: UserStatus;
  /** Explicit publishing grant for editors. Admin roles publish through their role. */
  canPublish: boolean;
  createdAt: string;
  lastLoginAt: string | null;
}
