import { useState } from 'react';
import type { PlanId, Profile } from '@/types/user';
import { effectivePlan, PLAN_LABEL } from '@/lib/plans';
import { extendEval, removePlan, setPlan } from '@/services/planService';

const SOURCE: Record<Profile['planSource'], string> = { default: 'ברירת מחדל', eval: 'Eval', paid: 'בתשלום' };

/** Users page: plan, source, expiry, days left; super admin changes it in one click. */
export function PlanCell({ u, canEdit, onChanged }: { u: Profile; canEdit: boolean; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const plan = effectivePlan(u);
  const left = u.planExpiresAt ? Math.ceil((new Date(u.planExpiresAt).getTime() - Date.now()) / 86_400_000) : null;
  const run = async (f: () => Promise<void>) => { setBusy(true); try { await f(); onChanged(); } catch { /* shown by reload */ } finally { setBusy(false); } };
  return (
    <div dir="rtl" className="space-y-1">
      <div>
        <b>{PLAN_LABEL[plan]}</b> · {SOURCE[u.planSource]}
        {u.planExpiresAt ? <span className="text-slate-500"> · עד {new Date(u.planExpiresAt).toLocaleDateString('he-IL')} ({left! > 0 ? `${left} ימים` : 'פג'})</span> : null}
      </div>
      {canEdit ? (
        <div className="flex flex-wrap gap-1">
          <select disabled={busy} value={u.plan} onChange={(e) => void run(() => setPlan(u.id, e.target.value as PlanId, e.target.value === 'free' ? 'default' : 'paid', null))}
            className="h-7 rounded border border-slate-200 bg-white px-1 dark:border-slate-700 dark:bg-slate-900">
            <option value="free">Free</option><option value="pro">Pro</option><option value="max">Max</option>
          </select>
          {u.plan !== 'free' ? (
            <>
              <button type="button" disabled={busy} className="rounded bg-sky-50 px-2 font-semibold text-sky-700 dark:bg-sky-500/10 dark:text-sky-300" onClick={() => void run(() => extendEval(u.id, 7))}>+7 ימים</button>
              <button type="button" disabled={busy} className="rounded bg-red-50 px-2 font-semibold text-red-700 dark:bg-red-500/10 dark:text-red-300" onClick={() => void run(() => removePlan(u.id))}>חזרה ל-Free</button>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
