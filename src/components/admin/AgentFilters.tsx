import type { ReactNode } from 'react';
import { Search, X } from 'lucide-react';
import { useI18n, type TranslationKey } from '@/i18n';

/** Filters of the News agents page (news sites and Telegram channels). */
export interface AgentFilterState {
  q: string;
  kind: 'all' | 'web' | 'telegram';
  status: 'all' | 'active' | 'inactive' | 'error';
  region: string; // 'all' | region / agent key
  events: 'all' | 'with' | 'none';
  pinned: 'all' | 'pinned' | 'unpinned';
  sort: 'name' | 'events' | 'recent';
}

export const DEFAULT_AGENT_FILTERS: AgentFilterState = { q: '', kind: 'all', status: 'all', region: 'all', events: 'all', pinned: 'all', sort: 'name' };

export const FILTER_REGIONS = ['israel', 'palestine', 'lebanon', 'syria', 'iraq', 'iran', 'yemen', 'jordan', 'egypt', 'gulf', 'regional', 'international', 'research', 'unknown'];

export function regionLabelKey(region: string): TranslationKey {
  return (region === 'research' ? 'agents.agent.research' : `telegram.region.${region}`) as TranslationKey;
}

export const filtersActive = (f: AgentFilterState) =>
  f.q.trim() !== '' || f.status !== 'all' || f.region !== 'all' || f.events !== 'all' || f.pinned !== 'all';

/** One row of either kind, as the filters see it. */
export interface FilterRow {
  text: string; // name, address / username
  active: boolean;
  error: boolean;
  region: string;
  events: number;
  pinned?: boolean; // Telegram only
  lastAt: string | null;
}

export function applyAgentFilters<T>(rows: T[], f: AgentFilterState, view: (r: T) => FilterRow): T[] {
  const q = f.q.trim().toLowerCase();
  const out = rows.filter((r) => {
    const v = view(r);
    if (q && !v.text.toLowerCase().includes(q)) return false;
    if (f.status === 'active' && !v.active) return false;
    if (f.status === 'inactive' && v.active) return false;
    if (f.status === 'error' && !(v.active && v.error)) return false;
    if (f.region !== 'all' && v.region !== f.region) return false;
    if (f.events === 'with' && v.events <= 0) return false;
    if (f.events === 'none' && v.events > 0) return false;
    if (f.pinned !== 'all' && v.pinned !== undefined && v.pinned !== (f.pinned === 'pinned')) return false;
    return true;
  });
  if (f.sort === 'events') out.sort((a, b) => view(b).events - view(a).events);
  else if (f.sort === 'recent') out.sort((a, b) => (view(b).lastAt ?? '').localeCompare(view(a).lastAt ?? ''));
  return out;
}

const selectCls =
  'h-9 rounded-lg border-0 bg-white px-2.5 text-sm text-slate-800 ring-1 ring-inset ring-slate-300 focus:ring-2 focus:ring-sky-500 dark:bg-slate-800 dark:text-slate-100 dark:ring-slate-700';

export function AgentFilterBar({ value, onChange, counts }: { value: AgentFilterState; onChange: (v: AgentFilterState) => void; counts: { web: number; telegram: number } }) {
  const { t } = useI18n();
  const set = <K extends keyof AgentFilterState>(k: K, v: AgentFilterState[K]) => onChange({ ...value, [k]: v });
  const field = (label: string, el: ReactNode) => (
    <label className="flex flex-col gap-1 text-xs font-medium text-slate-600 dark:text-slate-300">
      {label}
      {el}
    </label>
  );
  return (
    <section className="mb-5 rounded-xl bg-white p-3 ring-1 ring-slate-900/5 dark:bg-slate-900 dark:ring-white/10">
      <div className="flex flex-wrap items-end gap-2">
        {field(
          t('agentsFilter.search'),
          <span className="relative">
            <Search className="pointer-events-none absolute start-2.5 top-1/2 size-3.5 -translate-y-1/2 text-slate-400" aria-hidden />
            <input
              value={value.q}
              onChange={(e) => set('q', e.target.value)}
              placeholder={t('agentsFilter.searchPlaceholder')}
              dir="auto"
              className={`${selectCls} w-48 ps-8`}
            />
          </span>,
        )}
        {field(
          t('agentsFilter.kind'),
          <select className={selectCls} value={value.kind} onChange={(e) => set('kind', e.target.value as AgentFilterState['kind'])}>
            <option value="all">{t('agentsFilter.all')}</option>
            <option value="web">{t('agentsFilter.kindWeb', { count: counts.web })}</option>
            <option value="telegram">{t('agentsFilter.kindTelegram', { count: counts.telegram })}</option>
          </select>,
        )}
        {field(
          t('agentsFilter.status'),
          <select className={selectCls} value={value.status} onChange={(e) => set('status', e.target.value as AgentFilterState['status'])}>
            <option value="all">{t('agentsFilter.all')}</option>
            <option value="active">{t('agentsFilter.active')}</option>
            <option value="inactive">{t('agentsFilter.inactive')}</option>
            <option value="error">{t('agentsFilter.error')}</option>
          </select>,
        )}
        {field(
          t('agentsFilter.region'),
          <select className={selectCls} value={value.region} onChange={(e) => set('region', e.target.value)}>
            <option value="all">{t('agentsFilter.all')}</option>
            {FILTER_REGIONS.map((r) => (
              <option key={r} value={r}>
                {t(regionLabelKey(r))}
              </option>
            ))}
          </select>,
        )}
        {field(
          t('agentsFilter.events'),
          <select className={selectCls} value={value.events} onChange={(e) => set('events', e.target.value as AgentFilterState['events'])}>
            <option value="all">{t('agentsFilter.all')}</option>
            <option value="with">{t('agentsFilter.withEvents')}</option>
            <option value="none">{t('agentsFilter.noEvents')}</option>
          </select>,
        )}
        {value.kind !== 'web'
          ? field(
              t('agentsFilter.pinned'),
              <select className={selectCls} value={value.pinned} onChange={(e) => set('pinned', e.target.value as AgentFilterState['pinned'])}>
                <option value="all">{t('agentsFilter.all')}</option>
                <option value="pinned">{t('agentsFilter.pinnedOnly')}</option>
                <option value="unpinned">{t('agentsFilter.unpinned')}</option>
              </select>,
            )
          : null}
        {field(
          t('agentsFilter.sort'),
          <select className={selectCls} value={value.sort} onChange={(e) => set('sort', e.target.value as AgentFilterState['sort'])}>
            <option value="name">{t('agentsFilter.sortName')}</option>
            <option value="events">{t('agentsFilter.sortEvents')}</option>
            <option value="recent">{t('agentsFilter.sortRecent')}</option>
          </select>,
        )}
        {filtersActive(value) || value.kind !== 'all' || value.sort !== 'name' ? (
          <button
            type="button"
            onClick={() => onChange(DEFAULT_AGENT_FILTERS)}
            className="inline-flex h-9 items-center gap-1 rounded-lg px-2.5 text-sm font-medium text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            <X className="size-3.5" aria-hidden />
            {t('agentsFilter.clear')}
          </button>
        ) : null}
      </div>
    </section>
  );
}
