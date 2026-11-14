// "Weather" in the Intelligence layers panel: clouds and rain on a timeline (observed past hours from
// EUMETSAT, forecast hours from NOAA GFS frames), plus temperature and wind now (OpenWeatherMap).
// State lives in useWeatherLayers (kept by IntelLayers while the panel is closed), like areaLayers.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import L from 'leaflet';
import { Cloud, CloudRain, Pause, Play, Thermometer, Wind } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { hasFeature } from '@/lib/plans';
import { openGate } from '@/components/plans/GateDialog';
import { LayerSection } from './LayerSection';
import { WithTip } from '@/components/common/InfoTip';
import { useI18n } from '@/i18n';
import { buildFrames, fetchGfsManifest, owmTileUrl, weatherKey, type Frame, type GfsManifest } from '@/lib/weather';
import { WEATHER_PUBLIC_BASE, forecastLayer, pastLayer, weatherPanes } from '@/lib/weatherLayers';

const WX_TXT = {
  he: {
    title: 'מזג אוויר', clouds: 'עננים', rain: 'גשם', temp: 'טמפרטורה', wind: 'רוח', opacity: 'שקיפות', unavailable: 'לא זמין',
    now: 'עכשיו', h: 'ש׳', play: 'הרצה', pause: 'עצירה', noForecast: 'התחזית עדיין לא זמינה', observed: 'תצפית', forecast: 'תחזית',
    credits: 'עננים וגשם בפועל: EUMETSAT · תחזית: NOAA GFS · טמפרטורה ורוח: OpenWeatherMap', mmh: 'מ"מ/שעה', kmh: 'קמ"ש',
  },
  en: {
    title: 'Weather', clouds: 'Clouds', rain: 'Rain', temp: 'Temperature', wind: 'Wind', opacity: 'Opacity', unavailable: 'Unavailable',
    now: 'now', h: 'h', play: 'Play', pause: 'Pause', noForecast: 'Forecast not available yet', observed: 'observed', forecast: 'forecast',
    credits: 'Observed clouds and rain: EUMETSAT · Forecast: NOAA GFS · Temperature and wind: OpenWeatherMap', mmh: 'mm/h', kmh: 'km/h',
  },
} as const;
type WxTxt = Record<keyof (typeof WX_TXT)['he'], string>;
type Toggle = 'clouds' | 'rain' | 'temp' | 'wind';

const RAIN_LEGEND: [string, string][] = [['#93c5fd', '0.1'], ['#3b82f6', '0.5'], ['#1d4ed8', '2'], ['#facc15', '5'], ['#dc2626', '10+']];
const PRELOAD = 3;

export function useWeatherLayers(map: L.Map | null, lang: string, dir: 'ltr' | 'rtl') {
  const T: WxTxt = WX_TXT[lang === 'he' ? 'he' : 'en'];
  const { profile } = useAuth();
  const [on, setOn] = useState<Record<Toggle, boolean>>({ clouds: false, rain: false, temp: false, wind: false });
  const [bad, setBad] = useState<Partial<Record<Toggle, boolean>>>({});
  const [opacity, setOpacity] = useState(0.7);
  const [manifest, setManifest] = useState<GfsManifest | null>(null);
  const [tick, setTick] = useState(0);
  const [idx, setIdx] = useState(-1);
  const [playing, setPlaying] = useState(false);
  const failed = useRef(new Set<string>());
  const timeline = on.clouds || on.rain;

  const toggle = useCallback((k: Toggle, v: boolean) => {
    if (v && !profile) return openGate('signup', 'weather');
    if (v && !hasFeature(undefined, 'weather')) return openGate('upgrade', 'weather');
    setBad((b) => ({ ...b, [k]: false }));
    setOn((cur) => ({ ...cur, [k]: v }));
  }, [profile]);

  // Frames: rebuilt every 10 minutes; the forecast list every 30 minutes while the timeline is on.
  useEffect(() => {
    if (!timeline) return;
    const t = setInterval(() => setTick((n) => n + 1), 600_000);
    return () => clearInterval(t);
  }, [timeline]);
  const frames = useMemo(() => buildFrames(new Date()), [tick]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!timeline) return;
    let alive = true;
    void fetchGfsManifest(WEATHER_PUBLIC_BASE).then((m) => alive && setManifest(m));
    return () => { alive = false; };
  }, [timeline, Math.floor(tick / 3)]); // eslint-disable-line react-hooks/exhaustive-deps

  const byTime = useMemo(() => new Map((manifest?.frames ?? []).map((f) => [new Date(f.time).toISOString(), f])), [manifest]);
  const usable = useCallback((f: Frame) => !failed.current.has(f.time) && (f.kind === 'observed' || byTime.has(f.time)), [byTime]);

  // Start at "now" when the forecast exists, otherwise at the newest observed hour.
  useEffect(() => {
    if (!timeline) return setPlaying(false);
    setIdx((cur) => {
      if (cur >= 0 && cur < frames.length && usable(frames[cur])) return cur;
      const now = frames.findIndex((f) => f.offsetH === 0);
      return usable(frames[now]) ? now : now - 1;
    });
  }, [timeline, frames, usable]);

  const step = useCallback((from: number, dirn = 1) => {
    for (let k = 1; k <= frames.length; k++) {
      const j = (from + dirn * k + frames.length) % frames.length;
      if (usable(frames[j])) return j;
    }
    return from;
  }, [frames, usable]);

  useEffect(() => {
    if (!playing) return;
    const t = setInterval(() => setIdx((i) => step(i)), 500);
    return () => clearInterval(t);
  }, [playing, step]);

  // Frame layers: the current one shown, the next few preloaded invisibly, the rest removed.
  const cache = useRef(new Map<string, L.Layer & { setOpacity(o: number): unknown }>());
  useEffect(() => {
    if (!map) return;
    const panes = weatherPanes(map);
    const want = new Map<string, number>(); // key → opacity
    if (timeline && idx >= 0) {
      let j = idx;
      for (let n = 0; n <= PRELOAD; n++) {
        const f = frames[j];
        if (f && usable(f)) {
          for (const kind of ['cloud', 'rain'] as const) {
            if ((kind === 'cloud' && on.clouds) || (kind === 'rain' && on.rain)) want.set(`${kind}|${f.time}`, n === 0 ? opacity : 0);
          }
        }
        j = step(j);
        if (j === idx) break;
      }
    }
    for (const [key, layer] of cache.current) {
      if (!want.has(key)) { layer.remove(); cache.current.delete(key); }
    }
    for (const [key, op] of want) {
      let layer = cache.current.get(key);
      if (!layer) {
        const [kind, time] = key.split('|') as ['cloud' | 'rain', string];
        const frame = frames.find((f) => f.time === time)!;
        const pane = kind === 'cloud' ? panes.clouds : panes.rain;
        if (frame.kind === 'observed') {
          const l = pastLayer(kind, time, op, pane);
          let errors = 0;
          l.on('tileerror', () => { if (++errors > 6) failed.current.add(time); });
          layer = l;
        } else {
          const f = byTime.get(time)!;
          const l = forecastLayer(kind, f, op, pane);
          l.on('error', () => failed.current.add(time));
          layer = l;
        }
        layer.addTo(map);
        cache.current.set(key, layer);
      }
      layer.setOpacity(op);
    }
  }, [map, timeline, idx, frames, on.clouds, on.rain, opacity, usable, step, byTime]);
  useEffect(() => () => { for (const l of cache.current.values()) l.remove(); cache.current.clear(); }, []);

  // Temperature and wind: "now" tiles through our route.
  const base = useRef<Partial<Record<'temp' | 'wind', L.TileLayer>>>({});
  useEffect(() => {
    if (!map) return;
    let alive = true;
    for (const k of ['temp', 'wind'] as const) {
      const existing = base.current[k];
      if (!on[k]) { existing?.remove(); delete base.current[k]; continue; }
      if (existing) { existing.setOpacity(opacity); continue; }
      void weatherKey().then((key) => {
        if (!alive || !on[k] || base.current[k]) return;
        let errors = 0, loaded = 0;
        const l = L.tileLayer(owmTileUrl(k, key), { opacity, pane: weatherPanes(map).clouds, attribution: 'OpenWeatherMap', maxNativeZoom: 9, maxZoom: 19 });
        l.on('tileerror', () => { if (++errors > 3 && loaded === 0) setBad((b) => ({ ...b, [k]: true })); });
        l.on('tileload', () => { loaded++; });
        l.addTo(map);
        base.current[k] = l;
      }).catch(() => alive && setBad((b) => ({ ...b, [k]: true })));
    }
    return () => { alive = false; };
  }, [map, on, opacity]);
  useEffect(() => () => { base.current.temp?.remove(); base.current.wind?.remove(); }, []);

  const noForecast = timeline && !byTime.size;
  return { T, dir, lang, map, on, bad, toggle, opacity, setOpacity, frames, idx, setIdx, playing, setPlaying, usable, noForecast, timeline, guest: !profile };
}

type WxState = ReturnType<typeof useWeatherLayers>;

export function WeatherLayersPanel({ s }: { s: WxState }) {
  const { T } = s;
  const { t } = useI18n();
  const row = (k: Toggle, Icon: typeof Cloud, label: string) => (
    <WithTip key={k} tip={`info.wx.${k}`}>
    <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
      <input type="checkbox" className="size-4 accent-sky-600" data-weather-toggle={k} checked={s.on[k]} onChange={(e) => s.toggle(k, e.target.checked)} />
      <Icon className="size-4 text-slate-500" aria-hidden />
      <span className="flex-1">{label}{s.guest ? ' 🔒' : ''}</span>
      {s.bad[k] ? <span className="text-[11px] text-amber-600">⚠️ {T.unavailable}</span> : null}
    </label>
    </WithTip>
  );
  const active = Object.values(s.on).filter(Boolean).length;
  return (
    <LayerSection id="weather" icon={<Cloud className="size-4 text-slate-500" aria-hidden />} title={T.title} info={t('info.weather')} active={active}
      locked={s.guest || !hasFeature(undefined, 'weather')}>
      {row('clouds', Cloud, T.clouds)}{row('rain', CloudRain, T.rain)}{row('temp', Thermometer, T.temp)}{row('wind', Wind, T.wind)}
      {active ? (
        <label className="flex items-center gap-2 pt-1 text-xs text-slate-600 dark:text-slate-300">
          {T.opacity}
          <input type="range" min={0.2} max={1} step={0.05} value={s.opacity} onChange={(e) => s.setOpacity(Number(e.target.value))} className="flex-1 accent-sky-600" />
        </label>
      ) : null}
    </LayerSection>
  );
}

/** The timeline bar (bottom of the map) and the weather legend, shown while weather layers are on. */
export function WeatherOverlay({ s }: { s: WxState }) {
  const { T, map, frames, idx } = s;
  const container = map?.getContainer() ?? null;
  if (!container || !Object.values(s.on).some(Boolean)) return null;
  const f = idx >= 0 ? frames[idx] : null;
  const label = f
    ? `${new Intl.DateTimeFormat(s.lang === 'he' ? 'he-IL' : 'en-GB', { weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(f.time))} (${f.offsetH === 0 ? T.now : `${f.offsetH > 0 ? '+' : '−'}${Math.abs(f.offsetH)} ${T.h}`})`
    : '—';
  const nowIdx = frames.findIndex((x) => x.offsetH === 0);
  // These boxes sit inside the Leaflet container: without this, dragging the slider pans the map and the wheel zooms it.
  const isolate = (el: HTMLDivElement | null) => {
    if (!el) return;
    L.DomEvent.disableClickPropagation(el);
    L.DomEvent.disableScrollPropagation(el);
  };
  return createPortal(
    <div dir={s.dir} className="pointer-events-none absolute inset-x-2 bottom-8 z-[650] flex flex-col items-center gap-1.5">
      <div ref={isolate} className="pointer-events-auto rounded-lg bg-white/95 px-2.5 py-1.5 text-[11px] text-slate-700 shadow-lg ring-1 ring-slate-900/10 dark:bg-slate-900/95 dark:text-slate-200 dark:ring-white/10">
        {s.on.rain ? (
          <div className="flex items-center gap-1.5" dir="ltr">
            {RAIN_LEGEND.map(([c, v]) => <span key={c} className="inline-flex items-center gap-0.5"><span className="h-2.5 w-4 rounded-sm" style={{ background: c }} />{v}</span>)}
            <span>{T.mmh}</span>
          </div>
        ) : null}
        {s.on.temp ? <div className="mt-0.5 flex items-center gap-1" dir="ltr">−20°<span className="h-2 w-28 rounded" style={{ background: 'linear-gradient(90deg,#821692,#2a4ed8,#21b6d4,#a2e45a,#fbd13a,#f07a1e,#c4161c)' }} />40°C</div> : null}
        {s.on.wind ? <div className="mt-0.5 flex items-center gap-1" dir="ltr">0<span className="h-2 w-28 rounded" style={{ background: 'linear-gradient(90deg,rgba(238,206,206,0.3),#b364bc,#3f2db4,#2b1c8e)' }} />100+ {T.kmh}</div> : null}
        <p className="mt-0.5 text-[10px] text-slate-400">{T.credits}</p>
      </div>
      {s.timeline ? (
        <div ref={isolate} data-weather-timeline className="pointer-events-auto flex w-full max-w-xl items-center gap-2 rounded-xl bg-white/95 px-3 py-2 shadow-lg ring-1 ring-slate-900/10 dark:bg-slate-900/95 dark:text-slate-100 dark:ring-white/10">
          <button type="button" data-weather-play aria-label={s.playing ? T.pause : T.play} onClick={() => s.setPlaying(!s.playing)}
            className="grid size-8 shrink-0 place-items-center rounded-full bg-sky-600 text-white hover:bg-sky-700">
            {s.playing ? <Pause className="size-4" aria-hidden /> : <Play className="size-4" aria-hidden />}
          </button>
          <div className="relative flex-1" dir="ltr">
            <input type="range" min={0} max={frames.length - 1} step={1} value={Math.max(idx, 0)} aria-label={T.title}
              onChange={(e) => { s.setPlaying(false); s.setIdx(Number(e.target.value)); }} className="w-full accent-sky-600" />
            {nowIdx >= 0 ? <span className="pointer-events-none absolute -top-1 h-2 w-0.5 bg-sky-600" style={{ left: `${(nowIdx / (frames.length - 1)) * 100}%` }} /> : null}
          </div>
          <div className="w-36 shrink-0 text-end text-xs">
            <p className="font-semibold tabular-nums" data-weather-label>{label}</p>
            <p className="text-[10px] text-slate-500">{s.noForecast ? T.noForecast : f ? (f.kind === 'observed' ? T.observed : T.forecast) : ''}</p>
          </div>
        </div>
      ) : null}
    </div>,
    container,
  );
}
