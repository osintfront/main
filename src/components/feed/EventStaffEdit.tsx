import { useEffect, useState } from 'react';
import { MapPin, Move, Pencil, Search, Tag } from 'lucide-react';
import { useI18n } from '@/i18n';
import { usePermissions } from '@/hooks/usePermissions';
import { fetchCategories } from '@/services/categoryService';
import { moveEventPin, setEventCategory } from '@/services/eventAdminService';
import { friendlyError } from '@/services/serviceError';
import type { EventCategory } from '@/types/category';
import type { PublicEvent } from '@/types/event';
import { useToast } from '@/components/common/Toast';
import { QuickLocationDialog } from '@/components/admin/events/QuickLocationDialog';
import { EventTextDialog } from './EventTextDialog';

interface EventStaffEditProps {
  event: PublicEvent;
  /** Reload the map after a change. */
  onChanged?: () => void;
  /** Move the pin by dragging it on the map (closes the window). */
  onMovePin?: (id: string) => void;
}

/**
 * Analysts and admins: fix the event's text, category and place from its details window.
 * The database checks the permission again (set_event_category / move_event_pin) and learns
 * from the correction; an analyst's change on a live event is sent for review.
 */
export function EventStaffEdit({ event, onChanged, onMovePin }: EventStaffEditProps) {
  const { t, categoryLabel } = useI18n();
  const { can } = usePermissions();
  const toast = useToast();
  const allowed = can('event.edit.any') || can('event.edit.own');
  const [categories, setCategories] = useState<EventCategory[]>([]);
  const [categoryId, setCategoryId] = useState(event.category.id ?? '');
  const [busy, setBusy] = useState(false);
  const [locating, setLocating] = useState(false);
  const [editingText, setEditingText] = useState(false);

  useEffect(() => {
    if (allowed) fetchCategories().then(setCategories).catch(() => undefined);
  }, [allowed]);
  useEffect(() => setCategoryId(event.category.id ?? ''), [event.category.id]);

  if (!allowed) return null;

  const done = () => {
    toast.success(can('event.publish') ? t('move.saved') : t('list.sentForReview'));
    onChanged?.();
  };

  const changeCategory = async (id: string) => {
    const cat = categories.find((c) => c.id === id);
    if (!cat || id === event.category.id) return;
    setCategoryId(id);
    setBusy(true);
    try {
      await setEventCategory(event.id, cat.slug);
      done();
    } catch (err) {
      setCategoryId(event.category.id ?? '');
      toast.error(friendlyError(err, t));
    } finally {
      setBusy(false);
    }
  };

  const saveLocation = async (lat: number, lng: number, name: string) => {
    setBusy(true);
    try {
      await moveEventPin(event.id, lat, lng, name);
      setLocating(false);
      done();
    } catch (err) {
      toast.error(friendlyError(err, t));
    } finally {
      setBusy(false);
    }
  };

  const active = categories.filter((c) => c.isActive || c.id === categoryId);

  return (
    <section aria-labelledby="event-staff-edit" className="mt-5 rounded-xl border border-dashed border-sky-300 bg-sky-50/50 p-3 dark:border-sky-500/40 dark:bg-sky-500/5">
      <h3 id="event-staff-edit" className="mb-2 text-xs font-bold uppercase tracking-wide text-sky-800 dark:text-sky-300">
        {t('details.staffEdit')}
      </h3>
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex min-w-0 flex-1 items-center gap-1.5 text-sm text-slate-700 dark:text-slate-200">
          <Tag className="size-4 shrink-0 text-slate-400" aria-hidden />
          <span className="sr-only">{t('form.category')}</span>
          <select
            value={categoryId}
            disabled={busy || !active.length}
            onChange={(e) => void changeCategory(e.target.value)}
            className="h-9 min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-2 text-sm dark:border-slate-700 dark:bg-slate-900"
          >
            {!categoryId ? <option value="">{t('form.category')}</option> : null}
            {active.map((c) => (
              <option key={c.id} value={c.id}>
                {categoryLabel(c.slug, c.name)}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          disabled={busy}
          onClick={() => setEditingText(true)}
          className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
        >
          <Pencil className="size-4" aria-hidden />
          {t('textEdit.button')}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => setLocating(true)}
          className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
        >
          <Search className="size-4" aria-hidden />
          {t('list.quickLocation')}
        </button>
        {onMovePin ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => onMovePin(event.id)}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            <Move className="size-4" aria-hidden />
            {t('move.button')}
          </button>
        ) : null}
      </div>
      {event.locationName ? (
        <p className="mt-2 flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400">
          <MapPin className="size-3.5" aria-hidden />
          <bdi>{event.locationName}</bdi>
        </p>
      ) : null}
      {editingText ? <EventTextDialog event={event} onClose={() => setEditingText(false)} onSaved={() => onChanged?.()} /> : null}
      {locating ? (
        <QuickLocationDialog
          event={{ title: event.title, latitude: event.latitude, longitude: event.longitude, locationName: event.locationName }}
          iconName={event.category.icon || 'CircleDot'}
          color={event.category.markerColor || '#0284c7'}
          busy={busy}
          onCancel={() => setLocating(false)}
          onSave={(a, b, n) => void saveLocation(a, b, n)}
        />
      ) : null}
    </section>
  );
}
