import { useState, type FormEvent, type ReactNode } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useI18n } from '@/i18n';
import { formatDateTime } from '@/utils/time';
import { RoleBadge, UserStatusBadge } from '@/components/common/Badges';
import { Alert } from '@/components/common/Feedback';
import { Button, TextField } from '@/components/common/Form';
import { PasswordForm } from '@/components/auth/PasswordForm';

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6 dark:border-slate-800 dark:bg-slate-900">
      <h2 className="text-base font-semibold text-slate-900 dark:text-white">{title}</h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}

export function AccountPage() {
  const { t, locale } = useI18n();
  const { profile, updateFullName } = useAuth();
  const [name, setName] = useState(profile?.fullName ?? '');
  const [nameError, setNameError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<{ tone: 'success' | 'error'; message: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [passwordSaved, setPasswordSaved] = useState(false);

  if (!profile) return null;

  const onSaveName = async (e: FormEvent) => {
    e.preventDefault();
    if (saving) return;
    const trimmed = name.trim();
    if (!trimmed || trimmed.length > 120) return setNameError(t('account.errorName'));
    setNameError(null);
    setSaving(true);
    const error = await updateFullName(trimmed);
    setSaving(false);
    setSaveState(error ? { tone: 'error', message: t('common.saveError', { message: error }) } : { tone: 'success', message: t('account.saved') });
  };

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">{t('account.title')}</h1>

      <Card title={t('account.profile')}>
        <dl className="mb-5 grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-slate-500 dark:text-slate-400">{t('account.email')}</dt>
            <dd className="mt-0.5 font-medium text-slate-900 dark:text-white" dir="ltr">
              {profile.email}
            </dd>
          </div>
          <div>
            <dt className="text-slate-500 dark:text-slate-400">{t('account.role')}</dt>
            <dd className="mt-1 flex gap-1.5">
              <RoleBadge role={profile.role} />
              <UserStatusBadge status={profile.status} />
            </dd>
          </div>
          <div>
            <dt className="text-slate-500 dark:text-slate-400">{t('account.lastLogin')}</dt>
            <dd className="mt-0.5 font-medium text-slate-900 dark:text-white">
              {profile.lastLoginAt ? formatDateTime(profile.lastLoginAt, locale) : t('common.never')}
            </dd>
          </div>
        </dl>
        <form onSubmit={onSaveName} noValidate className="flex flex-col gap-4">
          {saveState ? <Alert tone={saveState.tone}>{saveState.message}</Alert> : null}
          <TextField
            label={t('account.fullName')}
            value={name}
            maxLength={120}
            autoComplete="name"
            onChange={(e) => setName(e.target.value)}
            error={nameError}
            disabled={saving}
          />
          <Button type="submit" loading={saving} className="self-start" disabled={name.trim() === profile.fullName}>
            {t('account.save')}
          </Button>
        </form>
      </Card>

      <Card title={t('account.password')}>
        {passwordSaved ? <Alert tone="success" className="mb-4">{t('auth.passwordUpdated')}</Alert> : null}
        <PasswordForm requireCurrent onSaved={() => setPasswordSaved(true)} />
      </Card>

      <Card title={t('account.security')}>
        <p className="text-sm text-slate-600 dark:text-slate-400">{t('account.mfaPrepared')}</p>
      </Card>
    </div>
  );
}
