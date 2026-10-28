import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import { Copy, ExternalLink, Filter, MapPin, Radar } from 'lucide-react';
import { octagon, type LatLng } from '@/lib/eventFilters';
import type { PublicEvent } from '@/types/event';
import { useI18n } from '@/i18n';

export interface ContextTarget { x: number; y: number; lat: number; lng: number; event?: PublicEvent; categorySlug?: string }

/**
 * Right-click on the map (map only — the browser's own menu stays everywhere else):
 * an investigation menu. A right-click on a pin also offers "filter by this type" and "open source".
 */
export function MapContextMenu({ map, target, onClose, onArea, onFilterCategory }: {
  map: L.Map | null;
  target: ContextTarget | null;
  onClose: () => void;
  onArea?: (points: LatLng[]) => void;
  onFilterCategory?: (slug: string) => void;
}) {
  const { lang, categoryLabel } = useI18n();
  const he = lang === 'he';
  const ref = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!target) return;
    setCopied(false);
    const close = (e: Event) => { if (!ref.current?.contains(e.target as Node)) onClose(); };
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', key);
    map?.on('movestart zoomstart', onClose);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', key);
      map?.off('movestart zoomstart', onClose);
    };
  }, [target, map, onClose]);

  if (!target || !map) return null;
  const coords = `${target.lat.toFixed(5)}, ${target.lng.toFixed(5)}`;
  const slug = target.categorySlug ?? target.event?.category.slug;
  const source = target.event?.sourceUrl;
  const size = map.getContainer().getBoundingClientRect();
  const left = Math.min(target.x, size.width - 230);
  const top = Math.min(target.y, size.height - 220);
  const item = 'flex w-full items-center gap-2.5 px-3 py-2 text-start text-sm text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800';

  return (
    <div
      ref={ref}
      role="menu"
      dir={he ? 'rtl' : 'ltr'}
      className="absolute z-[1200] w-56 overflow-hidden rounded-xl bg-white py-1 shadow-2xl ring-1 ring-slate-900/10 dark:bg-slate-900 dark:ring-white/10"
      style={{ left, top }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <p className="border-b border-slate-100 px-3 py-1.5 font-mono text-[11px] text-slate-500 dark:border-slate-800" dir="ltr">{coords}</p>
      <button type="button" role="menuitem" className={item} onClick={() => void navigator.clipboard?.writeText(coords).then(() => setCopied(true))}>
        <Copy className="size-4" aria-hidden />{copied ? (he ? 'הועתק ✓' : 'Copied ✓') : he ? 'העתקת קואורדינטות' : 'Copy coordinates'}
      </button>
      {onArea ? (
        <button type="button" role="menuitem" className={item} onClick={() => {
          // ~10 km around the point (the existing drawn-area filter).
          onArea(octagon([target.lat, target.lng], [target.lat + 0.09, target.lng]));
          onClose();
        }}>
          <Radar className="size-4" aria-hidden />{he ? 'אירועים בסביבה (10 ק"מ)' : 'Events nearby (10 km)'}
        </button>
      ) : null}
      {slug && onFilterCategory ? (
        <button type="button" role="menuitem" className={item} onClick={() => { onFilterCategory(slug); onClose(); }}>
          <Filter className="size-4" aria-hidden />{he ? 'סינון לפי הסוג: ' : 'Filter by type: '}{categoryLabel(slug, target.event?.category.name ?? slug)}
        </button>
      ) : null}
      {source ? (
        <a role="menuitem" className={item} href={source} target="_blank" rel="noopener noreferrer nofollow" onClick={onClose}>
          <ExternalLink className="size-4" aria-hidden />{he ? 'פתיחת המקור' : 'Open source'}
        </a>
      ) : null}
      <a role="menuitem" className={item} href={`https://www.google.com/maps?q=${target.lat},${target.lng}`} target="_blank" rel="noopener noreferrer nofollow" onClick={onClose}>
        <MapPin className="size-4" aria-hidden />{he ? 'פתיחה ב-Google Maps' : 'Open in Google Maps'}
      </a>
    </div>
  );
}
