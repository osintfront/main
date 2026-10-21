import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import { Loader2, Octagon, X } from 'lucide-react';
import { useI18n } from '@/i18n';
import { DEFAULT_CATEGORIES, getCategoryIcon } from '@/data/categoryRegistry';
import { SEVERITIES, type PublicEvent, type Severity } from '@/types/event';
import { cn } from '@/utils/cn';
import {
  AREAS,
  EMPTY_FILTERS,
  TIME_PRESETS,
  activeFilterCount,
  eventAreas,
  sourceKind,
  placeKind,
  type PlaceKind,
  type EventFilters,
  type SourceKind,
  type TimePreset,
} from '@/lib/eventFilters';

interface FilterPanelProps {
  filters: EventFilters;
  onChange: (next: EventFilters) => void;
  onClose: () => void;
  /** Everything loaded (before filtering) — used for the per-option counts. */
  events: PublicEvent[];
  /** Events left after filtering. */
  resultCount: number;
  /** Start drawing an area on the map. */
  onDrawArea: () => void;
  /** Archive page: the day picker sets the time, so the time section is hidden. */
  hideTime?: boolean;
  loadingArchive?: boolean;
}

const SOURCES: SourceKind[] = ['whatsapp', 'telegram', 'news', 'other'];

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
export function FilterPanel({ filters, onChange, onClose, events, resultCount, onDrawArea, hideTime = false, loadingArchive = false }: FilterPanelProps) {
  const { t, lang, categoryLabel } = useI18n();
  const set = (patch: Partial<EventFilters>) => onChange({ ...filters, ...patch });
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    panelRef.current?.focus();
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Counts per option over everything loaded.
  const counts = useMemo(() => {
    const area = new Map<string, number>();
    const cat = new Map<string, number>();
    const sev = new Map<string, number>();
    const src = new Map<string, number>();
    const place = new Map<string, number>();
    const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1);
    for (const e of events) {
      eventAreas(e).forEach((a) => bump(area, a));
      bump(cat, e.category.slug);
      bump(sev, e.severity);
      bump(src, sourceKind(e));
      bump(place, placeKind(e));
    }
    return { area, cat, sev, src, place };
  }, [events]);

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

  const active = activeFilterCount(filters);

  return (
    <div className="fixed inset-0 z-[2500] lg:absolute lg:inset-auto lg:end-3 lg:top-14" role="presentation">
      <div className="absolute inset-0 bg-slate-950/50 lg:hidden" onClick={onClose} aria-hidden />
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
              onClick={() => onChange(EMPTY_FILTERS)}
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

        <div className="ofm-scroll min-h-0 flex-1 overflow-y-auto">
          {hideTime ? null : (
            <Section title={t('filters.time')}>
              <div className="flex flex-wrap gap-1.5">
                {TIME_PRESETS.map((p) => (
                  <Chip key={p.id} on={filters.preset === p.id} onClick={() => set({ preset: p.id as TimePreset })}>
                    {t(`filters.preset.${p.id}`)}
                  </Chip>
                ))}
              </div>
              {filters.preset === 'custom' ? (
                <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {(['from', 'to'] as const).map((k) => (
                    <label key={k} className="block text-xs font-medium text-slate-600 dark:text-slate-300">
                      {t(`filters.${k}`)}
                      <input
                        type="datetime-local"
                        value={toLocalInput(filters[k])}
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
              {AREAS.map((a) => (
                <Chip key={a.id} on={filters.areas.includes(a.id)} onClick={() => set({ areas: toggle(filters.areas, a.id) })}>
                  {lang === 'he' ? a.he : a.en}
                  <Count n={counts.area.get(a.id) ?? 0} />
                </Chip>
              ))}
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
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

          <Section title={t('filters.types')}>
            <div className="flex flex-wrap gap-1.5">
              {categories.map((c) => {
                const Icon = getCategoryIcon(c.icon);
                return (
                  <Chip
                    key={c.slug}
                    on={filters.categories.includes(c.slug)}
                    onClick={() => set({ categories: toggle(filters.categories, c.slug) })}
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
                <Chip key={s} on={filters.severities.includes(s)} onClick={() => set({ severities: toggle(filters.severities, s) })}>
                  {t(`severity.${s}`)}
                  <Count n={counts.sev.get(s) ?? 0} />
                </Chip>
              ))}
            </div>
          </Section>

          <Section title={t('filters.source')}>
            <div className="flex flex-wrap gap-1.5">
              {SOURCES.map((s) => (
                <Chip key={s} on={filters.sources.includes(s)} onClick={() => set({ sources: toggle(filters.sources, s) })}>
                  {t(`filters.source.${s}`)}
                  <Count n={counts.src.get(s) ?? 0} />
                </Chip>
              ))}
            </div>
          </Section>

          <Section title={t('filters.location')}>
            <div className="flex flex-wrap gap-1.5">
              {(['place', 'country', 'none'] as PlaceKind[]).map((k) => (
                <Chip key={k} on={filters.placeKinds.includes(k)} onClick={() => set({ placeKinds: toggle(filters.placeKinds, k) })}>
                  {t(`filters.location.${k}`)}
                  <Count n={counts.place.get(k) ?? 0} />
                </Chip>
              ))}
            </div>
            <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">{t('filters.location.hint')}</p>
          </Section>

          <Section title={t('filters.more')}>
            <div className="flex flex-wrap gap-1.5">
              <Chip on={filters.breakingOnly} onClick={() => set({ breakingOnly: !filters.breakingOnly })}>
                {t('filters.breakingOnly')}
              </Chip>
              <Chip on={filters.verifiedOnly} onClick={() => set({ verifiedOnly: !filters.verifiedOnly })}>
                {t('filters.verifiedOnly')}
              </Chip>
            </div>
          </Section>
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
