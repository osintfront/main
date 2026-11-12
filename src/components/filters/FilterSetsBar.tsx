import { useMemo } from 'react';
import { Lock, Plus } from 'lucide-react';
import { useI18n } from '@/i18n';
import { openGate } from '@/components/plans/GateDialog';
import { myPlan, planConfigReady } from '@/lib/plans';
import { MAX_SETS, isLocked, matchesSetFilter, newSet, type FilterSet } from '@/lib/filterSets';
import type { PublicEvent } from '@/types/event';
import { cn } from '@/utils/cn';

interface FilterSetsBarProps {
  sets: FilterSet[];
  setLimit: number;
  /** Everything loaded (before filtering): each chip counts the events its set fits. */
  events: PublicEvent[];
  scope: string | null;
  onScopeChange: (scope: string | null) => void;
  onSetsChange: (next: FilterSet[]) => void;
  /** The EEI (צי"ח) chip: locked = not in the plan (opens the gate); count = theatres on. */
  eei?: { locked: boolean; count: number };
}

const chip =
  'inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-full border px-3 text-[13px] font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-sky-500 sm:min-h-8 sm:text-xs';
const chipOn = 'border-slate-900 bg-slate-900 text-white dark:border-white dark:bg-white dark:text-slate-900';
const chipOff = 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800';

/** The scope row of the filter panel: General · one chip per filter set · Add set. */
export function FilterSetsBar({ sets, setLimit, events, scope, onScopeChange, onSetsChange, eei }: FilterSetsBarProps) {
  const { t } = useI18n();
  const counts = useMemo(() => {
    const now = Date.now();
    return new Map(sets.map((s) => [s.id, events.reduce((n, e) => n + (matchesSetFilter(e, s.filter, now) ? 1 : 0), 0)]));
  }, [sets, events]);

  const full = sets.length >= MAX_SETS;
  const add = () => {
    if (sets.length < setLimit) {
      const s = newSet(sets, t('sets.defaultName', { n: sets.length + 1 }));
      onSetsChange([...sets, s]);
      onScopeChange(s.id);
      return;
    }
    if (full) return;
    openGate(myPlan() === 'guest' ? 'signup' : 'upgrade', 'filter_sets');
  };

  return (
    <div className="ofm-scroll flex shrink-0 items-center gap-1.5 overflow-x-auto border-b border-slate-200 px-4 py-2 dark:border-slate-800">
      <button type="button" data-set-scope="general" aria-pressed={scope === null} onClick={() => onScopeChange(null)} className={cn(chip, scope === null ? chipOn : chipOff)}>
        {t('sets.general')}
      </button>
      {eei ? (
        <button
          type="button"
          data-set-scope="eei"
          data-set-locked={eei.locked && planConfigReady() ? '' : undefined}
          aria-pressed={scope === 'eei'}
          onClick={() => (eei.locked ? openGate(myPlan() === 'guest' ? 'signup' : 'upgrade', 'eei_text') : onScopeChange('eei'))}
          className={cn(chip, scope === 'eei' ? chipOn : chipOff, !eei.count && scope !== 'eei' && 'opacity-70')}
        >
          {eei.locked && planConfigReady() ? <Lock className="size-3.5" aria-hidden /> : null}
          {t('eeiList.chip')}
          {eei.count ? <span className="font-mono text-[11px] tabular-nums opacity-70">{eei.count}</span> : null}
        </button>
      ) : null}
      {sets.map((s) => {
        const locked = isLocked(sets, s.id, setLimit);
        return (
          <button
            key={s.id}
            type="button"
            data-set-scope={s.id}
            data-set-locked={locked ? '' : undefined}
            aria-pressed={scope === s.id}
            onClick={() => onScopeChange(s.id)}
            className={cn(chip, scope === s.id ? chipOn : chipOff, (!s.enabled || locked) && 'opacity-60')}
          >
            {locked ? <Lock className="size-3.5" aria-hidden /> : <span className="size-2.5 shrink-0 rounded-full" style={{ background: s.color }} aria-hidden />}
            <span className="max-w-[9rem] truncate" dir="auto">
              {s.name}
            </span>
            {locked ? null : <span className="font-mono text-[11px] tabular-nums opacity-70">{counts.get(s.id) ?? 0}</span>}
          </button>
        );
      })}
      <button
        type="button"
        data-set-action="add"
        onClick={add}
        disabled={full}
        title={full ? t('sets.max') : undefined}
        className={cn(chip, 'border-dashed border-sky-400 text-sky-700 hover:bg-sky-50 disabled:opacity-50 dark:text-sky-300 dark:hover:bg-sky-500/10')}
      >
        <Plus className="size-3.5" aria-hidden />
        {t('sets.add')}
      </button>
    </div>
  );
}
