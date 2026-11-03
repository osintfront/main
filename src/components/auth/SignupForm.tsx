import { useState, type FormEvent } from 'react';
import { MailCheck } from 'lucide-react';
import { useI18n } from '@/i18n';
import { signUp, strongPassword } from '@/services/authService';
import { isValidEmail } from '@/utils/url';
import { Alert } from '@/components/common/Feedback';
import { Button, TextField } from '@/components/common/Form';

/** Self sign-up with email + password. After submit: "check your email" (the link activates it). */
export function SignupForm() {
  const { t } = useI18n();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<{ name?: string; email?: string; password?: string }>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const next: typeof errors = {};
    if (!name.trim()) next.name = t('signup.nameRequired');
    if (!isValidEmail(email)) next.email = t('auth.errorEmailInvalid');
    if (!strongPassword(password)) next.password = t('signup.passwordRule');
    setErrors(next);
    setFailure(null);
    if (Object.keys(next).length) return;
    setBusy(true);
    const { error } = await signUp(name, email, password);
    setBusy(false);
    if (error) return setFailure(t('signup.failed', { message: error }));
    setSentTo(email.trim().toLowerCase());
  };

  if (sentTo)
    return (
      <div data-auth="check-email" className="flex flex-col items-center gap-2 py-4 text-center">
        <MailCheck className="size-10 text-sky-600" aria-hidden />
        <h3 className="text-base font-bold">{t('signup.checkTitle')}</h3>
        <p className="text-sm text-slate-600 dark:text-slate-400">{t('signup.checkBody', { email: sentTo })}</p>
      </div>
    );

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      {failure ? <Alert tone="error">{failure}</Alert> : null}
      <TextField label={t('signup.name')} autoComplete="name" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} error={errors.name} disabled={busy} />
      <TextField label={t('auth.email')} type="email" inputMode="email" autoComplete="email" dir="ltr" value={email} maxLength={254} onChange={(e) => setEmail(e.target.value)} error={errors.email} disabled={busy} />
      <TextField label={t('auth.password')} type="password" autoComplete="new-password" dir="ltr" value={password} maxLength={256} onChange={(e) => setPassword(e.target.value)} error={errors.password} disabled={busy} />
      <p className="-mt-2 text-xs text-slate-500 dark:text-slate-400">{t('signup.passwordRule')}</p>
      <Button type="submit" loading={busy} className="w-full">{t('signup.submit')}</Button>
    </form>
  );
}
