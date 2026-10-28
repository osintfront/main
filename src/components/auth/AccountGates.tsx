import { useEffect, useState, type ReactNode } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { PasswordForm } from '@/components/auth/PasswordForm';
import { LogoMark } from '@/components/common/Logo';

/**
 * Before the site: (1) a user created with a temporary password must choose a new one;
 * (2) when require_terms is on and the terms/privacy version changed, accept them (off for now).
 */
export function AccountGates({ children }: { children: ReactNode }) {
  const { profile, refreshProfile } = useAuth();
  const [terms, setTerms] = useState<{ need: boolean; tv: string; pv: string } | null>(null);

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
  if (terms?.need) {
    return box(
      <>
        <h1 className="mb-2 text-lg font-bold">עדכון תנאי השימוש</h1>
        <p className="mb-4 text-sm">עדכנו את <a className="text-sky-600 underline" href="/terms" target="_blank">תנאי השימוש</a> ואת <a className="text-sky-600 underline" href="/privacy" target="_blank">מדיניות הפרטיות</a>. כדי להמשיך יש לאשר אותם.</p>
        <button type="button" className="h-10 w-full rounded-lg bg-sky-600 font-semibold text-white" onClick={async () => {
          await supabase?.rpc('accept_terms', { p_terms: terms.tv, p_privacy: terms.pv });
          setTerms({ ...terms, need: false });
        }}>קראתי ואני מאשר/ת</button>
      </>,
    );
  }
  return <>{children}</>;
}
