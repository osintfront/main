import type { CSSProperties } from 'react';
import { BadgeCheck, Zap } from 'lucide-react';
import { getCategoryIcon } from '@/data/categoryRegistry';
import { useI18n } from '@/i18n';
import type { CategoryRef } from '@/types/category';
import type { EventStatus, Severity } from '@/types/event';
import type { AppRole, UserStatus } from '@/types/user';
import { cn } from '@/utils/cn';
import { SEVERITY_STYLES } from '@/utils/severity';

const BASE = 'inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-semibold ring-1 ring-inset';

export function CategoryBadge({ category }: { category: CategoryRef }) {
  const { categoryLabel } = useI18n();
  const Icon = getCategoryIcon(category.icon);
  return (
    <span
      className={cn(BASE, 'ofm-category-chip')}
      style={{ '--chip-color': category.color } as CSSProperties}
    >
      <Icon className="size-3" aria-hidden />
      {categoryLabel(category.slug, category.name)}
    </span>
  );
}

export function SeverityBadge({ severity }: { severity: Severity }) {
  const { t } = useI18n();
  return (
    <span className={cn(BASE, SEVERITY_STYLES[severity].badge)}>
      <span className={cn('size-1.5 rounded-full', SEVERITY_STYLES[severity].dot)} aria-hidden />
      {t(`severity.${severity}`)}
    </span>
  );
}

export function BreakingBadge() {
  const { t } = useI18n();
  return (
    <span className={cn(BASE, 'bg-red-600 text-white ring-red-700 uppercase tracking-wide')}>
      <Zap className="size-3" aria-hidden />
      {t('feed.breaking')}
    </span>
  );
}

export function VerifiedBadge({ verified }: { verified: boolean }) {
  const { t } = useI18n();
  if (!verified) {
    return <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">{t('feed.unverified')}</span>;
  }
  return (
    <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-sky-700 dark:text-sky-300">
      <BadgeCheck className="size-3.5" aria-hidden />
      {t('feed.verified')}
    </span>
  );
}

const STATUS_STYLES: Record<EventStatus, string> = {
  draft: 'bg-slate-100 text-slate-700 ring-slate-500/20 dark:bg-slate-500/15 dark:text-slate-300 dark:ring-slate-400/25',
  pending_review: 'bg-amber-50 text-amber-800 ring-amber-600/20 dark:bg-amber-500/10 dark:text-amber-300 dark:ring-amber-400/25',
  published: 'bg-emerald-50 text-emerald-800 ring-emerald-600/20 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-400/25',
  rejected: 'bg-red-50 text-red-800 ring-red-600/20 dark:bg-red-500/10 dark:text-red-300 dark:ring-red-400/25',
  archived: 'bg-zinc-100 text-zinc-600 ring-zinc-500/20 dark:bg-zinc-500/10 dark:text-zinc-400 dark:ring-zinc-400/20',
};

export function StatusBadge({ status }: { status: EventStatus }) {
  const { t } = useI18n();
  return <span className={cn(BASE, STATUS_STYLES[status])}>{t(`status.${status}`)}</span>;
}

const ROLE_STYLES: Record<AppRole, string> = {
  super_admin: 'bg-violet-50 text-violet-800 ring-violet-600/20 dark:bg-violet-500/10 dark:text-violet-300 dark:ring-violet-400/25',
  admin: 'bg-sky-50 text-sky-800 ring-sky-600/20 dark:bg-sky-500/10 dark:text-sky-300 dark:ring-sky-400/25',
  editor: 'bg-teal-50 text-teal-800 ring-teal-600/20 dark:bg-teal-500/10 dark:text-teal-300 dark:ring-teal-400/25',
  viewer: 'bg-slate-100 text-slate-700 ring-slate-500/20 dark:bg-slate-500/15 dark:text-slate-300 dark:ring-slate-400/25',
};

export function RoleBadge({ role }: { role: AppRole }) {
  const { t } = useI18n();
  return <span className={cn(BASE, ROLE_STYLES[role])}>{t(`role.${role}`)}</span>;
}

const USER_STATUS_STYLES: Record<UserStatus, string> = {
  active: STATUS_STYLES.published,
  pending: STATUS_STYLES.pending_review,
  suspended: STATUS_STYLES.rejected,
};

export function UserStatusBadge({ status }: { status: UserStatus }) {
  const { t } = useI18n();
  return <span className={cn(BASE, USER_STATUS_STYLES[status])}>{t(`userStatus.${status}`)}</span>;
}
