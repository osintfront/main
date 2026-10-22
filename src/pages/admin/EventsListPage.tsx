import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Archive, BadgeCheck, CheckCircle2, ChevronLeft, ChevronRight, Copy, FilePlus2, Inbox, MapPin, Pencil, RefreshCw, Search, SlidersHorizontal, Trash2, X, Zap } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { usePermissions } from '@/hooks/usePermissions';
import { useI18n } from '@/i18n';
import { availableActions, canEditEvent, validateEvent } from '@/lib/eventWorkflow';
import { fetchCategories } from '@/services/categoryService';
import {
  duplicateEvent,
  eventToInput,
  listEvents,
  moveEventPin,
  PAGE_SIZE,
  setEventCategory,
  softDeleteEvent,
  updateEvent,
  type EventFilters,
} from '@/services/eventAdminService';
import { friendlyError } from '@/services/serviceError';
import type { EventCategory } from '@/types/category';
import { EVENT_STATUSES, SEVERITIES, type AdminEvent } from '@/types/event';
import { formatDateTime } from '@/utils/time';
import { cn } from '@/utils/cn';
import { CategoryBadge, SeverityBadge, StatusBadge } from '@/components/common/Badges';
import { Alert } from '@/components/common/Feedback';
import { Button } from '@/components/common/Form';
import { IconButton } from '@/components/common/IconButton';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { useToast } from '@/components/common/Toast';
import { QuickLocationDialog } from '@/components/admin/events/QuickLocationDialog';

const SELECT =
  'h-9 rounded-lg border border-slate-300 bg-white px-2.5 text-sm text-slate-900 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/30 dark:border-slate-700 dark:bg-slate-900 dark:text-white';

const EMPTY_FILTERS: EventFilters = { search: '', status: 'all', categoryId: '', severity: '', country: '', verified: '', breaking: '', from: '', to: '', mine: false };

export function EventsListPage() {
  const { t, locale, categoryLabel } = useI18n();
  const { user } = useAuth();
  const { can } = usePermissions();
  const toast = useToast();
  const navigate = useNavigate();

  const [params] = useSearchParams();
  const [categories, setCategories] = useState<EventCategory[]>([]);
  const [filters, setFilters] = useState<EventFilters>(() => {
    const s = params.get('status');
    return { ...EMPTY_FILTERS, status: (EVENT_STATUSES as readonly string[]).includes(s ?? '') ? (s as EventFilters['status']) : 'all' };
  });
  const [searchDraft, setSearchDraft] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [page, setPage] = useState(0);
  const [rows, setRows] = useState<AdminEvent[]>([]);
  const [total, setTotal] = useState(0);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ kind: 'delete' | 'archive'; event: AdminEvent } | null>(null);
  // Several rows at once: approve (publish) or delete.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulk, setBulk] = useState<'publish' | 'delete' | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [locating, setLocating] = useState<AdminEvent | null>(null);
  const [locBusy, setLocBusy] = useState(false);

  const who = useMemo(() => ({ can, userId: user?.id ?? null }), [can, user?.id]);
  const categoryById = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);

  useEffect(() => {
    fetchCategories().then(setCategories).catch(() => setCategories([]));
  }, []);

  const load = useCallback(async () => {
    setStatus('loading');
    try {
      const res = await listEvents({ ...filters, userId: user?.id ?? null }, page);
      setRows(res.events);
      setTotal(res.total);
      setSelected((prev) => new Set([...prev].filter((id) => res.events.some((e) => e.id === id))));
      setStatus('ready');
      setError(null);
    } catch (err) {
      setError(friendlyError(err, t));
      setStatus('error');
    }
  }, [filters, page, user?.id, t]);

  useEffect(() => {
    void load();
  }, [load]);

  // Debounced text search.
  useEffect(() => {
    const id = window.setTimeout(() => {
      setFilters((f) => (f.search === searchDraft ? f : { ...f, search: searchDraft }));
      setPage(0);
    }, 350);
    return () => window.clearTimeout(id);
  }, [searchDraft]);

  const setFilter = <K extends keyof EventFilters>(key: K, value: EventFilters[K]) => {
    setFilters((f) => ({ ...f, [key]: value }));
    setPage(0);
  };

  const activeFilterCount = (['categoryId', 'severity', 'country', 'verified', 'breaking', 'from', 'to'] as const).filter((k) => !!filters[k]).length + (filters.mine ? 1 : 0);

  const act = async (event: AdminEvent, kind: 'publish' | 'archive' | 'duplicate' | 'delete') => {
    if (busyId) return;
    if (kind === 'publish') {
      const v = validateEvent(eventToInput(event), 'published');
      if (Object.values(v).some(Boolean)) {
        toast.error(t('list.publishIncomplete'));
        navigate(`/admin/events/${event.id}`);
        return;
      }
    }
    setBusyId(event.id);
    try {
      if (kind === 'publish') {
        await updateEvent(event.id, null, { expectedStatus: event.status, status: 'published' });
        toast.success(t('form.toastPublished'));
      } else if (kind === 'archive') {
        await updateEvent(event.id, null, { expectedStatus: event.status, status: 'archived' });
        toast.success(t('form.toastArchived'));
      } else if (kind === 'duplicate') {
        const copy = await duplicateEvent(event);
        toast.success(t('list.duplicated'));
        navigate(`/admin/events/${copy.id}`);
        return;
      } else {
        await softDeleteEvent(event.id);
        toast.success(t('form.toastDeleted'));
      }
      await load();
    } catch (err) {
      toast.error(friendlyError(err, t));
    } finally {
      setBusyId(null);
      setConfirm(null);
    }
  };

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const toggleRow = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(rows.map((r) => r.id)));
  const selectedRows = rows.filter((r) => selected.has(r.id));
  const publishable = selectedRows.filter((r) => availableActions(r, who).includes('publish'));
  const deletable = can('event.delete') ? selectedRows.filter((r) => !r.deletedAt) : [];

  const runBulk = async (kind: 'publish' | 'delete') => {
    setBulkBusy(true);
    let ok = 0;
    let failed = 0;
    for (const ev of kind === 'publish' ? publishable : deletable) {
      try {
        if (kind === 'publish') {
          const v = validateEvent(eventToInput(ev), 'published');
          if (Object.values(v).some(Boolean)) {
            failed++;
            continue;
          }
          await updateEvent(ev.id, null, { expectedStatus: ev.status, status: 'published' });
        } else {
          await softDeleteEvent(ev.id);
        }
        ok++;
      } catch {
        failed++;
      }
    }
    setBulkBusy(false);
    setBulk(null);
    setSelected(new Set());
    if (ok) toast.success(t(kind === 'publish' ? 'list.bulkPublished' : 'list.bulkDeleted', { count: ok }));
    if (failed) toast.error(t('list.bulkFailed', { count: failed }));
    await load();
  };

  const changeCategory = async (ev: AdminEvent, categoryId: string) => {
    const cat = categoryById.get(categoryId);
    if (!cat || categoryId === ev.categoryId) return;
    setBusyId(ev.id);
    try {
      await setEventCategory(ev.id, cat.slug);
      setRows((list) => list.map((r) => (r.id === ev.id ? { ...r, categoryId } : r)));
      toast.success(t('list.categoryChanged'));
    } catch (err) {
      toast.error(friendlyError(err, t));
    } finally {
      setBusyId(null);
    }
  };

  const saveLocation = async (lat: number, lng: number, name: string) => {
    if (!locating) return;
    setLocBusy(true);
    try {
      await moveEventPin(locating.id, lat, lng, name);
      toast.success(t('move.saved'));
      setLocating(null);
      await load();
    } catch (err) {
      toast.error(friendlyError(err, t));
    } finally {
      setLocBusy(false);
    }
  };
  const canMovePins = can('event.edit.any') || can('event.edit.own');

  return (
    <div className="mx-auto max-w-7xl">
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">{t('list.title')}</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400" aria-live="polite">
            {status === 'ready' ? t('list.count', { count: total }) : ' '}
          </p>
        </div>
        {can('event.create') ? (
          <Link
            to="/admin/events/new"
            className="inline-flex h-10 items-center gap-2 rounded-lg bg-sky-600 px-4 text-sm font-semibold text-white shadow-sm hover:bg-sky-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500"
          >
            <FilePlus2 className="size-4" aria-hidden />
            {t('admin.nav.newEvent')}
          </Link>
        ) : null}
      </div>

      {/* Filters */}
      <div className="mb-4 rounded-2xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[12rem] flex-1">
            <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" aria-hidden />
            <input
              type="search"
              value={searchDraft}
              onChange={(e) => setSearchDraft(e.target.value)}
              placeholder={t('list.searchPlaceholder')}
              aria-label={t('list.searchPlaceholder')}
              maxLength={120}
              className="h-9 w-full rounded-lg border border-slate-300 bg-white ps-9 pe-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/30 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
            />
          </div>
          <select aria-label={t('list.status')} className={SELECT} value={filters.status} onChange={(e) => setFilter('status', e.target.value as EventFilters['status'])}>
            <option value="all">{t('list.allStatuses')}</option>
            {EVENT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(`status.${s}`)}
              </option>
            ))}
            {can('event.delete') ? <option value="deleted">{t('list.deleted')}</option> : null}
          </select>
          <Button variant="secondary" size="sm" className="h-9" onClick={() => setShowFilters((v) => !v)} aria-expanded={showFilters}>
            <SlidersHorizontal className="size-4" aria-hidden />
            {t('list.moreFilters')}
            {activeFilterCount ? (
              <span className="rounded-full bg-sky-600 px-1.5 text-[10px] font-bold text-white">{activeFilterCount}</span>
            ) : null}
          </Button>
          <IconButton label={t('feed.retry')} onClick={() => void load()} tooltipSide="bottom-end">
            <RefreshCw className={cn('size-4', status === 'loading' && 'animate-spin')} aria-hidden />
          </IconButton>
        </div>

        {showFilters ? (
          <div className="mt-3 grid gap-2 border-t border-slate-100 pt-3 sm:grid-cols-2 lg:grid-cols-4 dark:border-slate-800">
            <select aria-label={t('form.category')} className={SELECT} value={filters.categoryId} onChange={(e) => setFilter('categoryId', e.target.value)}>
              <option value="">{t('list.allCategories')}</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {categoryLabel(c.slug, c.name)}
                </option>
              ))}
            </select>
            <select aria-label={t('form.severity')} className={SELECT} value={filters.severity} onChange={(e) => setFilter('severity', e.target.value as EventFilters['severity'])}>
              <option value="">{t('list.allSeverities')}</option>
              {SEVERITIES.map((s) => (
                <option key={s} value={s}>
                  {t(`severity.${s}`)}
                </option>
              ))}
            </select>
            <select aria-label={t('form.verified')} className={SELECT} value={filters.verified} onChange={(e) => setFilter('verified', e.target.value as EventFilters['verified'])}>
              <option value="">{t('list.anyVerification')}</option>
              <option value="yes">{t('feed.verified')}</option>
              <option value="no">{t('feed.unverified')}</option>
            </select>
            <select aria-label={t('form.breaking')} className={SELECT} value={filters.breaking} onChange={(e) => setFilter('breaking', e.target.value as EventFilters['breaking'])}>
              <option value="">{t('list.anyBreaking')}</option>
              <option value="yes">{t('list.breakingOnly')}</option>
              <option value="no">{t('list.notBreaking')}</option>
            </select>
            <input aria-label={t('form.country')} placeholder={t('form.country')} className={SELECT} value={filters.country} maxLength={100} onChange={(e) => setFilter('country', e.target.value)} />
            <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
              <span className="shrink-0">{t('list.from')}</span>
              <input type="date" dir="ltr" className={cn(SELECT, 'min-w-0 flex-1')} value={filters.from} onChange={(e) => setFilter('from', e.target.value)} />
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
              <span className="shrink-0">{t('list.to')}</span>
              <input type="date" dir="ltr" className={cn(SELECT, 'min-w-0 flex-1')} value={filters.to} onChange={(e) => setFilter('to', e.target.value)} />
            </label>
            <div className="flex items-center justify-between gap-2">
              <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
                <input type="checkbox" className="size-4 accent-sky-600" checked={!!filters.mine} onChange={(e) => setFilter('mine', e.target.checked)} />
                {t('list.mine')}
              </label>
              <button
                type="button"
                className="text-sm font-medium text-sky-700 hover:underline dark:text-sky-400"
                onClick={() => {
                  setFilters({ ...EMPTY_FILTERS, search: filters.search, status: filters.status });
                  setPage(0);
                }}
              >
                {t('list.clearFilters')}
              </button>
            </div>
          </div>
        ) : null}
      </div>

      {status === 'error' ? (
        <Alert tone="error" className="mb-4">
          {error}
        </Alert>
      ) : null}

      {selected.size ? (
        <div className="sticky top-0 z-20 mb-3 flex flex-wrap items-center gap-2 rounded-xl bg-slate-900 px-3 py-2 text-sm text-white shadow-lg dark:bg-slate-800">
          <span className="font-semibold">{t('list.selected', { count: selected.size })}</span>
          {publishable.length ? (
            <button
              type="button"
              onClick={() => setBulk('publish')}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-emerald-600 px-3 font-semibold hover:bg-emerald-500"
            >
              <CheckCircle2 className="size-4" aria-hidden />
              {t('list.bulkPublish', { count: publishable.length })}
            </button>
          ) : null}
          {deletable.length ? (
            <button
              type="button"
              onClick={() => setBulk('delete')}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-red-600 px-3 font-semibold hover:bg-red-500"
            >
              <Trash2 className="size-4" aria-hidden />
              {t('list.bulkDelete', { count: deletable.length })}
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => setSelected(new Set())}
            className="ms-auto inline-flex h-8 items-center gap-1 rounded-lg px-2 font-medium hover:bg-white/10"
          >
            <X className="size-4" aria-hidden />
            {t('list.clearSelection')}
          </button>
        </div>
      ) : null}

      {/* Table (desktop) / cards (mobile) */}
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        {status === 'loading' && rows.length === 0 ? (
          <div className="space-y-2 p-4" aria-hidden>
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-12 animate-pulse rounded-lg bg-slate-100 dark:bg-slate-800" />
            ))}
          </div>
        ) : rows.length === 0 && status === 'ready' ? (
          <div className="flex flex-col items-center gap-3 px-4 py-16 text-center">
            <Inbox className="size-9 text-slate-400" aria-hidden />
            <p className="font-semibold text-slate-900 dark:text-white">{t('list.emptyTitle')}</p>
            <p className="text-sm text-slate-500 dark:text-slate-400">{t('list.emptyBody')}</p>
            {can('event.create') ? (
              <Link to="/admin/events/new" className="text-sm font-semibold text-sky-700 dark:text-sky-400">
                {t('admin.nav.newEvent')}
              </Link>
            ) : null}
          </div>
        ) : (
          <table className={cn('w-full text-sm', status === 'loading' && 'opacity-60')}>
            <thead className="hidden border-b border-slate-200 bg-slate-50 text-start text-xs font-semibold uppercase tracking-wide text-slate-500 md:table-header-group dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-400">
              <tr>
                <th scope="col" className="w-10 ps-4 py-2.5">
                  <input type="checkbox" className="size-4 accent-sky-600" checked={allSelected} onChange={toggleAll} aria-label={t('list.selectAll')} />
                </th>
                <th scope="col" className="px-4 py-2.5 text-start">{t('list.colTitle')}</th>
                <th scope="col" className="px-3 py-2.5 text-start">{t('form.category')}</th>
                <th scope="col" className="hidden px-3 py-2.5 text-start lg:table-cell">{t('list.colLocation')}</th>
                <th scope="col" className="px-3 py-2.5 text-start">{t('list.status')}</th>
                <th scope="col" className="hidden px-3 py-2.5 text-start xl:table-cell">{t('list.colTime')}</th>
                <th scope="col" className="hidden px-3 py-2.5 text-start xl:table-cell">{t('list.colAuthor')}</th>
                <th scope="col" className="px-3 py-2.5 text-end">
                  <span className="sr-only">{t('list.colActions')}</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {rows.map((ev) => {
                const cat = ev.categoryId ? categoryById.get(ev.categoryId) : undefined;
                const actions = availableActions(ev, who);
                const editable = canEditEvent(ev, who);
                const busy = busyId === ev.id;
                return (
                  <tr
                    key={ev.id}
                    className={cn(
                      'relative block px-4 py-3 ps-11 md:table-row md:p-0 hover:bg-slate-50/70 dark:hover:bg-slate-800/40',
                      selected.has(ev.id) && 'bg-sky-50/70 dark:bg-sky-500/10',
                    )}
                  >
                    <td className="absolute start-4 top-3.5 md:static md:table-cell md:w-10 md:ps-4 md:py-3">
                      <input
                        type="checkbox"
                        className="size-4 accent-sky-600"
                        checked={selected.has(ev.id)}
                        onChange={() => toggleRow(ev.id)}
                        aria-label={t('list.selectRow', { title: ev.title || t('list.untitled') })}
                      />
                    </td>
                    <td className="block md:table-cell md:px-4 md:py-3">
                      <Link to={`/admin/events/${ev.id}`} className="font-semibold text-slate-900 hover:text-sky-700 hover:underline dark:text-white dark:hover:text-sky-300" dir="auto">
                        {ev.title || <span className="italic text-slate-400">{t('list.untitled')}</span>}
                      </Link>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5">
                        <SeverityBadge severity={ev.severity} />
                        {ev.isBreaking ? (
                          <span className="inline-flex items-center gap-0.5 text-[11px] font-bold uppercase text-red-600 dark:text-red-400">
                            <Zap className="size-3" aria-hidden />
                            {t('feed.breaking')}
                          </span>
                        ) : null}
                        {ev.isVerified ? (
                          <span title={t('feed.verified')}>
                            <BadgeCheck className="size-3.5 text-sky-600 dark:text-sky-400" aria-label={t('feed.verified')} />
                          </span>
                        ) : null}
                        <span className="text-xs text-slate-500 md:hidden dark:text-slate-400">
                          <bdi>{formatDateTime(ev.occurredAt, locale)}</bdi>
                        </span>
                      </div>
                    </td>
                    <td className="mt-2 block md:mt-0 md:table-cell md:px-3 md:py-3">
                      {editable || can('event.edit.any') ? (
                        <select
                          aria-label={t('form.category')}
                          value={ev.categoryId ?? ''}
                          disabled={busy || !!ev.deletedAt}
                          onChange={(e) => void changeCategory(ev, e.target.value)}
                          className="h-8 max-w-[12rem] rounded-lg border border-slate-200 bg-white px-2 text-xs font-medium text-slate-800 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                          style={cat ? { borderInlineStartColor: cat.color, borderInlineStartWidth: 4 } : undefined}
                        >
                          {!ev.categoryId ? <option value="">—</option> : null}
                          {categories.filter((c) => c.isActive || c.id === ev.categoryId).map((c) => (
                            <option key={c.id} value={c.id}>
                              {categoryLabel(c.slug, c.name)}
                            </option>
                          ))}
                        </select>
                      ) : cat ? (
                        <CategoryBadge category={{ id: cat.id, slug: cat.slug, name: cat.name, icon: cat.icon, color: cat.color, markerColor: cat.markerColor }} />
                      ) : (
                        <span className="text-xs text-slate-400">—</span>
                      )}
                    </td>
                    <td className="hidden max-w-[14rem] text-slate-600 lg:table-cell lg:px-3 lg:py-3 dark:text-slate-300">
                      {canMovePins && !ev.deletedAt ? (
                        <button
                          type="button"
                          onClick={() => setLocating(ev)}
                          title={t('list.quickLocation')}
                          className="inline-flex max-w-full items-center gap-1 rounded-md px-1 py-0.5 text-start hover:bg-sky-50 hover:text-sky-800 dark:hover:bg-sky-500/10 dark:hover:text-sky-200"
                        >
                          <MapPin className={cn('size-3.5 shrink-0', ev.latitude === null ? 'text-amber-500' : 'text-slate-400')} aria-hidden />
                          <span className="truncate" dir="auto">
                            {[ev.locationName, ev.country].filter(Boolean).join(', ') || t('list.noLocation')}
                          </span>
                        </button>
                      ) : (
                        <span className="block truncate" dir="auto">
                          {[ev.locationName, ev.country].filter(Boolean).join(', ') || '—'}
                        </span>
                      )}
                    </td>
                    <td className="mt-2 inline-block md:mt-0 md:table-cell md:px-3 md:py-3">
                      <StatusBadge status={ev.status} />
                    </td>
                    <td className="hidden whitespace-nowrap text-xs text-slate-500 xl:table-cell xl:px-3 xl:py-3 dark:text-slate-400">
                      <bdi>{formatDateTime(ev.occurredAt, locale)}</bdi>
                      <div className="text-[11px] text-slate-400">{t('list.updated', { time: formatDateTime(ev.updatedAt, locale) })}</div>
                    </td>
                    <td className="hidden truncate text-xs text-slate-600 xl:table-cell xl:px-3 xl:py-3 dark:text-slate-300">{ev.createdByName ?? '—'}</td>
                    <td className="mt-2 block md:mt-0 md:table-cell md:px-3 md:py-3">
                      <div className="flex items-center gap-0.5 md:justify-end">
                        <IconButton label={editable ? t('list.edit') : t('list.view')} onClick={() => navigate(`/admin/events/${ev.id}`)} tooltipSide="bottom-end">
                          <Pencil className="size-4" aria-hidden />
                        </IconButton>
                        {actions.includes('publish') ? (
                          <IconButton label={t('form.publish')} onClick={() => void act(ev, 'publish')} disabled={busy} tooltipSide="bottom-end">
                            <CheckCircle2 className="size-4 text-emerald-600 dark:text-emerald-400" aria-hidden />
                          </IconButton>
                        ) : null}
                        {actions.includes('archive') ? (
                          <IconButton label={t('form.archive')} onClick={() => setConfirm({ kind: 'archive', event: ev })} disabled={busy} tooltipSide="bottom-end">
                            <Archive className="size-4" aria-hidden />
                          </IconButton>
                        ) : null}
                        {can('event.create') && !ev.deletedAt ? (
                          <IconButton label={t('list.duplicate')} onClick={() => void act(ev, 'duplicate')} disabled={busy} tooltipSide="bottom-end">
                            <Copy className="size-4" aria-hidden />
                          </IconButton>
                        ) : null}
                        {can('event.delete') && !ev.deletedAt ? (
                          <IconButton label={t('form.delete')} onClick={() => setConfirm({ kind: 'delete', event: ev })} disabled={busy} tooltipSide="bottom-end">
                            <Trash2 className="size-4 text-red-600 dark:text-red-400" aria-hidden />
                          </IconButton>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {pages > 1 ? (
        <nav className="mt-4 flex items-center justify-center gap-3 text-sm" aria-label={t('list.pagination')}>
          <IconButton label={t('list.prev')} onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0} tooltipSide="top">
            <ChevronLeft className="size-4 rtl:-scale-x-100" aria-hidden />
          </IconButton>
          <span className="text-slate-600 dark:text-slate-300">{t('list.page', { page: page + 1, pages })}</span>
          <IconButton label={t('list.next')} onClick={() => setPage((p) => Math.min(pages - 1, p + 1))} disabled={page >= pages - 1} tooltipSide="top">
            <ChevronRight className="size-4 rtl:-scale-x-100" aria-hidden />
          </IconButton>
        </nav>
      ) : null}

      <ConfirmDialog
        open={bulk === 'publish'}
        title={t('list.bulkPublishTitle', { count: publishable.length })}
        body={t('list.bulkPublishBody')}
        confirmLabel={t('form.publish')}
        busy={bulkBusy}
        onCancel={() => setBulk(null)}
        onConfirm={() => void runBulk('publish')}
      />
      <ConfirmDialog
        open={bulk === 'delete'}
        title={t('list.bulkDeleteTitle', { count: deletable.length })}
        body={t('form.deleteBody')}
        confirmLabel={t('form.delete')}
        tone="danger"
        busy={bulkBusy}
        onCancel={() => setBulk(null)}
        onConfirm={() => void runBulk('delete')}
      />
      {locating ? (
        <QuickLocationDialog
          event={locating}
          iconName={(locating.categoryId && categoryById.get(locating.categoryId)?.icon) || 'CircleDot'}
          color={(locating.categoryId && categoryById.get(locating.categoryId)?.markerColor) || '#0284c7'}
          busy={locBusy}
          onCancel={() => setLocating(null)}
          onSave={(a, b, n) => void saveLocation(a, b, n)}
        />
      ) : null}
      <ConfirmDialog
        open={confirm?.kind === 'archive'}
        title={t('form.archiveTitle')}
        body={t('form.archiveBody')}
        confirmLabel={t('form.archive')}
        busy={!!busyId}
        onCancel={() => setConfirm(null)}
        onConfirm={() => confirm && void act(confirm.event, 'archive')}
      />
      <ConfirmDialog
        open={confirm?.kind === 'delete'}
        title={t('form.deleteTitle')}
        body={t('form.deleteBody')}
        confirmLabel={t('form.delete')}
        tone="danger"
        busy={!!busyId}
        onCancel={() => setConfirm(null)}
        onConfirm={() => confirm && void act(confirm.event, 'delete')}
      />
    </div>
  );
}
