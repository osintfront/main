import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, CalendarPlus, CheckCircle2, ClipboardList, FilePen, FilePlus2, Map as MapIcon, RefreshCw, ShieldCheck, Tags, Users } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { usePermissions } from '@/hooks/usePermissions';
import { useI18n, type TranslationKey } from '@/i18n';
import { getDashboardStats, recentAudit, recentEvents, type AuditEntry, type DashboardStats } from '@/services/eventAdminService';
import { friendlyError } from '@/services/serviceError';
import type { AdminEvent } from '@/types/event';
import { formatRelative } from '@/utils/time';
import { cn } from '@/utils/cn';
import { RoleBadge, SeverityBadge, StatusBadge } from '@/components/common/Badges';
import { Alert } from '@/components/common/Feedback';
import { IconButton } from '@/components/common/IconButton';

function StatCard({ label, value, icon, tone, to }: { label: string; value: number | null; icon: ReactNode; tone: string; to?: string }) {
  const body = (
    <>
      <span className={cn('flex size-10 shrink-0 items-center justify-center rounded-xl', tone)}>{icon}</span>
      <span className="min-w-0">
        <span className="block text-2xl font-bold tabular-nums text-slate-900 dark:text-white">{value ?? '—'}</span>
        <span className="block truncate text-xs font-medium text-slate-500 dark:text-slate-400">{label}</span>
      </span>
    </>
  );
  const cls = 'flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900';
  return to ? (
    <Link to={to} className={cn(cls, 'transition-colors hover:border-sky-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500 dark:hover:border-sky-500/50')}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

function Panel({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3 dark:border-slate-800">
        <h2 className="text-sm font-bold text-slate-900 dark:text-white">{title}</h2>
        {action}
      </div>
      <div className="p-2">{children}</div>
    </section>
  );
}

function EventList({ events, timeOf, empty }: { events: AdminEvent[]; timeOf: (e: AdminEvent) => string | null; empty: string }) {
  const { t, locale } = useI18n();
  if (events.length === 0) return <p className="px-2 py-6 text-center text-sm text-slate-500 dark:text-slate-400">{empty}</p>;
  return (
    <ul>
      {events.map((e) => (
        <li key={e.id}>
          <Link to={`/admin/events/${e.id}`} className="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-slate-50 dark:hover:bg-slate-800/60">
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium text-slate-900 dark:text-white" dir="auto">
                {e.title || t('list.untitled')}
              </span>
              <span className="mt-0.5 flex items-center gap-1.5">
                <StatusBadge status={e.status} />
                <SeverityBadge severity={e.severity} />
              </span>
            </span>
            <span className="shrink-0 text-xs text-slate-500 dark:text-slate-400">{formatRelative(timeOf(e) ?? e.updatedAt, locale, t('time.justNow'))}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

const AUDIT_KEYS: Record<string, TranslationKey> = {
  'event.created': 'history.created',
  'event.edited': 'history.edited',
  'event.submitted_for_review': 'history.submitted',
  'event.published': 'history.published',
  'event.approved_and_published': 'history.approved',
  'event.rejected': 'history.rejected',
  'event.archived': 'history.archived',
  'event.returned_to_draft': 'history.toDraft',
  'event.deleted': 'history.deleted',
  'event.restored': 'history.restored',
  'event.coordinates_corrected': 'history.coordinates',
  'user.login': 'audit.login',
  'user.invited': 'audit.invited',
  'user.invitation_accepted': 'audit.joined',
  'user.role_changed': 'audit.roleChanged',
  'user.suspended': 'audit.suspended',
  'user.reactivated': 'audit.reactivated',
};

export function DashboardPage() {
  const { t, locale } = useI18n();
  const { profile } = useAuth();
  const { can } = usePermissions();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [created, setCreated] = useState<AdminEvent[]>([]);
  const [updated, setUpdated] = useState<AdminEvent[]>([]);
  const [published, setPublished] = useState<AdminEvent[]>([]);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [s, c, u, p, a] = await Promise.all([
        getDashboardStats(can('user.manage')),
        recentEvents('created_at'),
        recentEvents('updated_at'),
        recentEvents('published_at'),
        can('audit.view') ? recentAudit() : Promise.resolve([]),
      ]);
      setStats(s);
      setCreated(c);
      setUpdated(u);
      setPublished(p);
      setAudit(a);
      setError(null);
    } catch (err) {
      setError(friendlyError(err, t));
    } finally {
      setLoading(false);
    }
  }, [can, t]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!profile) return null;

  const quick: Array<{ to: string; label: string; icon: ReactNode; show: boolean }> = [
    { to: '/admin/events/new', label: t('admin.nav.newEvent'), icon: <FilePlus2 className="size-4" aria-hidden />, show: can('event.create') },
    { to: '/admin/events?status=pending_review', label: t('dash.reviewPending'), icon: <ClipboardList className="size-4" aria-hidden />, show: can('event.review') },
    { to: '/admin/users', label: t('dash.manageUsers'), icon: <Users className="size-4" aria-hidden />, show: can('user.manage') || can('user.invite') },
    { to: '/admin/categories', label: t('dash.manageCategories'), icon: <Tags className="size-4" aria-hidden />, show: can('category.manage') },
    { to: '/', label: t('admin.nav.publicMap'), icon: <MapIcon className="size-4" aria-hidden />, show: true },
  ];

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
            {t('admin.home.greeting', { name: profile.fullName || profile.email })}
          </h1>
          <p className="mt-1 flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400">
            <RoleBadge role={profile.role} />
          </p>
        </div>
        <IconButton label={t('feed.retry')} onClick={() => void load()} tooltipSide="bottom-end">
          <RefreshCw className={cn('size-4', loading && 'animate-spin')} aria-hidden />
        </IconButton>
      </div>

      {error ? <Alert tone="error">{error}</Alert> : null}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <StatCard label={t('dash.published')} value={stats?.published ?? null} to="/admin/events?status=published" tone="bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300" icon={<CheckCircle2 className="size-5" aria-hidden />} />
        <StatCard label={t('dash.drafts')} value={stats?.draft ?? null} to="/admin/events?status=draft" tone="bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300" icon={<FilePen className="size-5" aria-hidden />} />
        <StatCard label={t('dash.pending')} value={stats?.pending ?? null} to="/admin/events?status=pending_review" tone="bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300" icon={<ClipboardList className="size-5" aria-hidden />} />
        <StatCard label={t('dash.critical')} value={stats?.critical ?? null} tone="bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-300" icon={<AlertTriangle className="size-5" aria-hidden />} />
        <StatCard label={t('dash.activeStaff')} value={stats?.activeStaff ?? null} to={can('user.manage') ? '/admin/users' : undefined} tone="bg-violet-50 text-violet-700 dark:bg-violet-500/10 dark:text-violet-300" icon={<ShieldCheck className="size-5" aria-hidden />} />
        <StatCard label={t('dash.today')} value={stats?.createdToday ?? null} tone="bg-sky-50 text-sky-700 dark:bg-sky-500/10 dark:text-sky-300" icon={<CalendarPlus className="size-5" aria-hidden />} />
      </div>

      <div className="flex flex-wrap gap-2">
        {quick
          .filter((q) => q.show)
          .map((q) => (
            <Link
              key={q.to}
              to={q.to}
              className="inline-flex h-9 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 hover:border-sky-300 hover:text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:border-sky-500/50 dark:hover:text-white"
            >
              {q.icon}
              {q.label}
            </Link>
          ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-4">
        <Panel title={t('dash.recentCreated')}>
          <EventList events={created} timeOf={(e) => e.createdAt} empty={t('dash.none')} />
        </Panel>
        <Panel title={t('dash.recentUpdated')}>
          <EventList events={updated} timeOf={(e) => e.updatedAt} empty={t('dash.none')} />
        </Panel>
        <Panel title={t('dash.recentPublished')}>
          <EventList events={published} timeOf={(e) => e.publishedAt} empty={t('dash.none')} />
        </Panel>
        {can('audit.view') ? (
          <Panel title={t('dash.recentActions')}>
            {audit.length === 0 ? (
              <p className="px-2 py-6 text-center text-sm text-slate-500 dark:text-slate-400">{t('dash.none')}</p>
            ) : (
              <ul>
                {audit.map((a) => (
                  <li key={a.id} className="flex items-start gap-2 rounded-lg px-2 py-2">
                    <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-sky-500" aria-hidden />
                    <span className="min-w-0 flex-1 text-sm">
                      <span className="text-slate-900 dark:text-white">{AUDIT_KEYS[a.action] ? t(AUDIT_KEYS[a.action]) : a.action}</span>
                      {typeof a.metadata.title === 'string' && a.metadata.title ? (
                        <span className="block truncate text-xs text-slate-500 dark:text-slate-400" dir="auto">
                          {a.metadata.title}
                        </span>
                      ) : null}
                      <span className="block text-[11px] text-slate-400">
                        {a.actorName ?? t('dash.system')} · {formatRelative(a.createdAt, locale, t('time.justNow'))}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        ) : null}
      </div>
    </div>
  );
}
