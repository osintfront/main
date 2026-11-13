import { useEffect, useState } from 'react';
import { Lock, Octagon, Trash2, X } from 'lucide-react';
import { useI18n } from '@/i18n';
import { MAX_NAME, MAX_POLYGONS, isEmptySet, type FilterSet } from '@/lib/filterSets';
import { cn } from '@/utils/cn';

interface FilterSetHeaderProps {
  set: FilterSet;
  /** The name a blank name falls back to (a free "Set N"). */
  defaultName: string;
  locked: boolean;
  onChange: (next: FilterSet) => void;
  onDelete: () => void;
  onDrawArea: () => void;
}

const smallBtn =
  'inline-flex min-h-9 items-center gap-1.5 rounded-lg px-2.5 text-[13px] font-semibold sm:min-h-8 sm:text-xs disabled:opacity-50';

/** The top of the filter panel while a set is chosen: its name, on/off, delete and drawn areas. */
export function FilterSetHeader({ set, defaultName, locked, onChange, onDelete, onDrawArea }: FilterSetHeaderProps) {
  const { t } = useI18n();
  const [name, setName] = useState(set.name);
  useEffect(() => setName(set.name), [set.id, set.name]);
  const saveName = () => {
    const v = name.trim().slice(0, MAX_NAME) || defaultName;
    setName(v);
    if (v !== set.name) onChange({ ...set, name: v });
  };
  const remove = () => {
    if (window.confirm(t('sets.deleteConfirm'))) onDelete();
  };
  const areas = set.filter.polygons;

  return (
    <section data-set-header={set.id} className="space-y-2 border-b border-slate-100 px-4 py-3 dark:border-slate-800">
      <div className="flex items-center gap-2">
        <span className="size-3 shrink-0 rounded-full" style={{ background: set.color }} aria-hidden />
        <label className="min-w-0 flex-1">
          <span className="sr-only">{t('sets.name')}</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={saveName}
            onKeyDown={(e) => {
              // Enter and Esc keep what was typed; Esc here does not also close the panel (the name would be lost).
              if (e.key !== 'Enter' && e.key !== 'Escape') return;
              if (e.key === 'Escape') e.stopPropagation();
              (e.target as HTMLInputElement).blur();
            }}
            maxLength={MAX_NAME}
            dir="auto"
            disabled={locked}
            className="h-9 w-full rounded-lg border border-slate-200 bg-white px-2 text-base font-semibold text-slate-900 sm:text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-white"
          />
        </label>
        {locked ? null : (
          <button
            type="button"
            role="switch"
            data-set-action="toggle"
            aria-checked={set.enabled}
            aria-label={t('sets.toggle')}
            title={t('sets.toggle')}
            onClick={() => onChange({ ...set, enabled: !set.enabled })}
            className={cn('relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors', set.enabled ? 'bg-sky-600' : 'bg-slate-300 dark:bg-slate-700')}
          >
            <span className={cn('inline-block size-5 rounded-full bg-white shadow transition-transform', set.enabled ? 'translate-x-[22px] rtl:-translate-x-[22px]' : 'translate-x-0.5 rtl:-translate-x-0.5')} />
          </button>
        )}
        <button type="button" data-set-action="delete" onClick={remove} aria-label={t('sets.delete')} title={t('sets.delete')} className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg text-slate-500 hover:bg-red-50 hover:text-red-700 dark:hover:bg-red-500/10">
          <Trash2 className="size-4" aria-hidden />
        </button>
      </div>

      {locked ? (
        <p className="flex items-center gap-1.5 text-xs font-semibold text-slate-600 dark:text-slate-300">
          <Lock className="size-3.5" aria-hidden />
          {t('sets.locked')}
        </p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              data-set-action="draw"
              onClick={onDrawArea}
              disabled={areas.length >= MAX_POLYGONS}
              title={areas.length >= MAX_POLYGONS ? t('sets.maxAreas') : undefined}
              className={cn(smallBtn, 'border border-dashed border-sky-400 text-sky-700 hover:bg-sky-50 dark:text-sky-300 dark:hover:bg-sky-500/10')}
            >
              <Octagon className="size-4" aria-hidden />
              {t('sets.drawArea')}
            </button>
            {areas.map((_, i) => (
              <span key={i} data-set-area={i} className="inline-flex min-h-8 items-center gap-1 rounded-full bg-slate-100 ps-2.5 text-xs font-medium text-slate-700 dark:bg-slate-800 dark:text-slate-200">
                {t('sets.area', { n: i + 1 })}
                <button
                  type="button"
                  data-set-action="remove-area"
                  aria-label={t('sets.removeArea', { n: i + 1 })}
                  onClick={() => onChange({ ...set, filter: { ...set.filter, polygons: areas.filter((__, k) => k !== i) } })}
                  className="inline-flex size-7 items-center justify-center rounded-full hover:bg-slate-200 dark:hover:bg-slate-700"
                >
                  <X className="size-3.5" aria-hidden />
                </button>
              </span>
            ))}
          </div>
          {isEmptySet(set.filter) ? <p className="text-xs text-slate-500 dark:text-slate-400">{t('sets.emptyHint')}</p> : null}
        </>
      )}
    </section>
  );
}
