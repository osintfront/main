// A collapsible group in the Intelligence panel (Weather, Airfields & ports, Military bases):
// a header that opens and closes like a dropdown, so the panel reads like the Satellite / Ships /
// Aircraft sections. Starts open when one of its layers is already on.
import { useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';

export function LayerSection({ id, icon, title, active, locked, children, last = false }: {
  /** data-layer-section on the header (tests open the section through it). */
  id: string;
  icon: ReactNode;
  title: string;
  /** How many of the group's layers are on (shown in the header; > 0 opens it at first). */
  active: number;
  /** The user's plan lacks the group: a lock in the header. */
  locked?: boolean;
  children: ReactNode;
  last?: boolean;
}) {
  const [open, setOpen] = useState(active > 0);
  return (
    <section className={`space-y-2 py-3${last ? '' : ' border-b border-slate-100 dark:border-slate-800'}`}>
      <button type="button" data-layer-section={id} aria-expanded={open} onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 text-start text-sm font-semibold text-slate-800 dark:text-slate-100">
        {icon}
        <span className="flex-1">{title}{locked ? ' 🔒' : ''}</span>
        {active > 0 ? <span className="rounded-full bg-sky-100 px-1.5 text-[11px] font-semibold text-sky-700 dark:bg-sky-900/40 dark:text-sky-300">{active}</span> : null}
        <ChevronDown className={`size-4 text-slate-400 transition-transform${open ? ' rotate-180' : ''}`} aria-hidden />
      </button>
      {open ? <div className="space-y-1.5 ps-6">{children}</div> : null}
    </section>
  );
}
