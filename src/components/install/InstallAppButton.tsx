import { useState } from 'react';
import { createPortal } from 'react-dom';
import { Download, PlusSquare, Share, X } from 'lucide-react';
import { promptInstall, useInstallMode } from '@/lib/install';

/** "התקן את האפליקציה": native prompt (Chrome / Edge), steps for iPhone, a note elsewhere. Hidden once installed. */
export function InstallAppButton() {
  const mode = useInstallMode();
  const [open, setOpen] = useState(false);
  if (mode === 'installed') return null;
  const onClick = () => (mode === 'prompt' ? void promptInstall() : setOpen(true));
  return (
    <>
      <button
        type="button"
        onClick={onClick}
        className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg bg-sky-600 px-2.5 text-xs font-semibold text-white hover:bg-sky-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500"
        title="התקן את האפליקציה"
      >
        <Download className="size-4" aria-hidden />
        <span className="hidden sm:inline">התקן את האפליקציה</span>
      </button>
      {open ? createPortal(
        <div role="dialog" aria-modal="true" aria-label="התקנת האפליקציה" dir="rtl" className="fixed inset-0 z-[3000] flex items-end justify-center bg-black/50 p-3 sm:items-center" onClick={() => setOpen(false)}>
          <div className="w-full max-w-sm rounded-2xl bg-white p-5 text-slate-800 shadow-2xl dark:bg-slate-900 dark:text-slate-100" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center gap-3">
              <img src="/icon-192.png" alt="" className="size-10 rounded-xl" />
              <h2 className="flex-1 text-base font-bold">התקנת OSINTFront</h2>
              <button type="button" onClick={() => setOpen(false)} aria-label="סגירה" className="rounded-lg p-1 hover:bg-slate-100 dark:hover:bg-slate-800"><X className="size-5" /></button>
            </div>
            {mode === 'ios' ? (
              <ol className="space-y-3 text-sm">
                <li className="flex items-center gap-3"><span className="grid size-8 place-items-center rounded-lg bg-slate-100 dark:bg-slate-800"><Share className="size-4 text-sky-600" /></span>1. בספארי, לחצו על כפתור השיתוף (בתחתית המסך).</li>
                <li className="flex items-center gap-3"><span className="grid size-8 place-items-center rounded-lg bg-slate-100 dark:bg-slate-800"><PlusSquare className="size-4 text-sky-600" /></span>2. גללו ובחרו "הוספה למסך הבית".</li>
                <li className="flex items-center gap-3"><span className="grid size-8 place-items-center rounded-lg bg-slate-100 text-xs font-bold text-sky-600 dark:bg-slate-800">הוסף</span>3. לחצו "הוסף" בפינה העליונה.</li>
                <li className="text-xs text-slate-500">פתחו את האפליקציה מהאייקון החדש במסך הבית. משם אפשר גם להפעיל התראות.</li>
              </ol>
            ) : (
              <p className="text-sm leading-relaxed">הדפדפן הזה לא מאפשר התקנה ישירה. פתחו את האתר ב-Chrome או ב-Edge (במחשב או באנדרואיד), או בספארי באייפון, ולחצו שוב על "התקן את האפליקציה". אם כבר התקנתם, פתחו את האפליקציה מהאייקון.</p>
            )}
          </div>
        </div>,
        document.body,
      ) : null}
    </>
  );
}
