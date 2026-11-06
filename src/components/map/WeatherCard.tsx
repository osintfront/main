// The right-click weather card: now / 48 hours / 7 days / sun & moon at a point on the map.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ArrowUp, RefreshCw, X } from 'lucide-react';
import { useI18n } from '@/i18n';
import { supabase } from '@/integrations/supabase/client';
import { fetchPoint, type Hour, type PointForecast } from '@/lib/weather';
import '@/lib/weatherLayers'; // wires the member key to the session
import { STALE, latestOnly } from '@/lib/latestOnly';
import { effectiveLight, fmtTime, moonPhase, moonTimes, moonUp, nightWindow, sunTimes, tonightHours, zoneForCountry, type MoonState } from '@/lib/moon';

export interface WeatherAt { lat: number; lng: number; x: number; y: number }

const TXT = {
  he: {
    now: 'עכשיו', hours: '48 שעות', days: '7 ימים', sky: 'שמש וירח', close: 'סגירה', retry: 'לנסות שוב', loading: 'טוען…',
    error: 'אין נתוני מזג אוויר כרגע', cloud: 'עננות', rain: 'גשם', wind: 'רוח', gusts: 'משבים', humidity: 'לחות', kmh: 'קמ"ש', kn: 'קשר', mm: 'מ"מ',
    mmh: 'מ"מ/שעה', updated: 'עודכן', local: 'מקומי', astroDawn: 'שחר אסטרונומי', nauticalDawn: 'שחר ימי', civilDawn: 'שחר אזרחי', sunrise: 'זריחה',
    sunset: 'שקיעה', civilDusk: 'דמדומים אזרחיים', nauticalDusk: 'דמדומים ימיים', astroDusk: 'דמדומים אסטרונומיים', dayLength: 'אורך היום',
    moonrise: 'זריחת ירח', moonset: 'שקיעת ירח', moon: 'ירח', lit: 'מואר', lightNow: 'אור הירח עכשיו (אחרי עננות)', tonight: 'הלילה, שעה-שעה',
    new: 'אין ירח', partial: 'ירח חלקי', half: 'חצי ירח', full: 'ירח מלא', waxing: 'מתמלא', waning: 'מתמעט', h: 'ש׳', m: 'ד׳', moonDown: 'מתחת לאופק',
  },
  en: {
    now: 'Now', hours: '48 h', days: '7 days', sky: 'Sun & moon', close: 'Close', retry: 'Retry', loading: 'Loading…',
    error: 'No weather data right now', cloud: 'Cloud', rain: 'Rain', wind: 'Wind', gusts: 'gusts', humidity: 'Humidity', kmh: 'km/h', kn: 'kn', mm: 'mm',
    mmh: 'mm/h', updated: 'Updated', local: 'local', astroDawn: 'Astronomical dawn', nauticalDawn: 'Nautical dawn', civilDawn: 'Civil dawn', sunrise: 'Sunrise',
    sunset: 'Sunset', civilDusk: 'Civil dusk', nauticalDusk: 'Nautical dusk', astroDusk: 'Astronomical dusk', dayLength: 'Day length',
    moonrise: 'Moonrise', moonset: 'Moonset', moon: 'Moon', lit: 'lit', lightNow: 'Moonlight now (after clouds)', tonight: 'Tonight, hour by hour',
    new: 'No moon', partial: 'Partial moon', half: 'Half moon', full: 'Full moon', waxing: 'waxing', waning: 'waning', h: 'h', m: 'm', moonDown: 'below the horizon',
  },
} as const;
type Txt = Record<keyof (typeof TXT)['he'], string>;
type Tab = 'now' | 'hours' | 'days' | 'sky';

const USER_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;
const MOON_ICON: Record<MoonState, string> = { new: '🌑', partial: '🌘', half: '🌓', full: '🌕' };

/** MET symbol codes → an emoji. */
function icon(symbol: string | null): string {
  if (!symbol) return '·';
  const s = symbol.replace(/_(day|night|polartwilight)$/, '');
  const night = symbol.endsWith('_night');
  if (s.includes('thunder')) return '⛈️';
  if (s.includes('snow') || s.includes('sleet')) return '🌨️';
  if (s.includes('showers')) return '🌦️';
  if (s.includes('rain')) return '🌧️';
  if (s === 'fog') return '🌫️';
  if (s === 'cloudy') return '☁️';
  if (s === 'partlycloudy') return night ? '☁️' : '⛅';
  if (s === 'fair') return night ? '🌙' : '🌤️';
  return night ? '🌙' : '☀️';
}
const kn = (kmh: number | null) => (kmh === null ? '—' : Math.round(kmh * 0.539957));
const pct = (v: number | null) => (v === null ? '—' : `${Math.round(v)}%`);

export function WeatherCard({ at, onClose, container }: { at: WeatherAt; onClose: () => void; container: HTMLElement | null }) {
  const { lang, dir } = useI18n();
  const he = lang === 'he';
  const T: Txt = TXT[he ? 'he' : 'en'];
  const [tab, setTab] = useState<Tab>('now');
  const [data, setData] = useState<PointForecast | null>(null);
  const [failed, setFailed] = useState(false);
  const [place, setPlace] = useState<{ label: string; zone: string | null } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const guard = useRef(latestOnly<PointForecast>()).current;
  const placeGuard = useRef(latestOnly<{ label: string; zone: string | null }>()).current;

  useEffect(() => {
    let alive = true;
    setData(null);
    setFailed(false);
    void placeGuard((async () => {
      if (!supabase) return { label: '', zone: null };
      const { data: rows } = await supabase.rpc('geo_nearest_place', { p_lat: at.lat, p_lng: at.lng });
      const row = Array.isArray(rows) ? rows[0] : null;
      if (!row) return { label: '', zone: null };
      return { label: (he ? row.name_he : row.name_en) || row.name, zone: zoneForCountry(row.country_code) };
    })()).then((p) => {
      if (!alive || p === STALE) return;
      setPlace(p);
      return guard(fetchPoint(at.lat, at.lng, p.zone ?? USER_ZONE)).then((f) => alive && f !== STALE && setData(f));
    }).catch(() => alive && setFailed(true));
    return () => { alive = false; };
  }, [at.lat, at.lng, attempt, he, guard, placeGuard]);

  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, [onClose]);

  const zone = place?.zone && place.zone !== USER_ZONE ? place.zone : null;
  const both = (d: Date | null) => (zone && d ? `${fmtTime(d)} (${T.local} ${fmtTime(d, zone)})` : fmtTime(d));

  // Sun and moon — computed here, no network.
  const sky = useMemo(() => {
    const now = new Date();
    const sun = sunTimes(now, at.lat, at.lng);
    const moon = moonPhase(now);
    const times = moonTimes(now, at.lat, at.lng);
    const night = nightWindow(now, at.lat, at.lng);
    const hours = night ? tonightHours(night.from, night.to) : [];
    return { now, sun, moon, times, hours, up: moonUp(now, at.lat, at.lng) };
  }, [at.lat, at.lng]);
  const cloudAt = (d: Date): number | null => {
    const iso = new Date(Math.floor(d.getTime() / 3600_000) * 3600_000).toISOString().replace('.000Z', 'Z');
    return data?.hours.find((h) => h.t === iso)?.cloud ?? null;
  };
  const lightNow = effectiveLight(sky.moon.fraction, data?.now.cloud ?? null, sky.up);

  // Position: next to the click, inside the map; a bottom sheet on narrow screens.
  const box = container?.getBoundingClientRect();
  const narrow = (box?.width ?? 0) < 520;
  const style = narrow || !box
    ? { left: 8, right: 8, bottom: 8 }
    : { left: Math.max(8, Math.min(at.x + 12, box.width - 348)), top: Math.max(8, Math.min(at.y - 40, box.height - 470)) };

  const tabBtn = (id: Tab, label: string) => (
    <button key={id} type="button" role="tab" aria-selected={tab === id} data-weather-tab={id} onClick={() => setTab(id)}
      className={`flex-1 rounded-md px-2 py-1 text-xs font-semibold ${tab === id ? 'bg-sky-600 text-white' : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'}`}>
      {label}
    </button>
  );
  const row = (label: string, value: string) => (
    <div key={label} className="flex justify-between gap-3 py-0.5"><span className="text-slate-500">{label}</span><span className="font-medium tabular-nums" dir="ltr">{value}</span></div>
  );
  const windArrow = (h: Hour) => h.windDir === null ? null : (
    <ArrowUp className="inline size-3.5" style={{ transform: `rotate(${h.windDir + 180}deg)` }} aria-hidden />
  );

  let body: ReactNode;
  if (tab === 'sky') {
    const s = sky.sun;
    body = (
      <div className="text-xs">
        {row(T.astroDawn, both(s.astroDawn))}{row(T.nauticalDawn, both(s.nauticalDawn))}{row(T.civilDawn, both(s.civilDawn))}
        {row(T.sunrise, both(s.sunrise))}{row(T.sunset, both(s.sunset))}{row(T.civilDusk, both(s.civilDusk))}
        {row(T.nauticalDusk, both(s.nauticalDusk))}{row(T.astroDusk, both(s.astroDusk))}
        {row(T.dayLength, s.dayLengthMin === null ? '—' : `${Math.floor(s.dayLengthMin / 60)}${T.h} ${s.dayLengthMin % 60}${T.m}`)}
        <div className="my-2 border-t border-slate-200 dark:border-slate-700" />
        <p className="mb-1 text-sm font-semibold">{MOON_ICON[sky.moon.state]} {T[sky.moon.state]} · {Math.round(sky.moon.fraction * 100)}% {T.lit} · {sky.moon.waxing ? T.waxing : T.waning}</p>
        {row(T.moonrise, both(sky.times.rise))}{row(T.moonset, both(sky.times.set))}
        {row(T.lightNow, !sky.up ? T.moonDown : lightNow === null ? '—' : `${Math.round(lightNow * 100)}%`)}
        {sky.hours.length ? (
          <>
            <p className="mt-2 mb-1 font-semibold">{T.tonight}</p>
            <div className="flex gap-1 overflow-x-auto pb-1" dir="ltr">
              {sky.hours.map((h) => {
                const l = effectiveLight(moonPhase(h).fraction, cloudAt(h), moonUp(h, at.lat, at.lng));
                return (
                  <div key={h.toISOString()} className="min-w-11 rounded bg-slate-100 px-1 py-1 text-center dark:bg-slate-800">
                    <div className="text-[10px] text-slate-500">{fmtTime(h)}</div>
                    <div className="font-semibold tabular-nums">{l === null ? '—' : `${Math.round(l * 100)}%`}</div>
                  </div>
                );
              })}
            </div>
          </>
        ) : null}
      </div>
    );
  } else if (failed) {
    body = (
      <div className="py-6 text-center text-sm text-slate-600 dark:text-slate-300">
        <p>{T.error}</p>
        <button type="button" className="mt-2 inline-flex items-center gap-1 rounded-md bg-slate-100 px-3 py-1 text-xs font-semibold dark:bg-slate-800" onClick={() => setAttempt((n) => n + 1)}>
          <RefreshCw className="size-3.5" aria-hidden />{T.retry}
        </button>
      </div>
    );
  } else if (!data) {
    body = <p className="py-6 text-center text-sm text-slate-500">{T.loading}</p>;
  } else if (tab === 'now') {
    const n = data.now;
    body = (
      <div>
        <div className="mb-2 flex items-center gap-3">
          <span className="text-4xl" aria-hidden>{icon(n.symbol)}</span>
          <span className="text-3xl font-bold tabular-nums" data-weather-temp dir="ltr">{n.temp === null ? '—' : `${Math.round(n.temp)}°C`}</span>
        </div>
        <div className="text-xs">
          {row(T.cloud, pct(n.cloud))}
          {row(T.rain, n.rain === null ? '—' : `${n.rain} ${T.mmh}`)}
          <div className="flex justify-between gap-3 py-0.5"><span className="text-slate-500">{T.wind}</span>
            <span className="font-medium tabular-nums" dir="ltr">{windArrow(n)} {n.windKmh ?? '—'} {T.kmh} ({kn(n.windKmh)} {T.kn}){n.gustKmh !== null ? ` · ${T.gusts} ${n.gustKmh}` : ''}</span></div>
          {row(T.humidity, pct(n.humidity))}
        </div>
      </div>
    );
  } else if (tab === 'hours') {
    body = (
      <div className="flex gap-1 overflow-x-auto pb-1 text-center text-[11px]" dir="ltr">
        {data.hours.map((h) => (
          <div key={h.t} className="min-w-12 rounded bg-slate-100 px-1 py-1 dark:bg-slate-800">
            <div className="text-slate-500">{fmtTime(new Date(h.t))}</div>
            <div className="text-base" aria-hidden>{icon(h.symbol)}</div>
            <div className="font-semibold">{h.temp === null ? '—' : `${Math.round(h.temp)}°`}</div>
            <div className="text-slate-500">☁ {pct(h.cloud)}</div>
            <div className="text-sky-700 dark:text-sky-300">{h.rain ? `${h.rain}` : '0'} {T.mm}</div>
            <div>{windArrow(h)}{h.windKmh === null ? '—' : Math.round(h.windKmh)}</div>
          </div>
        ))}
      </div>
    );
  } else {
    const wd = new Intl.DateTimeFormat(he ? 'he-IL' : 'en-GB', { weekday: 'short', day: 'numeric', timeZone: 'UTC' });
    body = (
      <div className="text-xs">
        {data.days.map((d) => (
          <div key={d.date} className="flex items-center gap-2 border-b border-slate-100 py-1 last:border-0 dark:border-slate-800">
            <span className="w-16 text-slate-500">{wd.format(new Date(`${d.date}T12:00:00Z`))}</span>
            <span className="text-base" aria-hidden>{icon(d.symbol)}</span>
            <span className="flex-1 font-semibold tabular-nums" dir="ltr">{d.tMax === null ? '—' : Math.round(d.tMax)}° / {d.tMin === null ? '—' : Math.round(d.tMin)}°</span>
            <span className="tabular-nums text-sky-700 dark:text-sky-300" dir="ltr">{d.rain} {T.mm}</span>
            <span className="w-16 text-end tabular-nums" dir="ltr">💨 {d.windMaxKmh === null ? '—' : Math.round(d.windMaxKmh)}</span>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div dir={dir} role="dialog" aria-label={T.sky} data-weather-card
      className="absolute z-[1200] w-auto rounded-xl bg-white p-3 shadow-2xl ring-1 ring-slate-900/10 sm:w-[340px] dark:bg-slate-900 dark:text-slate-100 dark:ring-white/10"
      style={style} onContextMenu={(e) => e.preventDefault()}>
      <div className="mb-2 flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{place?.label || (he ? 'מזג אוויר' : 'Weather')}</p>
          <p className="font-mono text-[11px] text-slate-500" dir="ltr">{at.lat.toFixed(4)}, {at.lng.toFixed(4)}</p>
        </div>
        <button type="button" aria-label={T.close} onClick={onClose} className="rounded p-1 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"><X className="size-4" /></button>
      </div>
      <div role="tablist" className="mb-2 flex gap-1 rounded-lg bg-slate-50 p-0.5 dark:bg-slate-800/60">
        {tabBtn('now', T.now)}{tabBtn('hours', T.hours)}{tabBtn('days', T.days)}{tabBtn('sky', T.sky)}
      </div>
      <div className="max-h-[340px] overflow-y-auto">{body}</div>
      <p className="mt-2 text-[10px] text-slate-400">
        MET Norway (CC BY 4.0){data?.updated ? ` · ${T.updated} ${fmtTime(new Date(data.updated))}` : ''}
      </p>
    </div>
  );
}
