import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, Loader2, Lock, X } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useI18n } from '@/i18n';
import type { TranslationKey } from '@/i18n/en';
import { shekels } from '@/content/packages';
import { cn } from '@/utils/cn';
import {
  cancelSubscription,
  loadBillingOptions,
  loadOrder,
  nameOk,
  phoneOk,
  startCheckout,
  type BillingOptions,
  type OrderState,
  type PaidPlan,
  type Period,
  type Quote,
} from '@/lib/billing';

const LABEL: Record<PaidPlan, string> = { pro: 'Pro', max: 'Max' };
const btnPrimary = 'flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-sky-600 px-4 text-sm font-bold text-white hover:bg-sky-700 disabled:opacity-60';
const btnMuted = 'flex min-h-11 w-full items-center justify-center rounded-xl bg-slate-100 px-4 text-center text-sm font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300';

export function useBilling() {
  const { status } = useAuth();
  const [opts, setOpts] = useState<BillingOptions | null>(null);
  const reload = useCallback(async () => setOpts(await loadBillingOptions()), []);
  useEffect(() => {
    if (status === 'signed_in') void reload();
    else setOpts(null);
  }, [status, reload]);
  return { opts, reload };
}

function useDate() {
  const { locale } = useI18n();
  return (iso: string | null | undefined) =>
    iso ? new Date(iso).toLocaleDateString(locale, { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Jerusalem' }) : '';
}

/** The button on a plan card: buy, upgrade, renew, or why there is nothing to buy. */
export function BillingCta({ plan, period, opts, onBuy, primary }: { plan: PaidPlan; period: Period; opts: BillingOptions | null; onBuy: (q: Quote) => void; primary?: boolean }) {
  const { t } = useI18n();
  const { status } = useAuth();
  if (status !== 'signed_in') {
    return <Link to="/login?mode=signup" className={btnPrimary}>{t('bill.buy', { plan: LABEL[plan] })}</Link>;
  }
  const q = opts?.options?.[`${plan}_${period}`];
  if (!q) return <div className={btnMuted}><Loader2 className="size-4 animate-spin" aria-hidden /></div>;

  if (q.allowed) {
    const label =
      q.kind === 'upgrade' ? t('bill.upgrade', { plan: LABEL[plan] })
      : q.kind === 'renew' ? t('bill.renew')
      : q.kind === 'replace' ? t('bill.replace')
      : t('bill.buy', { plan: LABEL[plan] });
    return (
      <div className="flex flex-col gap-1.5">
        <button type="button" onClick={() => onBuy(q)} className={cn(btnPrimary, !primary && 'bg-slate-900 hover:bg-slate-800 dark:bg-sky-600 dark:hover:bg-sky-700')}>
          {label}
        </button>
        {q.kind === 'upgrade' && (q.credit_days ?? 0) >= 1 && q.from_plan ? (
          <p className="text-center text-xs text-emerald-700 dark:text-emerald-400">
            {t('bill.creditNote', { plan: LABEL[q.from_plan as PaidPlan] ?? q.from_plan, n: Math.floor(q.credit_days ?? 0) })}
          </p>
        ) : null}
      </div>
    );
  }

  const cur = (q.current_plan ?? '') as PaidPlan;
  const msg =
    q.reason === 'current_plan'
      ? q.current_period === period
        ? `${t('bill.currentPlan')}${period === 'monthly' ? ` · ${t('bill.currentMonthly')}` : ''}`
        : t('bill.yearlyActive', { plan: LABEL[cur] ?? cur })
      : q.reason === 'lower_plan'
        ? t('bill.included', { plan: LABEL[cur] ?? cur })
        : t('bill.notAvailable');
  return <div className={btnMuted} role="note">{msg}</div>;
}

/** The details form shown before Grow's payment page (Grow asks sites to have one). */
export function CheckoutDialog({ plan, period, quote, returnTo, onClose }: { plan: PaidPlan; period: Period; quote: Quote; returnTo: string; onClose: () => void }) {
  const { t, locale } = useI18n();
  const { profile } = useAuth();
  const [fullName, setFullName] = useState(profile?.fullName ?? '');
  const [phone, setPhone] = useState('');
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const first = useRef<HTMLInputElement>(null);
  useEffect(() => first.current?.focus(), []);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && !busy && onClose();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [busy, onClose]);

  const price = shekels((quote.amount_agorot ?? 0) / 100, locale);
  const errText = (code: string) => {
    const key = `bill.err.${code}` as TranslationKey;
    const s = t(key);
    return s === key ? t('bill.err.generic') : s;
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!nameOk(fullName)) return setError(errText('bad_name'));
    if (!phoneOk(phone)) return setError(errText('bad_phone'));
    setBusy(true);
    setError(null);
    const r = await startCheckout({ plan, period, fullName, phone, returnTo });
    if ('url' in r) {
      window.location.assign(r.url);
      return; // stays "busy" while the browser leaves
    }
    setBusy(false);
    setError(errText(r.error));
  };

  const field = 'mt-1 min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-base text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-white';
  return (
    <div className="fixed inset-0 z-[1200] flex items-end justify-center bg-slate-950/60 p-0 sm:items-center sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <form role="dialog" aria-modal="true" aria-labelledby="bill-title" onSubmit={submit}
        className="relative flex max-h-[95dvh] w-full max-w-md flex-col gap-4 overflow-y-auto rounded-t-2xl bg-white p-5 shadow-xl sm:rounded-2xl dark:bg-slate-900">
        <button type="button" onClick={onClose} disabled={busy} aria-label={t('bill.cancelForm')} className="absolute end-3 top-3 rounded-lg p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800">
          <X className="size-5" aria-hidden />
        </button>
        <div>
          <h2 id="bill-title" className="text-lg font-bold text-slate-900 dark:text-white">{t('bill.formTitle')}</h2>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
            <span className="font-semibold" translate="no">{LABEL[plan]}</span> · {period === 'monthly' ? t('pk.monthly') : t('pk.yearly').split('·')[0].trim()} · <span className="font-semibold tabular-nums">{price}</span>
          </p>
          <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">{t('bill.formLead')}</p>
        </div>
        <label className="block text-sm font-medium text-slate-700 dark:text-slate-200">
          {t('bill.fullName')}
          <input ref={first} className={field} value={fullName} onChange={(e) => setFullName(e.target.value)} autoComplete="name" required />
        </label>
        <label className="block text-sm font-medium text-slate-700 dark:text-slate-200">
          {t('bill.phone')}
          <input className={field} value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" autoComplete="tel" dir="ltr" placeholder="05XXXXXXXX" required />
        </label>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          {t('bill.email')}: <span dir="ltr" className="font-medium">{profile?.email}</span>
        </p>
        <label className="flex items-start gap-2.5 text-sm text-slate-700 dark:text-slate-200">
          <input type="checkbox" className="mt-1 size-4 shrink-0" checked={agree} onChange={(e) => setAgree(e.target.checked)} required />
          <span>
            {t(period === 'monthly' ? 'bill.termsMonthly' : 'bill.termsYearly', { price })}{' '}
            <Link to="/terms" target="_blank" className="font-semibold text-sky-700 underline dark:text-sky-400">{t('bill.termsLink')}</Link>
          </span>
        </label>
        {error ? <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800 dark:bg-red-500/10 dark:text-red-300">{error}</p> : null}
        <button type="submit" disabled={busy || !agree} className={btnPrimary}>
          {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Lock className="size-4" aria-hidden />}
          {busy ? t('bill.paying') : t('bill.pay')}
        </button>
      </form>
    </div>
  );
}

/** After Grow sends the buyer back (?order=…): waits for Grow's confirmation and says what happened. */
export function OrderBanner({ orderId, onDone }: { orderId: string; onDone: () => void }) {
  const { t } = useI18n();
  const { refreshProfile } = useAuth();
  const date = useDate();
  const [order, setOrder] = useState<OrderState | null>(null);
  const [until, setUntil] = useState<string | null>(null);
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    let stop = false;
    const started = Date.now();
    const tick = async () => {
      if (stop) return;
      const o = await loadOrder(orderId);
      if (stop) return;
      setOrder(o);
      if (o?.status === 'paid') {
        await refreshProfile();
        const opts = await loadBillingOptions();
        setUntil(opts?.subscription?.current_period_end ?? opts?.plan_expires_at ?? null);
        onDone();
        return;
      }
      if (o?.status === 'failed') return;
      const age = Date.now() - started;
      if (age > 45_000) setSlow(true);
      // Every 2 s for the first minute, then every 15 s for half an hour.
      if (age < 30 * 60_000) setTimeout(tick, age < 60_000 ? 2000 : 15_000);
    };
    void tick();
    return () => {
      stop = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId]);

  if (order?.status === 'paid') {
    return (
      <Banner tone="ok" icon={<CheckCircle2 className="size-6" aria-hidden />} title={t('bill.ok.title', { plan: LABEL[order.plan] })}>
        {order.period === 'monthly' ? t('bill.ok.bodyMonthly') : t('bill.ok.body', { date: date(until) })}
      </Banner>
    );
  }
  if (order?.status === 'failed') {
    return <Banner tone="bad" icon={<AlertTriangle className="size-6" aria-hidden />} title={t('bill.fail.title')}>{t('bill.fail.body')}</Banner>;
  }
  return (
    <Banner tone="wait" icon={<Loader2 className="size-6 animate-spin" aria-hidden />} title={t('bill.wait.title')}>
      {slow ? t('bill.wait.slow') : t('bill.wait.body')}
    </Banner>
  );
}

function Banner({ tone, icon, title, children }: { tone: 'ok' | 'bad' | 'wait'; icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <section role="status" aria-live="polite"
      className={cn('mx-auto mt-6 flex max-w-3xl items-start gap-3 rounded-2xl p-5 ring-1',
        tone === 'ok' && 'bg-emerald-50 text-emerald-900 ring-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-200 dark:ring-emerald-500/30',
        tone === 'bad' && 'bg-red-50 text-red-900 ring-red-200 dark:bg-red-500/10 dark:text-red-200 dark:ring-red-500/30',
        tone === 'wait' && 'bg-sky-50 text-sky-900 ring-sky-200 dark:bg-sky-500/10 dark:text-sky-200 dark:ring-sky-500/30')}>
      <span className="shrink-0">{icon}</span>
      <div>
        <h2 className="text-base font-bold">{title}</h2>
        <p className="mt-1 text-sm">{children}</p>
      </div>
    </section>
  );
}

/** The user's subscription: next charge / end date, failed charge, cancel button. */
export function SubscriptionPanel({ opts, reload }: { opts: BillingOptions | null; reload: () => Promise<void> }) {
  const { t } = useI18n();
  const { refreshProfile } = useAuth();
  const date = useDate();
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const sub = opts?.subscription;
  if (!sub) return null;
  const plan = LABEL[sub.plan];
  const end = date(sub.current_period_end);
  const soon = sub.period === 'yearly' && new Date(sub.current_period_end).getTime() - Date.now() < 30 * 86400_000;

  const line =
    sub.status === 'canceled' ? t('bill.sub.canceled', { plan, date: end })
    : sub.status === 'past_due' ? t('bill.sub.pastDue', { plan, date: end })
    : sub.period === 'monthly' ? t('bill.sub.monthly', { plan, date: end })
    : soon ? t('bill.sub.renewSoon', { date: end })
    : t('bill.sub.yearly', { plan, date: end });

  const doCancel = async () => {
    setBusy(true);
    const r = await cancelSubscription();
    setBusy(false);
    setConfirm(false);
    if (r.ok) {
      setMsg(t('bill.canceled', { date: end }));
      await refreshProfile();
      await reload();
    } else setMsg(t('bill.err.generic'));
  };

  return (
    <section className={cn('mx-auto mt-6 max-w-3xl rounded-2xl bg-white p-5 shadow-sm ring-1 dark:bg-slate-900',
      sub.status === 'past_due' ? 'ring-red-300 dark:ring-red-500/40' : 'ring-slate-900/10 dark:ring-white/10')}>
      <h2 className="text-base font-bold text-slate-900 dark:text-white">{t('bill.sub.title')}</h2>
      <p className="mt-1 text-sm text-slate-700 dark:text-slate-300">{line}</p>
      {msg ? <p role="status" className="mt-2 text-sm font-semibold text-emerald-700 dark:text-emerald-400">{msg}</p> : null}
      {sub.period === 'monthly' && sub.status !== 'canceled' ? (
        confirm ? (
          <div className="mt-3 flex flex-col gap-2 rounded-xl bg-slate-50 p-3 sm:flex-row sm:items-center dark:bg-slate-800">
            <p className="flex-1 text-sm text-slate-800 dark:text-slate-100">{t('bill.cancelConfirm', { date: end })}</p>
            <div className="flex gap-2">
              <button type="button" disabled={busy} onClick={doCancel} className="min-h-10 rounded-lg bg-red-600 px-4 text-sm font-bold text-white hover:bg-red-700 disabled:opacity-60">
                {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : t('bill.cancelYes')}
              </button>
              <button type="button" disabled={busy} onClick={() => setConfirm(false)} className="min-h-10 rounded-lg px-4 text-sm font-semibold text-slate-700 ring-1 ring-slate-300 dark:text-slate-200 dark:ring-slate-600">
                {t('bill.cancelNo')}
              </button>
            </div>
          </div>
        ) : (
          <button type="button" onClick={() => setConfirm(true)} className="mt-3 text-sm font-semibold text-red-700 underline hover:text-red-800 dark:text-red-400">
            {t('bill.cancel')}
          </button>
        )
      ) : sub.period === 'yearly' ? (
        <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
          {t('bill.yearlyCancel')} <Link to="/contact" className="font-semibold text-sky-700 underline dark:text-sky-400">{t('pk.contactCta')}</Link>
        </p>
      ) : null}
    </section>
  );
}
