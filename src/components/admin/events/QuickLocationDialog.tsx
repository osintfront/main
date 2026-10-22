import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { useI18n } from '@/i18n';
import type { AdminEvent } from '@/types/event';
import { Button } from '@/components/common/Form';
import { LocationPicker } from './LocationPicker';

interface QuickLocationDialogProps {
  event: AdminEvent;
  iconName: string;
  color: string;
  busy: boolean;
  onCancel: () => void;
  onSave: (lat: number, lng: number, locationName: string) => void;
}

/** Events list: set an event's place without opening the full editor. */
export function QuickLocationDialog({ event, iconName, color, busy, onCancel, onSave }: QuickLocationDialogProps) {
  const { t } = useI18n();
  const [lat, setLat] = useState<number | null>(event.latitude);
  const [lng, setLng] = useState<number | null>(event.longitude);
  const [name, setName] = useState(event.locationName ?? '');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onCancel();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onCancel]);

  return (
    <div className="fixed inset-0 z-[3000] flex items-end justify-center sm:items-center sm:p-6" role="presentation">
      <div className="absolute inset-0 bg-slate-950/60" onClick={onCancel} aria-hidden />
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="quick-location-title"
        className="relative flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl ring-1 ring-slate-900/10 sm:max-w-2xl sm:rounded-2xl dark:bg-slate-900 dark:ring-white/10"
      >
        <header className="flex items-start gap-3 border-b border-slate-200 px-5 py-3 dark:border-slate-800">
          <div className="min-w-0 flex-1">
            <h2 id="quick-location-title" className="text-base font-bold text-slate-900 dark:text-white">
              {t('list.quickLocation')}
            </h2>
            <p className="truncate text-xs text-slate-500 dark:text-slate-400" dir="auto">
              {event.title}
            </p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            aria-label={t('common.close')}
            className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <X className="size-5" aria-hidden />
          </button>
        </header>
        <div className="ofm-scroll min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <label className="mb-3 block text-sm font-medium text-slate-700 dark:text-slate-200">
            {t('form.locationName')}
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={200}
              dir="auto"
              className="mt-1 h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/30 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
            />
          </label>
          <LocationPicker
            latitude={lat}
            longitude={lng}
            iconName={iconName}
            color={color}
            onPick={(a, b) => {
              setLat(a);
              setLng(b);
            }}
            onSelectResult={(r) => {
              setLat(r.latitude);
              setLng(r.longitude);
              setName(r.locationName || r.city || r.label);
            }}
            onReverse={(r) => setName((n) => n || r.locationName || r.city || '')}
          />
          <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">{t('list.quickLocationHint')}</p>
        </div>
        <footer className="flex justify-end gap-2 border-t border-slate-200 px-5 py-3 dark:border-slate-800">
          <Button variant="secondary" onClick={onCancel}>
            {t('common.cancel')}
          </Button>
          <Button loading={busy} disabled={lat === null || lng === null} onClick={() => lat !== null && lng !== null && onSave(lat, lng, name.trim())}>
            {t('move.save')}
          </Button>
        </footer>
      </section>
    </div>
  );
}
