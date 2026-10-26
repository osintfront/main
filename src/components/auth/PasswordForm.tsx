import { useState, type FormEvent } from 'react';
import { useI18n } from '@/i18n';
import { checkCurrentPassword, strongPassword, updatePassword } from '@/services/authService';
import { Alert } from '@/components/common/Feedback';
import { Button, TextField } from '@/components/common/Form';

/** New-password form: reset flow, and account settings (`requireCurrent`: the current password must match). */
export function PasswordForm({ onSaved, requireCurrent = false }: { onSaved: () => void; requireCurrent?: boolean }) {
  const { t } = useI18n();
  const [current, setCurrent] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<{ current?: string; password?: string; confirm?: string }>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (saving) return;
    const next: typeof errors = {};
    if (requireCurrent && !current) next.current = t('auth.errorCurrentPassword');
    if (!strongPassword(password)) next.password = t('auth.errorPasswordShort');
    if (confirm !== password) next.confirm = t('auth.errorPasswordMismatch');
    setErrors(next);
    if (Object.keys(next).length > 0) return;

    setSaving(true);
    setServerError(null);
    if (requireCurrent && !(await checkCurrentPassword(current))) {
      setSaving(false);
      return setErrors({ current: t('auth.errorCurrentPassword') });
    }
    const { error } = await updatePassword(password);
    setSaving(false);
    if (error) return setServerError(t('common.saveError', { message: error }));
    setCurrent('');
    setPassword('');
    setConfirm('');
    onSaved();
  };

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      {serverError ? <Alert tone="error">{serverError}</Alert> : null}
      {requireCurrent ? (
        <TextField
          label={t('auth.currentPassword')}
          type="password"
          autoComplete="current-password"
          dir="ltr"
          value={current}
          maxLength={256}
          onChange={(e) => setCurrent(e.target.value)}
          error={errors.current}
          disabled={saving}
        />
      ) : null}
      <TextField
        label={t('auth.newPassword')}
        type="password"
        autoComplete="new-password"
        dir="ltr"
        value={password}
        maxLength={256}
        onChange={(e) => setPassword(e.target.value)}
        error={errors.password}
        hint={t('auth.passwordRules')}
        disabled={saving}
      />
      <TextField
        label={t('auth.confirmPassword')}
        type="password"
        autoComplete="new-password"
        dir="ltr"
        value={confirm}
        maxLength={256}
        onChange={(e) => setConfirm(e.target.value)}
        error={errors.confirm}
        disabled={saving}
      />
      <Button type="submit" loading={saving} className="w-full sm:w-auto sm:self-start">
        {saving ? t('auth.saving') : t('auth.savePassword')}
      </Button>
    </form>
  );
}
