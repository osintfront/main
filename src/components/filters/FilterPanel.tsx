import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Crosshair, Loader2, Octagon, Plus, X } from 'lucide-react';
import { compileEei, matchesEei, type Eei } from '@/lib/eei';
import { fromEventFilters, isLocked, matchesSetFilter, toEventFilters, type FilterSet } from '@/lib/filterSets';
import { FilterSetsBar } from './FilterSetsBar';
import { FilterSetHeader } from './FilterSetHeader';
import { hasFeature, myPlan } from '@/lib/plans';
import { openGate } from '@/components/plans/GateDialog';
import { useI18n } from '@/i18n';
import { DEFAULT_CATEGORIES, getCategoryIcon } from '@/data/categoryRegistry';
import { SEVERITIES, type PublicEvent, type Severity } from '@/types/event';
import { cn } from '@/utils/cn';
import { countryLabel } from '@/utils/places';
import {
  AREAS,
  COUNTRY_AREA_PREFIX,
  EMPTY_FILTERS,
  TIME_PRESETS,
  activeFilterCount,
  eventAreas,
  sourceKind,
  mediaKinds,
  placeKind,
  matchesFilters,
  type MediaFilter,
  type PlaceKind,
  type EventFilters,
  type SourceKind,
  type TimePreset,
} from '@/lib/eventFilters';

interface FilterPanelProps {
  filters: EventFilters;
  onChange: (next: EventFilters) => void;
  onClose: () => void;
  /** Everything loaded (before filtering) — the per-option counts apply the other filters to it. */
  events: PublicEvent[];
  /** Events left after filtering. */
  resultCount: number;
  /** Start drawing an area on the map. */
  onDrawArea: () => void;
  /** Archive page: the day picker sets the time, so the time section is hidden. */
  hideTime?: boolean;
  loadingArchive?: boolean;
  /** Saved צי"ח (EEI) queries; which are on is in filters.eeis. */
  eeis?: Eei[];
  onAddEei?: (name: string, query: string) => string;
  onRemoveEei?: (id: string) => void;
  /** Filter sets (live map only; absent = today's panel). */
  sets?: FilterSet[];
  setLimit?: number;
  onSetsChange?: (next: FilterSet[]) => void;
  /** null = the general filter, else the id of the set being edited. */
  scope?: string | null;
  onScopeChange?: (scope: string | null) => void;
  onDrawForSet?: (id: string) => void;
  /** At least one set is in force (the general filter is paused). */
  setsInForce?: boolean;
  onSwitchSetsOff?: () => void;
}

const SHOW_EEI = false;
const SOURCES: SourceKind[] = ['telegram', 'whatsapp', 'x', 'facebook', 'instagram', 'tiktok', 'news', 'other'];
const MEDIA: MediaFilter[] = ['none', 'video', 'image', 'document'];

/** "2026-10-21T09:30" for <input type="datetime-local"> from an ISO string (local time). */
function toLocalInput(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

function toggle<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-b border-slate-100 px-4 py-3 last:border-b-0 dark:border-slate-800">
      <h3 className="mb-2 text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">{title}</h3>
      {children}
    </section>
  );
}

function Chip({ on, onClick, children, color }: { on: boolean; onClick: () => void; children: ReactNode; color?: string }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn(
        'inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3 text-[13px] font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-sky-500 sm:min-h-8 sm:text-xs',
        on
          ? 'border-sky-600 bg-sky-600 text-white dark:border-sky-500 dark:bg-sky-500'
          : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800',
      )}
    >
      {color ? <span className="size-2.5 shrink-0 rounded-full ring-1 ring-white/60" style={{ backgroundColor: color }} aria-hidden /> : null}
      {children}
    </button>
  );
}

function Count({ n }: { n: number }) {
  return <span className="font-mono text-[11px] tabular-nums opacity-70">{n}</span>;
}

/**
 * Filters for the map and feed. A dropdown under the top bar on desktop, a
 * bottom sheet on phones. Changes apply at once; "Show N events" just closes.
 */
/** צי"ח: saved keyword queries; an event shows if it matches any query that is on. */
function EeiSection({
  filters,
  set,
  events,
  eeis,
  onAdd,
  onRemove,
}: {
  filters: EventFilters;
  set: (patch: Partial<EventFilters>) => void;
  events: PublicEvent[];
  eeis: Eei[];
  onAdd: (name: string, query: string) => string;
  onRemove: (id: string) => void;
}) {
  const { t } = useI18n();
  const [name, setName] = useState('');
  const [query, setQuery] = useState('');
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const q of eeis) {
      const c = compileEei(q.query);
      m.set(q.id, events.reduce((n, e) => n + (matchesEei(e, c) ? 1 : 0), 0));
    }
    return m;
  }, [eeis, events]);
  const preview = useMemo(() => {
    const c = compileEei(query);
    return c ? events.reduce((n, e) => n + (matchesEei(e, c) ? 1 : 0), 0) : null;
  }, [query, events]);

  const submit = (ev: FormEvent) => {
    ev.preventDefault();
    if (!compileEei(query)) return;
    // Saved keyword queries are part of keyword search (Pro and up).
    if (!hasFeature(undefined, 'feed_search')) return void openGate(myPlan() === 'guest' ? 'signup' : 'upgrade', 'feed_search');
    const id = onAdd(name, query);
    set({ eeis: [...filters.eeis, id] });
    setName('');
    setQuery('');
  };
  const input =
    'h-10 w-full rounded-lg border border-slate-200 bg-white px-2.5 text-base text-slate-900 placeholder:text-slate-400 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/30 sm:h-9 sm:text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-white';

  return (
    <Section title={t('eei.title')}>
      {eeis.length ? (
        <ul className="mb-3 flex flex-wrap gap-1.5">
          {eeis.map((q) => (
            <li key={q.id} className="inline-flex items-center">
              <Chip on={filters.eeis.includes(q.id)} onClick={() => set({ eeis: toggle(filters.eeis, q.id) })}>
                <Crosshair className="size-3.5" aria-hidden />
                <span className="max-w-[16rem] truncate" title={q.query}>
                  {q.name || q.query}
                </span>
                <Count n={counts.get(q.id) ?? 0} />
              </Chip>
              <button
                type="button"
                onClick={() => {
                  onRemove(q.id);
                  if (filters.eeis.includes(q.id)) set({ eeis: filters.eeis.filter((x) => x !== q.id) });
                }}
                aria-label={t('eei.remove', { name: q.name || q.query })}
                className="ms-0.5 inline-flex size-7 items-center justify-center rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
              >
                <X className="size-3.5" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <form onSubmit={submit} className="space-y-2">
        <label className="block">
          <span className="sr-only">{t('eei.query')}</span>
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('eei.queryPlaceholder')} className={input} dir="auto" />
        </label>
        <div className="flex gap-2">
          <label className="min-w-0 flex-1">
            <span className="sr-only">{t('eei.name')}</span>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('eei.namePlaceholder')} className={input} dir="auto" />
          </label>
          <button
            type="submit"
            disabled={!compileEei(query)}
            className="inline-flex h-10 shrink-0 items-center gap-1 rounded-lg bg-sky-600 px-3 text-sm font-semibold text-white hover:bg-sky-500 disabled:opacity-40 sm:h-9"
          >
            <Plus className="size-4" aria-hidden />
            {t('eei.add')}
          </button>
        </div>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          {preview !== null ? <span className="font-semibold text-slate-700 dark:text-slate-200">{t('eei.preview', { count: preview })} · </span> : null}
          {t('eei.hint')}
        </p>
      </form>
    </Section>
  );
}

export function FilterPanel({
  filters,
  onChange,
  onClose,
  events,
  resultCount,
  onDrawArea,
  hideTime = false,
  loadingArchive = false,
  eeis = [],
  onAddEei,
  onRemoveEei,
  sets,
  setLimit = 0,
  onSetsChange,
  scope = null,
  onScopeChange,
  onDrawForSet,
  setsInForce = false,
  onSwitchSetsOff,
}: FilterPanelProps) {
  const { t, lang, categoryLabel } = useI18n();
  // The sections below edit either the general filter or the chosen set (as an EventFilters view).
  const scopeSet = (scope && sets?.find((x) => x.id === scope)) || null;
  const scopeLocked = !!scopeSet && isLocked(sets!, scopeSet.id, setLimit);
  const view: EventFilters = useMemo(() => (scopeSet ? toEventFilters(scopeSet.filter) : filters), [scopeSet, filters]);
  const replaceSet = (next: FilterSet) => onSetsChange?.(sets!.map((x) => (x.id === next.id ? next : x)));
  const apply = (next: EventFilters) => (scopeSet ? replaceSet({ ...scopeSet, filter: fromEventFilters(next, scopeSet.filter.polygons) }) : onChange(next));
  const set = (patch: Partial<EventFilters>) => apply({ ...view, ...patch });
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    panelRef.current?.focus();
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Counts per option: the events that would show if that option were picked, given every other
  // active filter (time window included) — so they add up to what the feed shows.
  const polygons = scopeSet?.filter.polygons;
  const counts = useMemo(() => {
    const now = Date.now();
    const matches = (e: PublicEvent, f: EventFilters) => (polygons ? matchesSetFilter(e, fromEventFilters(f, polygons), now) : matchesFilters(e, f, now));
    const without = (patch: Partial<EventFilters>) => {
      const f = { ...view, ...patch };
      return events.filter((e) => matches(e, f));
    };
    const area = new Map<string, number>();
    const cat = new Map<string, number>();
    const sev = new Map<string, number>();
    const src = new Map<string, number>();
    const place = new Map<string, number>();
    const media = new Map<string, number>();
    const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1);
    for (const e of without({ areas: [] })) eventAreas(e).forEach((a) => bump(area, a));
    for (const e of without({ categories: [] })) bump(cat, e.category.slug);
    for (const e of without({ severities: [] })) bump(sev, e.severity);
    for (const e of without({ sources: [] })) bump(src, sourceKind(e));
    for (const e of without({ placeKinds: [] })) bump(place, placeKind(e));
    for (const e of without({ media: [] })) mediaKinds(e).forEach((m) => bump(media, m));
    return { area, cat, sev, src, place, media };
  }, [events, view, polygons]);

  const categories = useMemo(() => {
    const known = DEFAULT_CATEGORIES.filter((c) => c.slug !== 'other' || counts.cat.has('other'));
    // Categories that appear in the data but not in the built-in list.
    const extra = [...counts.cat.keys()]
      .filter((slug) => !known.some((c) => c.slug === slug))
      .map((slug) => {
        const e = events.find((x) => x.category.slug === slug)!;
        return { slug, name: e.category.name, icon: e.category.icon, color: e.category.markerColor };
      });
    return [...known, ...extra].sort((a, b) => (counts.cat.get(b.slug) ?? 0) - (counts.cat.get(a.slug) ?? 0));
  }, [counts, events]);

  // Known countries/areas, then any other country named on the loaded events (most events first).
  const areas = useMemo(() => {
    const known = AREAS.map((a) => ({ id: a.id, label: lang === 'he' ? a.he : a.en }));
    const extra = [...counts.area.keys()]
      .filter((id) => id.startsWith(COUNTRY_AREA_PREFIX))
      .sort((a, b) => (counts.area.get(b) ?? 0) - (counts.area.get(a) ?? 0))
      .map((id) => ({ id, label: countryLabel(id.slice(COUNTRY_AREA_PREFIX.length), lang) }));
    return [...known, ...extra];
  }, [counts, lang]);

  const active = activeFilterCount(filters) > 0 || setsInForce;

  return (
    <div className="fixed inset-0 z-[2500] lg:absolute lg:inset-auto lg:end-3 lg:top-14" role="presentation">
      {/* Click anywhere outside the panel to close it: dimmed on phones, invisible on desktop. */}
      <div className="fixed inset-0 bg-slate-950/50 lg:bg-transparent" onClick={onClose} aria-hidden />
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="filters-title"
        className="absolute inset-x-0 bottom-0 flex max-h-[88dvh] flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl ring-1 ring-slate-900/10 outline-none lg:relative lg:inset-auto lg:max-h-[min(80vh,720px)] lg:w-[400px] lg:rounded-2xl dark:bg-slate-900 dark:ring-white/10"
      >
        <header className="flex items-center gap-2 border-b border-slate-200 px-4 py-3 dark:border-slate-800">
          <h2 id="filters-title" className="text-sm font-bold text-slate-900 dark:text-white">
            {t('filters.title')}
          </h2>
          {active ? (
            <button
              type="button"
              onClick={() => {
                onChange(EMPTY_FILTERS);
                onSwitchSetsOff?.();
              }}
              className="ms-auto rounded-lg px-2 py-1 text-xs font-semibold text-sky-700 hover:bg-sky-50 dark:text-sky-400 dark:hover:bg-sky-500/10"
            >
              {t('filters.clearAll')}
            </button>
          ) : null}
          <button
            type="button"
            onClick={onClose}
            aria-label={t('common.close')}
            className={cn(
              'inline-flex size-9 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800',
              active ? '' : 'ms-auto',
            )}
          >
            <X className="size-5" aria-hidden />
          </button>
        </header>

        {sets && onSetsChange && onScopeChange ? (
          <FilterSetsBar sets={sets} setLimit={setLimit} events={events} scope={scopeSet ? scopeSet.id : null} onScopeChange={onScopeChange} onSetsChange={onSetsChange} />
        ) : null}

        <div className="ofm-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain">
          {scopeSet ? (
            <FilterSetHeader
              set={scopeSet}
              position={sets!.indexOf(scopeSet) + 1}
              locked={scopeLocked}
              onChange={replaceSet}
              onDelete={() => {
                onSetsChange?.(sets!.filter((x) => x.id !== scopeSet.id));
                onScopeChange?.(null);
              }}
              onDrawArea={() => onDrawForSet?.(scopeSet.id)}
            />
          ) : setsInForce ? (
            <div data-sets-paused className="flex items-center gap-2 border-b border-amber-200 bg-amber-50 px-4 py-2.5 text-xs text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
              <p className="min-w-0 flex-1">{t('sets.paused')}</p>
              <button type="button" data-set-action="switch-off" onClick={onSwitchSetsOff} className="shrink-0 rounded-lg px-2 py-1 font-semibold underline-offset-2 hover:underline">
                {t('sets.switchOff')}
              </button>
            </div>
          ) : null}
          {scopeLocked ? null : (
            <>
          {/* צי"ח (EEI) is switched off for now; the section is kept for later. */}
          {SHOW_EEI && onAddEei && onRemoveEei ? (
            <EeiSection filters={filters} set={set} events={events} eeis={eeis} onAdd={onAddEei} onRemove={onRemoveEei} />
          ) : null}
          {scopeSet ? null : (
          <Section title={t('filters.drawTitle')}>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={onDrawArea}
                className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-dashed border-sky-400 px-3 text-[13px] font-semibold text-sky-700 hover:bg-sky-50 sm:min-h-8 sm:text-xs dark:text-sky-300 dark:hover:bg-sky-500/10"
              >
                <Octagon className="size-4" aria-hidden />
                {filters.polygon ? t('filters.redrawArea') : t('filters.drawArea')}
              </button>
              {filters.polygon ? (
                <button
                  type="button"
                  onClick={() => set({ polygon: null })}
                  className="inline-flex min-h-9 items-center gap-1 rounded-lg px-2 text-[13px] font-medium text-slate-600 hover:bg-slate-100 sm:min-h-8 sm:text-xs dark:text-slate-300 dark:hover:bg-slate-800"
                >
                  <X className="size-3.5" aria-hidden />
                  {t('filters.clearArea')}
                </button>
              ) : null}
            </div>
          </Section>
          )}
          {hideTime ? null : (
            <Section title={t('filters.time')}>
              <div className="flex flex-wrap gap-1.5">
                {TIME_PRESETS.map((p) => (
                  <Chip key={p.id} on={view.preset === p.id} onClick={() => set({ preset: p.id as TimePreset })}>
                    {t(`filters.preset.${p.id}`)}
                  </Chip>
                ))}
              </div>
              {view.preset === 'custom' ? (
                <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {(['from', 'to'] as const).map((k) => (
                    <label key={k} className="block text-xs font-medium text-slate-600 dark:text-slate-300">
                      {t(`filters.${k}`)}
                      <input
                        type="datetime-local"
                        value={toLocalInput(view[k])}
                        max={toLocalInput(new Date().toISOString())}
                        onChange={(e) => {
                          const v = e.target.value ? new Date(e.target.value).toISOString() : '';
                          set(k === 'from' ? { from: v } : { to: v });
                        }}
                        className="mt-1 h-10 w-full rounded-lg border border-slate-200 bg-white px-2 text-base text-slate-900 sm:h-9 sm:text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-white dark:[color-scheme:dark]"
                      />
                    </label>
                  ))}
                </div>
              ) : null}
              {loadingArchive ? (
                <p className="mt-2 flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
                  <Loader2 className="size-3.5 animate-spin" aria-hidden />
                  {t('filters.loadingArchive')}
                </p>
              ) : null}
            </Section>
          )}

          <Section title={t('filters.areas')}>
            <div className="flex flex-wrap gap-1.5">
              {areas.map((a) => (
                <Chip key={a.id} on={view.areas.includes(a.id)} onClick={() => set({ areas: toggle(view.areas, a.id) })}>
                  {a.label}
                  <Count n={counts.area.get(a.id) ?? 0} />
                </Chip>
              ))}
            </div>
          </Section>

          <Section title={t('filters.types')}>
            <div className="flex flex-wrap gap-1.5">
              {categories.map((c) => {
                const Icon = getCategoryIcon(c.icon);
                return (
                  <Chip
                    key={c.slug}
                    on={view.categories.includes(c.slug)}
                    onClick={() => set({ categories: toggle(view.categories, c.slug) })}
                  >
                    <span className="inline-flex size-5 items-center justify-center rounded-full text-white" style={{ backgroundColor: c.color }} aria-hidden>
                      <Icon className="size-3" />
                    </span>
                    {categoryLabel(c.slug, c.name)}
                    <Count n={counts.cat.get(c.slug) ?? 0} />
                  </Chip>
                );
              })}
            </div>
          </Section>

          <Section title={t('filters.severity')}>
            <div className="flex flex-wrap gap-1.5">
              {SEVERITIES.map((s: Severity) => (
                <Chip key={s} on={view.severities.includes(s)} onClick={() => set({ severities: toggle(view.severities, s) })}>
                  {t(`severity.${s}`)}
                  <Count n={counts.sev.get(s) ?? 0} />
                </Chip>
              ))}
            </div>
          </Section>

          <Section title={t('filters.source')}>
            <div className="flex flex-wrap gap-1.5">
              {SOURCES.map((s) => (
                <Chip key={s} on={view.sources.includes(s)} onClick={() => set({ sources: toggle(view.sources, s) })}>
                  {t(`filters.source.${s}`)}
                  <Count n={counts.src.get(s) ?? 0} />
                </Chip>
              ))}
            </div>
          </Section>

          <Section title={t('filters.media')}>
            <div className="flex flex-wrap gap-1.5">
              {MEDIA.map((m) => (
                <Chip key={m} on={view.media.includes(m)} onClick={() => set({ media: toggle(view.media, m) })}>
                  {t(`filters.media.${m}`)}
                  <Count n={counts.media.get(m) ?? 0} />
                </Chip>
              ))}
            </div>
          </Section>

          <Section title={t('filters.location')}>
            <div className="flex flex-wrap gap-1.5">
              {(['place', 'country', 'none'] as PlaceKind[]).map((k) => (
                <Chip key={k} on={view.placeKinds.includes(k)} onClick={() => set({ placeKinds: toggle(view.placeKinds, k) })}>
                  {t(`filters.location.${k}`)}
                  <Count n={counts.place.get(k) ?? 0} />
                </Chip>
              ))}
            </div>
            <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">{t('filters.location.hint')}</p>
          </Section>

          <Section title={t('filters.more')}>
            <div className="flex flex-wrap gap-1.5">
              <Chip on={view.breakingOnly} onClick={() => set({ breakingOnly: !view.breakingOnly })}>
                {t('filters.breakingOnly')}
              </Chip>
              <Chip on={view.verifiedOnly} onClick={() => set({ verifiedOnly: !view.verifiedOnly })}>
                {t('filters.verifiedOnly')}
              </Chip>
            </div>
          </Section>
            </>
          )}
        </div>

        <footer className="border-t border-slate-200 px-4 py-3 pb-[max(env(safe-area-inset-bottom),12px)] dark:border-slate-800">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-11 w-full items-center justify-center rounded-xl bg-slate-900 text-sm font-semibold text-white hover:bg-slate-700 lg:h-10 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-200"
          >
            {t('filters.show', { count: resultCount })}
          </button>
        </footer>
      </div>
    </div>
  );
}
