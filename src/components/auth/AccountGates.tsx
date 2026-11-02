import { useEffect, useId, useState, type ReactNode } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { PasswordForm } from '@/components/auth/PasswordForm';
import { LogoMark } from '@/components/common/Logo';

/**
 * Before the site: (1) a user created with a temporary password must choose a new one;
 * (2) when require_terms is on and the user has not accepted the current terms/privacy versions,
 *     accept them. Applies to every signed-in user (super admins included). Accepting once per
 *     version is enough: a new row in terms_acceptances is only needed after a version bump.
 */
export function AccountGates({ children }: { children: ReactNode }) {
  const { profile, refreshProfile, signOut } = useAuth();
  const [terms, setTerms] = useState<{ need: boolean; tv: string; pv: string } | null>(null);
  const [agreed, setAgreed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);
  const checkId = useId();

  useEffect(() => {
    if (!supabase || !profile) return;
    let off = false;
    void (async () => {
      const { data } = await supabase!.from('app_settings').select('key,value').in('key', ['require_terms', 'terms_version', 'privacy_version']);
      const v = Object.fromEntries((data ?? []).map((r: { key: string; value: unknown }) => [r.key, r.value]));
      if (v.require_terms !== true) return off ? undefined : setTerms({ need: false, tv: '', pv: '' });
      const tv = String(v.terms_version ?? ''), pv = String(v.privacy_version ?? '');
      const { data: acc } = await supabase!.from('terms_acceptances').select('terms_version,privacy_version').eq('user_id', profile.id).order('accepted_at', { ascending: false }).limit(1);
      const last = acc?.[0];
      if (!off) setTerms({ need: !last || last.terms_version !== tv || last.privacy_version !== pv, tv, pv });
    })();
    return () => { off = true; };
  }, [profile]);

  const box = (body: ReactNode) => (
    <div dir="rtl" className="grid min-h-dvh place-items-center bg-slate-950 p-4">
      <div className="w-full max-w-sm rounded-2xl bg-white p-6 text-slate-900 shadow-2xl dark:bg-slate-900 dark:text-white">
        <LogoMark className="mb-3 size-12" />
        {body}
      </div>
    </div>
  );

  if (profile?.mustChangePassword) {
    return box(
      <>
        <h1 className="mb-1 text-lg font-bold">בחירת סיסמה חדשה</h1>
        <p className="mb-4 text-sm text-slate-600 dark:text-slate-400">זו הכניסה הראשונה שלך. החליפו את הסיסמה הזמנית בסיסמה אישית.</p>
        <PasswordForm requireCurrent onSaved={async () => { await supabase?.rpc('password_changed'); await refreshProfile(); }} />
      </>,
    );
  }
  // Still checking whether terms must be accepted: show nothing rather than flash the site.
  if (supabase && profile && terms === null) return null;
  if (terms?.need) {
    const accept = async () => {
      if (!agreed || saving) return;
      setSaving(true);
      setError(false);
      const res = await supabase?.rpc('accept_terms', { p_terms: terms.tv, p_privacy: terms.pv });
      setSaving(false);
      if (!res || res.error) return setError(true);
      setTerms({ ...terms, need: false });
    };
    const link = 'font-medium text-sky-700 underline dark:text-sky-400';
    return box(
      <>
        <h1 className="mb-2 text-lg font-bold">אישור תנאי השימוש</h1>
        <p className="mb-4 text-sm text-slate-700 dark:text-slate-300">
          כדי להמשיך להשתמש באתר יש לקרוא ולאשר את{' '}
          <a className={link} href="/terms" target="_blank" rel="noopener noreferrer">תנאי השימוש</a>, את{' '}
          <a className={link} href="/privacy" target="_blank" rel="noopener noreferrer">מדיניות הפרטיות</a> ואת{' '}
          <a className={link} href="/refund-policy" target="_blank" rel="noopener noreferrer">מדיניות הביטולים</a>
          {' '}(נפתחים בלשונית חדשה).
        </p>
        <div className="mb-4 flex items-start gap-2">
          <input id={checkId} type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)}
            className="mt-1 size-4 shrink-0 accent-sky-600" />
          <label htmlFor={checkId} className="text-sm">קראתי ואני מסכים/ה לתנאי השימוש ולמדיניות הפרטיות, ואני מצהיר/ה שגילי 18 ומעלה.</label>
        </div>
        {error ? <p role="alert" className="mb-3 text-sm font-medium text-red-600 dark:text-red-400">שמירת האישור נכשלה. נסו שוב.</p> : null}
        <button type="button" disabled={!agreed || saving} onClick={() => void accept()}
          className="h-10 w-full rounded-lg bg-sky-600 font-semibold text-white hover:bg-sky-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500 disabled:cursor-not-allowed disabled:opacity-50">
          {saving ? 'שומר…' : 'אישור והמשך'}
        </button>
        <button type="button" onClick={() => void signOut()}
          className="mt-2 h-10 w-full rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-900/5 focus-visible:outline-2 focus-visible:outline-sky-500 dark:text-slate-300 dark:hover:bg-white/10">
          לא מאשר/ת — יציאה מהחשבון
        </button>
      </>,
    );
  }
  return <>{children}</>;
}
