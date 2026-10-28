import { useState } from 'react';
import { Copy, Image as ImageIcon, Mail, MessageCircle, Share2, X } from 'lucide-react';
import { SITE_URL, WELCOME_LOGO, welcomeText } from '@/config/welcome';

/**
 * After "Create user": the password and a ready welcome message (logo + text) to share.
 * The password lives only in this panel's memory until it is closed — never stored or logged.
 */
export function WelcomePanel({ user, onClose }: { user: { name: string; email: string; password: string; plan: string }; onClose: () => void }) {
  const [done, setDone] = useState<string | null>(null);
  const text = welcomeText(user);
  const flash = (m: string) => { setDone(m); window.setTimeout(() => setDone(null), 2000); };
  const logoUrl = new URL(WELCOME_LOGO, SITE_URL).href;

  const logoBlob = async () => (await fetch(WELCOME_LOGO)).blob();
  const fileShare = typeof navigator !== 'undefined' && 'canShare' in navigator
    ? (() => { try { return navigator.canShare({ files: [new File([new Uint8Array(1)], 'logo.png', { type: 'image/png' })] }); } catch { return false; } })()
    : false;

  const share = async () => {
    try {
      const file = new File([await logoBlob()], 'osintfront.png', { type: 'image/png' });
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], text });
        flash('שותף ✓');
      }
    } catch { /* cancelled */ }
  };
  const copyLogo = async () => {
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': logoBlob() })]);
      flash('הלוגו הועתק ✓');
    } catch { flash('הדפדפן לא מאפשר להעתיק תמונה'); }
  };
  const copy = async (v: string, m: string) => { try { await navigator.clipboard.writeText(v); flash(m); } catch { /* ignore */ } };
  const waText = `${logoUrl}\n\n${text}`;
  const mail = `mailto:${encodeURIComponent(user.email)}?subject=${encodeURIComponent('ברוך הבא ל-OSINTFront')}&body=${encodeURIComponent(`${logoUrl}\n\n${text}`)}`;
  const btn = 'inline-flex items-center gap-1.5 rounded-lg bg-white px-3 py-2 text-sm font-semibold text-slate-800 ring-1 ring-slate-200 hover:bg-slate-50 dark:bg-slate-800 dark:text-slate-100 dark:ring-slate-700';

  return (
    <div dir="rtl" className="mt-4 rounded-2xl border border-emerald-300 bg-emerald-50 p-4 dark:border-emerald-500/40 dark:bg-emerald-500/10">
      <div className="flex items-start gap-3">
        <p className="flex-1 font-semibold text-emerald-900 dark:text-emerald-200">המשתמש נוצר: {user.email}</p>
        <button type="button" onClick={onClose} aria-label="סגירה" className="rounded-lg p-1 hover:bg-emerald-100 dark:hover:bg-emerald-500/20"><X className="size-4" /></button>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <code dir="ltr" className="rounded-lg bg-white px-3 py-2 font-mono text-base font-bold text-slate-900 ring-1 ring-emerald-300 dark:bg-slate-900 dark:text-white">{user.password}</code>
        <button type="button" className={btn} onClick={() => void copy(user.password, 'הסיסמה הועתקה ✓')}><Copy className="size-4" />העתק סיסמה</button>
        {fileShare ? (
          <button type="button" className={btn} onClick={() => void share()}><Share2 className="size-4" />שתף הודעת ברוכים הבאים</button>
        ) : (
          <>
            <button type="button" className={btn} onClick={() => void copyLogo()}><ImageIcon className="size-4" />העתק לוגו</button>
            <button type="button" className={btn} onClick={() => void copy(text, 'הטקסט הועתק ✓')}><Copy className="size-4" />העתק טקסט</button>
          </>
        )}
        <a className={btn} href={`https://wa.me/?text=${encodeURIComponent(waText)}`} target="_blank" rel="noopener noreferrer"><MessageCircle className="size-4" />שלח בוואטסאפ</a>
        <a className={btn} href={mail}><Mail className="size-4" />שלח במייל</a>
        {done ? <span className="text-sm font-semibold text-emerald-700 dark:text-emerald-300">{done}</span> : null}
      </div>
      <p className="mt-3 text-xs text-emerald-800 dark:text-emerald-300">תצוגה מקדימה של ההודעה:</p>
      <div className="mt-1 max-w-md rounded-xl bg-white p-3 shadow-sm ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-700">
        <img src={WELCOME_LOGO} alt="OSINTFront" className="mb-2 size-24 rounded-2xl" />
        <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-800 dark:text-slate-100">{text}</p>
      </div>
      <p className="mt-2 text-[11px] text-emerald-800/80 dark:text-emerald-300/80">הסיסמה מוצגת רק כאן ולא נשמרת בשום מקום. בכניסה הראשונה המשתמש יתבקש לבחור סיסמה חדשה.</p>
    </div>
  );
}
