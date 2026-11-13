import { useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { effectivePlan, PLAN_LABEL } from '@/lib/plans';
import { redeemLicense } from '@/services/planService';
import { useI18n } from '@/i18n';

/** Redeem errors from the redeem_license RPC, as translation keys. Unknown codes fall back to "invalid". */
const REDEEM_ERROR_KEY: Record<string, 'planCard.rateLimited' | 'planCard.paidActive' | 'planCard.planActive' | 'planCard.otherActive'> = {
  rate_limited: 'planCard.rateLimited',
  paid_plan_active: 'planCard.paidActive',
  plan_active: 'planCard.planActive',
  other_plan_active: 'planCard.otherActive',
};

/** Account settings: the current plan, and redeeming an eval license key. */
export function PlanCard() {
  const { profile, refreshProfile } = useAuth();
  const { t, dir, locale } = useI18n();
  const [key, setKey] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  if (!profile) return null;
  const plan = effectivePlan(profile);
  const date = (iso: string) => new Date(iso).toLocaleDateString(locale);
  return (
    <section dir={dir} className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6 dark:border-slate-800 dark:bg-slate-900">
      <h2 className="text-base font-semibold text-slate-900 dark:text-white">{t('user.plan', { plan: PLAN_LABEL[plan] })}</h2>
      {profile.planExpiresAt && plan !== 'free' ? (
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">{t('planCard.validUntil', { date: date(profile.planExpiresAt) })}</p>
      ) : null}
      <form className="mt-4 flex flex-wrap gap-2" onSubmit={async (e) => {
        e.preventDefault();
        if (!key.trim() || busy) return;
        setBusy(true); setMsg(null);
        try {
          const r = await redeemLicense(key);
          if (r.ok) { setMsg({ ok: true, text: t('planCard.activated', { plan: PLAN_LABEL[r.plan!], date: date(r.expires_at!) }) }); setKey(''); await refreshProfile(); }
          else setMsg({ ok: false, text: t(REDEEM_ERROR_KEY[r.error ?? ''] ?? 'planCard.invalid') });
        } catch { setMsg({ ok: false, text: t('planCard.failed') }); } finally { setBusy(false); }
      }}>
        <input dir="ltr" value={key} onChange={(e) => setKey(e.target.value)} placeholder="OSF-PRO-14-XXXX-XXXX" maxLength={40}
          className="h-10 flex-1 rounded-lg border border-slate-300 bg-white px-3 font-mono text-sm uppercase dark:border-slate-700 dark:bg-slate-950 dark:text-white" />
        <button type="submit" disabled={busy} className="h-10 rounded-lg bg-sky-600 px-4 text-sm font-semibold text-white disabled:opacity-50">{t('planCard.activate')}</button>
      </form>
      {msg ? <p className={`mt-2 text-sm ${msg.ok ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-600'}`}>{msg.text}</p> : null}
    </section>
  );
}
