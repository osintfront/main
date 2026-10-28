import { useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { effectivePlan, PLAN_LABEL } from '@/lib/plans';
import { redeemLicense } from '@/services/planService';

/** Account settings: the current plan, and redeeming an eval license key. */
export function PlanCard() {
  const { profile, refreshProfile } = useAuth();
  const [key, setKey] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  if (!profile) return null;
  const plan = effectivePlan(profile);
  return (
    <section dir="rtl" className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6 dark:border-slate-800 dark:bg-slate-900">
      <h2 className="text-base font-semibold text-slate-900 dark:text-white">החבילה שלך: {PLAN_LABEL[plan]}</h2>
      {profile.planExpiresAt && plan !== 'free' ? (
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">בתוקף עד {new Date(profile.planExpiresAt).toLocaleDateString('he-IL')}</p>
      ) : null}
      <form className="mt-4 flex flex-wrap gap-2" onSubmit={async (e) => {
        e.preventDefault();
        if (!key.trim() || busy) return;
        setBusy(true); setMsg(null);
        try {
          const r = await redeemLicense(key);
          if (r.ok) { setMsg({ ok: true, text: `הרישיון הופעל: ${PLAN_LABEL[r.plan!]} עד ${new Date(r.expires_at!).toLocaleDateString('he-IL')}` }); setKey(''); await refreshProfile(); }
          else setMsg({ ok: false, text: r.error === 'rate_limited' ? 'יותר מדי ניסיונות. נסו שוב בעוד רבע שעה.' : 'המפתח לא תקין או שכבר נוצל.' });
        } catch { setMsg({ ok: false, text: 'ההפעלה נכשלה. נסו שוב.' }); } finally { setBusy(false); }
      }}>
        <input dir="ltr" value={key} onChange={(e) => setKey(e.target.value)} placeholder="OSF-PRO-14-XXXX-XXXX" maxLength={40}
          className="h-10 flex-1 rounded-lg border border-slate-300 bg-white px-3 font-mono text-sm uppercase dark:border-slate-700 dark:bg-slate-950 dark:text-white" />
        <button type="submit" disabled={busy} className="h-10 rounded-lg bg-sky-600 px-4 text-sm font-semibold text-white disabled:opacity-50">הפעלת רישיון</button>
      </form>
      {msg ? <p className={`mt-2 text-sm ${msg.ok ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-600'}`}>{msg.text}</p> : null}
    </section>
  );
}
