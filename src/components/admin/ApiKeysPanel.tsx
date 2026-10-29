import { useEffect, useState } from 'react';
import { Copy, Plug } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { ToggleField } from '@/components/common/Form';

/** Super admin only: the paid data API (migration 0072) — on/off switch, keys, usage today. */
interface KeyRow {
  id: string;
  name: string;
  owner_email: string | null;
  tier: string;
  key_prefix: string;
  created_at: string;
  expires_at: string | null;
  revoked_at: string | null;
  last_used_at: string | null;
}

const fmt = (iso: string | null) => (iso ? new Intl.DateTimeFormat('he-IL', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(iso)) : '—');

export function ApiKeysPanel() {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [rows, setRows] = useState<KeyRow[]>([]);
  const [today, setToday] = useState<Record<string, number>>({});
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [tier, setTier] = useState<'starter' | 'business'>('starter');
  const [days, setDays] = useState<number | ''>('');
  const [key, setKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const reload = () => {
    if (!supabase) return;
    void supabase.from('app_settings').select('value').eq('key', 'api_enabled').maybeSingle().then(({ data }) => setEnabled(data?.value === true));
    void supabase.from('api_keys').select('id,name,owner_email,tier,key_prefix,created_at,expires_at,revoked_at,last_used_at').order('created_at', { ascending: false })
      .then(({ data }) => setRows((data ?? []) as KeyRow[]));
    void supabase.from('api_usage').select('key_id,calls').eq('day', new Date().toISOString().slice(0, 10))
      .then(({ data }) => setToday(Object.fromEntries(((data ?? []) as { key_id: string; calls: number }[]).map((r) => [r.key_id, r.calls]))));
  };
  useEffect(reload, []);
  const sel = 'h-9 rounded-lg border border-slate-300 bg-white px-2 text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-white';

  return (
    <section dir="rtl" className="mt-5 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
      <h2 className="flex items-center gap-2 text-base font-bold text-slate-900 dark:text-white"><Plug className="size-4" aria-hidden />API בתשלום</h2>
      <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
        אירועים בלבד, בלי ספינות, מטוסים, אזורי שליטה, התרעות פיקוד העורף או מדיה. Starter: עד 1,000 בקשות ביום, לשימוש פנימי. Business: עד 10,000 בקשות ביום, מותר להציג ללקוחות.
        כתובת: <code dir="ltr" className="font-mono">GET https://osintfront.com/api/v1/events</code> עם הכותרת <code dir="ltr" className="font-mono">x-api-key</code>.
      </p>
      {enabled !== null ? (
        <div className="mt-3">
          <ToggleField
            label="ה-API פעיל"
            description="כבוי: כל בקשה נדחית, גם עם מפתח תקין."
            checked={enabled}
            disabled={busy}
            onChange={async (v) => {
              if (!supabase) return;
              setBusy(true);
              const { error } = await supabase.from('app_settings').update({ value: v }).eq('key', 'api_enabled');
              setBusy(false);
              if (error) setMsg('השמירה נכשלה');
              else setEnabled(v);
            }}
          />
        </div>
      ) : null}
      <form
        className="mt-3 flex flex-wrap items-end gap-2 text-sm text-slate-700 dark:text-slate-200"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!supabase || !name.trim()) return;
          setBusy(true); setMsg(null);
          const { data, error } = await supabase.rpc('api_create_key', { p_name: name.trim(), p_tier: tier, p_owner_email: email.trim() || null, p_days: days === '' ? null : days });
          setBusy(false);
          if (error || typeof data !== 'string') return setMsg('היצירה נכשלה');
          setKey(data); setName(''); setEmail(''); reload();
        }}
      >
        <label>שם הלקוח<br /><input name="api-client" autoComplete="off" className={`${sel} w-44`} value={name} maxLength={120} onChange={(e) => setName(e.target.value)} /></label>
        <label>מייל<br /><input name="api-email" type="email" autoComplete="off" spellCheck={false} dir="ltr" className={`${sel} w-48`} value={email} onChange={(e) => setEmail(e.target.value)} /></label>
        <label>חבילה<br /><select className={sel} value={tier} onChange={(e) => setTier(e.target.value as 'starter' | 'business')}><option value="starter">Starter</option><option value="business">Business</option></select></label>
        <label>תוקף בימים (ריק = ללא)<br /><input name="api-days" type="number" min={1} max={3650} className={`${sel} w-24`} value={days} onChange={(e) => setDays(e.target.value === '' ? '' : Math.max(1, Number(e.target.value) || 1))} /></label>
        <button type="submit" disabled={busy || !name.trim()} className="h-9 rounded-lg bg-sky-600 px-4 font-semibold text-white hover:bg-sky-500 disabled:opacity-50">צור מפתח</button>
      </form>
      {key ? (
        <div className="mt-3 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <code dir="ltr" className="break-all rounded-lg bg-slate-100 px-3 py-1.5 font-mono text-xs font-bold dark:bg-slate-800">{key}</code>
            <button type="button" className="inline-flex items-center gap-1 text-sm font-semibold text-sky-700 dark:text-sky-400" onClick={() => void navigator.clipboard.writeText(key).then(() => setMsg('הועתק ✓'))}><Copy className="size-4" aria-hidden />העתק</button>
          </div>
          <p className="text-xs text-amber-700 dark:text-amber-400">המפתח מוצג פעם אחת בלבד. העתק ושלח אותו ללקוח עכשיו.</p>
        </div>
      ) : null}
      {msg ? <p className="mt-2 text-sm text-slate-600 dark:text-slate-300" aria-live="polite">{msg}</p> : null}
      {rows.length ? (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-slate-500"><tr><th className="py-1 text-start">לקוח</th><th className="text-start">חבילה</th><th className="text-start">מפתח</th><th className="text-start">בקשות היום</th><th className="text-start">שימוש אחרון</th><th className="text-start">בתוקף עד</th><th /></tr></thead>
            <tbody className="text-slate-700 dark:text-slate-200">
              {rows.map((r) => (
                <tr key={r.id} className={`border-t border-slate-100 dark:border-slate-800 ${r.revoked_at ? 'opacity-50' : ''}`}>
                  <td className="py-1.5">{r.name}{r.owner_email ? <span dir="ltr" className="block text-slate-500">{r.owner_email}</span> : null}</td>
                  <td>{r.tier === 'business' ? 'Business' : 'Starter'}</td>
                  <td dir="ltr" className="font-mono">{r.key_prefix}…</td>
                  <td className="tabular-nums">{today[r.id] ?? 0}</td>
                  <td>{fmt(r.last_used_at)}</td>
                  <td>{r.revoked_at ? 'בוטל' : fmt(r.expires_at)}</td>
                  <td className="text-end">
                    {!r.revoked_at ? (
                      <button type="button" className="font-semibold text-red-600 hover:underline dark:text-red-400"
                        onClick={async () => {
                          if (!supabase || !window.confirm(`לבטל את המפתח של ${r.name}? הלקוח לא יוכל להשתמש בו יותר.`)) return;
                          const { error } = await supabase.rpc('api_revoke_key', { p_id: r.id });
                          if (error) setMsg('הביטול נכשל'); else reload();
                        }}>בטל</button>
                    ) : null}
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
