import type { RedemptionRow } from '@/services/planService';
import type { Profile } from '@/types/user';

/** Days left until a date (null = no end date). */
export function daysLeft(until: string | null | undefined): number | null {
  return until ? Math.ceil((new Date(until).getTime() - Date.now()) / 86_400_000) : null;
}

/** "14 ימים" / "היום" / "פג" — how long a plan still runs. */
export function leftLabel(until: string | null | undefined): string {
  const n = daysLeft(until);
  if (n === null) return 'ללא תפוגה';
  if (n < 0) return 'פג';
  if (n === 0) return 'מסתיים היום';
  return `${n} ימים`;
}

/**
 * Users page: which licence this account is on and for how long.
 * A plan set by hand (no key) says so, so a paid account is never mistaken for a redeemed licence.
 */
export function LicenseCell({ u, license }: { u: Profile; license?: RedemptionRow | null }) {
  const manual =
    u.planSource === 'paid' ? 'בתשלום · הוגדר ידנית' : u.planSource === 'eval' ? 'Eval · הוגדר ידנית' : null;

  if (!license) {
    return (
      <div dir="rtl" className="text-xs text-slate-500 dark:text-slate-400">
        {u.plan === 'free' ? '—' : manual ?? '—'}
      </div>
    );
  }

  const expired = (daysLeft(u.planExpiresAt) ?? 1) < 0;
  return (
    <div dir="rtl" className="space-y-0.5 text-xs">
      <div className="font-mono font-semibold text-slate-800 dark:text-slate-100" dir="ltr">
        {license.key}
      </div>
      <div className="text-slate-600 dark:text-slate-300">
        {license.plan.toUpperCase()} · {license.duration_days} ימים
        {license.revoked ? <span className="ms-1 font-semibold text-amber-700 dark:text-amber-400">(הרישיון בוטל)</span> : null}
      </div>
      <div className={expired ? 'text-red-600 dark:text-red-400' : 'text-slate-500 dark:text-slate-400'}>
        מומש {new Date(license.redeemed_at).toLocaleDateString('he-IL')} · נותרו {leftLabel(u.planExpiresAt)}
      </div>
      {license.note ? <div className="truncate text-slate-400" title={license.note}>{license.note}</div> : null}
    </div>
  );
}
