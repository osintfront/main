export const APP_ROLES = ['super_admin', 'admin', 'analyst', 'viewer'] as const;
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
  /** Subscription plan (not enforced while app_settings.enforce_plans = false). */
  plan: PlanId;
  planSource: 'default' | 'eval' | 'paid';
  planExpiresAt: string | null;
  billingPeriod: 'monthly' | 'yearly' | null;
  mustChangePassword: boolean;
}

export type PlanId = 'free' | 'pro' | 'max' | 'intel';
