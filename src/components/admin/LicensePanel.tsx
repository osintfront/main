import { useEffect, useState } from 'react';
import { Copy, KeyRound } from 'lucide-react';
import { createLicense, deleteLicense, listLicenses, revokeLicense, type LicenseRow } from '@/services/planService';

/** Super admin only: "יצירת רישיון Eval" — Pro / Max for 7 / 14 / 30 days. */
export function LicensePanel() {
  const [plan, setPlan] = useState<'pro' | 'max'>('pro');
  const [days, setDays] = useState<7 | 14 | 30>(14);
  const [note, setNote] = useState('');
  const [uses, setUses] = useState(1);
  const [key, setKey] = useState<string | null>(null);
  const [rows, setRows] = useState<LicenseRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const reload = () => void listLicenses().then(setRows).catch(() => {});
  useEffect(reload, []);
  const sel = 'h-9 rounded-lg border border-slate-300 bg-white px-2 text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-white';

  return (
    <section dir="rtl" className="mt-5 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
      <h2 className="flex items-center gap-2 text-base font-bold text-slate-900 dark:text-white"><KeyRound className="size-4" />יצירת רישיון Eval</h2>
      <div className="mt-3 flex flex-wrap items-end gap-2 text-sm text-slate-700 dark:text-slate-200">
        <label>חבילה<br /><select className={sel} value={plan} onChange={(e) => setPlan(e.target.value as 'pro' | 'max')}><option value="pro">Pro</option><option value="max">Max</option></select></label>
        <label>משך<br /><select className={sel} value={days} onChange={(e) => setDays(Number(e.target.value) as 7 | 14 | 30)}><option value={7}>7 ימים</option><option value={14}>14 ימים</option><option value={30}>30 ימים</option></select></label>
        <label>הערה (שם לקוח)<br /><input className={`${sel} w-44`} value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} /></label>
        <label>מספר שימושים<br /><input type="number" min={1} max={1000} className={`${sel} w-20`} value={uses} onChange={(e) => setUses(Math.max(1, Number(e.target.value) || 1))} /></label>
        <button type="button" disabled={busy} className="h-9 rounded-lg bg-sky-600 px-4 font-semibold text-white hover:bg-sky-500 disabled:opacity-50"
          onClick={async () => {
            setBusy(true); setMsg(null);
            try { setKey(await createLicense(plan, days, note.trim(), uses)); setNote(''); reload(); } catch { setMsg('היצירה נכשלה'); } finally { setBusy(false); }
          }}>צור רישיון</button>
      </div>
      {key ? (
        <div className="mt-3 flex items-center gap-2">
          <code dir="ltr" className="rounded-lg bg-slate-100 px-3 py-1.5 font-mono font-bold dark:bg-slate-800">{key}</code>
          <button type="button" className="inline-flex items-center gap-1 text-sm font-semibold text-sky-700 dark:text-sky-400" onClick={() => void navigator.clipboard.writeText(key).then(() => setMsg('הועתק ✓'))}><Copy className="size-4" />העתק</button>
        </div>
      ) : null}
      {msg ? <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">{msg}</p> : null}
      {rows.length ? (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-slate-500"><tr><th className="py-1 text-start">מפתח</th><th className="text-start">חבילה</th><th className="text-start">ימים</th><th className="text-start">שימושים</th><th className="text-start">הערה</th><th className="text-start">בתוקף עד</th><th /></tr></thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {rows.map((r) => (
                <tr key={r.key} className={r.revoked ? 'opacity-50' : ''}>
                  <td className="py-1 font-mono" dir="ltr">{r.key}</td><td>{r.plan.toUpperCase()}</td><td>{r.duration_days}</td><td>{r.uses}/{r.max_uses}</td>
                  <td>{r.note ?? ''}</td><td>{new Date(r.redeem_by).toLocaleDateString('he-IL')}</td>
                  <td className="whitespace-nowrap">
                    {r.revoked ? 'בוטל' : <button type="button" className="font-semibold text-amber-700 dark:text-amber-400" onClick={() => void revokeLicense(r.key).then(reload)}>ביטול</button>}
                    <button type="button" className="ms-3 font-semibold text-red-600" onClick={() => { if (window.confirm(`למחוק את ${r.key}? הרישיון יבוטל וימחק לגמרי.`)) void deleteLicense(r.key).then(reload); }}>מחיקה</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}
