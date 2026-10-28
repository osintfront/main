import { Link } from 'react-router-dom';
import { Logo } from '@/components/common/Logo';

const TITLES = {
  terms: 'תנאי שימוש',
  refund: 'מדיניות ביטולים והחזרים',
  cancel: 'ביטול מנוי',
} as const;

/** Legal pages — placeholders; the texts will be added later. */
export function LegalPlaceholder({ page }: { page: keyof typeof TITLES }) {
  return (
    <div dir="rtl" className="min-h-dvh bg-slate-50 dark:bg-slate-950">
      <header className="border-b border-slate-200 bg-white px-4 py-2.5 dark:border-slate-800 dark:bg-slate-900"><Logo /></header>
      <main className="mx-auto max-w-2xl px-4 py-10 text-slate-800 dark:text-slate-100">
        <h1 className="text-2xl font-bold">{TITLES[page]}</h1>
        <p className="mt-4 text-slate-500">הטקסט יתווסף בקרוב.</p>
        {page === 'cancel' ? <p className="mt-2 text-slate-500">לביטול מנוי כתבו לנו: <a className="text-sky-600 underline" href="mailto:osintfront@gmail.com">osintfront@gmail.com</a></p> : null}
        <nav className="mt-8 flex flex-wrap gap-4 text-sm text-sky-700 dark:text-sky-400">
          <Link to="/terms">תנאי שימוש</Link><Link to="/privacy">מדיניות פרטיות</Link><Link to="/refund-policy">ביטולים והחזרים</Link><Link to="/cancel-subscription">ביטול מנוי</Link><Link to="/">חזרה לאתר</Link>
        </nav>
      </main>
    </div>
  );
}
