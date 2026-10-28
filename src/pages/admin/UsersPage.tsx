import { PlanCell } from '@/components/admin/PlanCell';
import { WelcomePanel } from '@/components/admin/WelcomePanel';
import { latestSessions, type SessionRow } from '@/services/planService';
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Copy, KeyRound, Plus, Trash2, X } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { usePermissions } from '@/hooks/usePermissions';
import { useI18n } from '@/i18n';
import { assignableRoles } from '@/lib/permissions';
import { friendlyError } from '@/services/serviceError';
import { createUser, listProfiles, removeUser, resetUserPassword, updateProfile } from '@/services/userService';
import type { AppRole, Profile } from '@/types/user';
import { formatDateTime } from '@/utils/time';
import { Alert, Spinner } from '@/components/common/Feedback';
import { Button } from '@/components/common/Form';
import { IconButton } from '@/components/common/IconButton';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { useToast } from '@/components/common/Toast';

const INPUT =
  'h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/30 dark:border-slate-700 dark:bg-slate-950 dark:text-white';
const ROLE_ORDER: AppRole[] = ['super_admin', 'admin', 'analyst', 'viewer'];

/** Users: create (temporary password), change role, suspend, reset password, remove. */
export function UsersPage() {
  const { t, locale } = useI18n();
  const { profile: me } = useAuth();
  const { can } = usePermissions();
  const toast = useToast();
  const roles = useMemo(() => assignableRoles(me), [me]);
  const [users, setUsers] = useState<Profile[]>([]);
  // Column filters: name = free text (contains, name or email); the others = one of the values in the list today.
  const [fName, setFName] = useState('');
  const [fRole, setFRole] = useState('');
  const [fStatus, setFStatus] = useState('');
  const [fLogin, setFLogin] = useState('');
  const loginDay = useCallback((u: Profile) => (u.lastLoginAt ? u.lastLoginAt.slice(0, 10) : 'never'), []);
  const shown = useMemo(() => {
    const q = fName.trim().toLowerCase();
    return users.filter((u) =>
      (!q || `${u.fullName ?? ''} ${u.email ?? ''}`.toLowerCase().includes(q)) &&
      (!fRole || u.role === fRole) &&
      (!fStatus || u.status === fStatus) &&
      (!fLogin || loginDay(u) === fLogin));
  }, [users, fName, fRole, fStatus, fLogin, loginDay]);
  const uniq = (xs: string[]) => [...new Set(xs)].sort();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [form, setForm] = useState({ email: '', name: '', role: (roles.includes('viewer') ? 'viewer' : roles[0]) as AppRole });
  const [creating, setCreating] = useState(false);
  const [secret, setSecret] = useState<{ email: string; password: string } | null>(null);
  const [welcome, setWelcome] = useState<{ name: string; email: string; password: string; plan: string } | null>(null);
  const [sessions, setSessions] = useState<Map<string, SessionRow>>(new Map());
  const superAdmin = me?.role === 'super_admin';
  const [removing, setRemoving] = useState<Profile | null>(null);

  const load = useCallback(async () => {
    try {
      setUsers(await listProfiles());
      setError(null);
      void latestSessions().then(setSessions).catch(() => {});
    } catch (err) {
      setError(friendlyError(err, t));
    } finally {
      setLoading(false);
    }
  }, [t]);
  useEffect(() => {
    void load();
  }, [load]);

  /** May I manage this account at all? (mirrors the database guard) */
  const manageable = (u: Profile) =>
    u.id !== me?.id && can('user.manage') && (!['super_admin', 'admin'].includes(u.role) || can('user.manage.admins'));

  const create = async (e: FormEvent) => {
    e.preventDefault();
    setCreating(true);
    try {
      const password = await createUser(form.email.trim(), form.name.trim(), form.role);
      // Keep the typed email and name; show the welcome panel (the password lives only there).
      setSecret(null);
      setWelcome({ name: form.name.trim(), email: form.email.trim(), password, plan: 'Free' });
      await load();
    } catch (err) {
      toast.error(friendlyError(err, t));
    } finally {
      setCreating(false);
    }
  };

  const patch = async (u: Profile, p: Parameters<typeof updateProfile>[1]) => {
    setBusy(u.id);
    try {
      const next = await updateProfile(u.id, p);
      setUsers((list) => list.map((x) => (x.id === u.id ? next : x)));
      toast.success(t('users.saved'));
    } catch (err) {
      toast.error(friendlyError(err, t));
    } finally {
      setBusy(null);
    }
  };

  const reset = async (u: Profile) => {
    setBusy(u.id);
    try {
      setSecret({ email: u.email, password: await resetUserPassword(u.id) });
    } catch (err) {
      toast.error(friendlyError(err, t));
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    if (!removing) return;
    setBusy(removing.id);
    try {
      await removeUser(removing.id);
      setUsers((list) => list.filter((x) => x.id !== removing.id));
      toast.success(t('users.removed'));
    } catch (err) {
      toast.error(friendlyError(err, t));
    } finally {
      setBusy(null);
      setRemoving(null);
    }
  };

  if (loading) return <Spinner label={t('common.loading')} />;

  return (
    <div className="mx-auto max-w-6xl">
      <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">{t('admin.nav.users')}</h1>
      <p className="mt-1 max-w-3xl text-sm text-slate-600 dark:text-slate-400">{t('users.intro')}</p>
      {error ? <Alert tone="error" className="mt-4">{error}</Alert> : null}

      {roles.length && can('user.invite') ? (
        <form onSubmit={create} className="mt-5 grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 sm:grid-cols-[1fr_1fr_12rem_auto] dark:border-slate-800 dark:bg-slate-900">
          <label className="text-sm font-medium text-slate-700 dark:text-slate-200">
            {t('users.email')}
            <input type="email" required dir="ltr" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className={`mt-1 ${INPUT}`} />
          </label>
          <label className="text-sm font-medium text-slate-700 dark:text-slate-200">
            {t('users.name')}
            <input value={form.name} maxLength={120} onChange={(e) => setForm({ ...form, name: e.target.value })} className={`mt-1 ${INPUT}`} dir="auto" />
          </label>
          <label className="text-sm font-medium text-slate-700 dark:text-slate-200">
            {t('users.role')}
            <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as AppRole })} className={`mt-1 ${INPUT}`}>
              {ROLE_ORDER.filter((r) => roles.includes(r)).map((r) => (
                <option key={r} value={r}>
                  {t(`role.${r}`)}
                </option>
              ))}
            </select>
          </label>
          <div className="flex items-end">
            <Button type="submit" loading={creating} className="h-10 w-full">
              <Plus className="size-4" aria-hidden />
              {t('users.create')}
            </Button>
          </div>
          <p className="text-xs text-slate-500 sm:col-span-4 dark:text-slate-400">{t('users.roleHelp')}</p>
        </form>
      ) : null}

      {welcome ? <WelcomePanel user={welcome} onClose={() => setWelcome(null)} /> : null}
      {secret ? (
        <div className="mt-4 flex flex-wrap items-center gap-3 rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm dark:border-amber-500/40 dark:bg-amber-500/10">
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-amber-900 dark:text-amber-200">{t('users.passwordTitle', { email: secret.email })}</p>
            <p className="mt-0.5 text-amber-800 dark:text-amber-300">{t('users.passwordHint')}</p>
          </div>
          <code dir="ltr" className="rounded-lg bg-white px-3 py-2 font-mono text-base font-bold text-slate-900 ring-1 ring-amber-300 dark:bg-slate-900 dark:text-white">
            {secret.password}
          </code>
          <IconButton
            label={t('users.copy')}
            onClick={() => {
              void navigator.clipboard?.writeText(secret.password);
              toast.success(t('users.copied'));
            }}
          >
            <Copy className="size-4" aria-hidden />
          </IconButton>
          <IconButton label={t('common.close')} onClick={() => setSecret(null)}>
            <X className="size-4" aria-hidden />
          </IconButton>
        </div>
      ) : null}

      <div className="mt-5 overflow-x-auto rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <table className="w-full text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-400">
            <tr>
              <th className="px-4 py-2.5 text-start">{t('users.name')}</th>
              <th className="px-3 py-2.5 text-start">{t('users.role')}</th>
              <th className="px-3 py-2.5 text-start">{t('users.status')}</th>
              <th className="px-3 py-2.5 text-start">{t('users.lastLogin')}</th>
              <th className="px-3 py-2.5 text-start normal-case">חבילה</th>
              <th className="px-3 py-2.5 text-start normal-case">מכשיר אחרון</th>
              <th className="px-3 py-2.5" />
            </tr>
            <tr className="normal-case tracking-normal">
              <th className="px-4 pb-2.5 text-start font-normal">
                <input value={fName} onChange={(e) => setFName(e.target.value)} placeholder={t('users.filterName')} aria-label={t('users.filterName')} className="h-8 w-full rounded-lg border border-slate-200 bg-white px-2 text-xs dark:border-slate-700 dark:bg-slate-900 dark:text-white" dir="auto" />
              </th>
              <th className="px-3 pb-2.5 text-start font-normal">
                <select value={fRole} onChange={(e) => setFRole(e.target.value)} aria-label={t('users.role')} className="h-8 rounded-lg border border-slate-200 bg-white px-2 text-xs dark:border-slate-700 dark:bg-slate-900 dark:text-white">
                  <option value="">{t('users.filterAll')}</option>
                  {(uniq(users.map((u) => u.role)) as AppRole[]).map((r) => <option key={r} value={r}>{t(`role.${r}`)}</option>)}
                </select>
              </th>
              <th className="px-3 pb-2.5 text-start font-normal">
                <select value={fStatus} onChange={(e) => setFStatus(e.target.value)} aria-label={t('users.status')} className="h-8 rounded-lg border border-slate-200 bg-white px-2 text-xs dark:border-slate-700 dark:bg-slate-900 dark:text-white">
                  <option value="">{t('users.filterAll')}</option>
                  {(uniq(users.map((u) => u.status)) as Profile['status'][]).map((v) => <option key={v} value={v}>{t(`users.status.${v}`)}</option>)}
                </select>
              </th>
              <th className="px-3 pb-2.5 text-start font-normal">
                <select value={fLogin} onChange={(e) => setFLogin(e.target.value)} aria-label={t('users.lastLogin')} className="h-8 rounded-lg border border-slate-200 bg-white px-2 text-xs dark:border-slate-700 dark:bg-slate-900 dark:text-white">
                  <option value="">{t('users.filterAll')}</option>
                  {uniq(users.map(loginDay)).reverse().map((v) => <option key={v} value={v}>{v === 'never' ? t('common.never') : v.split('-').reverse().join('/')}</option>)}
                </select>
              </th>
              <th />
              <th />
              <th className="px-3 pb-2.5" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {shown.map((u) => {
              const can_ = manageable(u);
              const isBusy = busy === u.id;
              return (
                <tr key={u.id}>
                  <td className="px-4 py-3">
                    <div className="font-semibold text-slate-900 dark:text-white" dir="auto">
                      {u.fullName || '—'}
                      {u.id === me?.id ? <span className="ms-1.5 text-xs font-normal text-slate-400">({t('users.you')})</span> : null}
                    </div>
                    <div className="text-xs text-slate-500" dir="ltr">
                      {u.email}
                    </div>
                  </td>
                  <td className="px-3 py-3">
                    {can_ ? (
                      <select
                        value={u.role}
                        disabled={isBusy}
                        onChange={(e) => void patch(u, { role: e.target.value as AppRole })}
                        className="h-8 rounded-lg border border-slate-200 bg-white px-2 text-xs font-medium dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                      >
                        {ROLE_ORDER.filter((r) => roles.includes(r) || r === u.role).map((r) => (
                          <option key={r} value={r}>
                            {t(`role.${r}`)}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span className="text-xs font-medium">{t(`role.${u.role}`)}</span>
                    )}
                  </td>
                  <td className="px-3 py-3">
                    {can_ && u.status !== 'pending' ? (
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => void patch(u, { status: u.status === 'active' ? 'suspended' : 'active' })}
                        className={
                          'rounded-full px-2.5 py-1 text-xs font-semibold ' +
                          (u.status === 'active'
                            ? 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-500/10 dark:text-emerald-300'
                            : 'bg-red-50 text-red-700 hover:bg-red-100 dark:bg-red-500/10 dark:text-red-300')
                        }
                        title={u.status === 'active' ? t('users.suspend') : t('users.reactivate')}
                      >
                        {t(`users.status.${u.status}`)}
                      </button>
                    ) : (
                      <span className="text-xs text-slate-500">{t(`users.status.${u.status}`)}</span>
                    )}
                  </td>
                  <td className="px-3 py-3 text-xs text-slate-500">{u.lastLoginAt ? formatDateTime(u.lastLoginAt, locale) : '—'}</td>
                  <td className="px-3 py-3 text-xs"><PlanCell u={u} canEdit={superAdmin && u.id !== me?.id} onChanged={load} /></td>
                  <td className="px-3 py-3 text-xs text-slate-500">{(() => { const ss = sessions.get(u.id); return ss ? `${ss.device_type ?? ''} · ${ss.browser ?? ''}${ss.ended_at ? ' (נותק)' : ''} · ${formatDateTime(ss.last_seen, locale)}` : '—'; })()}</td>
                  <td className="px-3 py-3">
                    {can_ ? (
                      <div className="flex justify-end gap-0.5">
                        <IconButton label={t('users.resetPassword')} onClick={() => void reset(u)} disabled={isBusy} tooltipSide="bottom-end">
                          <KeyRound className="size-4" aria-hidden />
                        </IconButton>
                        <IconButton label={t('users.remove')} onClick={() => setRemoving(u)} disabled={isBusy} tooltipSide="bottom-end">
                          <Trash2 className="size-4 text-red-600 dark:text-red-400" aria-hidden />
                        </IconButton>
                      </div>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <ConfirmDialog
        open={!!removing}
        title={t('users.removeTitle', { email: removing?.email ?? '' })}
        body={t('users.removeBody')}
        confirmLabel={t('users.remove')}
        tone="danger"
        busy={!!busy}
        onCancel={() => setRemoving(null)}
        onConfirm={() => void remove()}
      />
    </div>
  );
}
