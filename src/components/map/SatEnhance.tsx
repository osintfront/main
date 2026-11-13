// "Enhance ×4" in the Satellite section: pick a spot, the local satsr-worker super-resolves a 2.56 km
// Sentinel-2 box to 2.5 m, and the result is shown as an overlay with a before / after swipe.
// State lives in useSatEnhance (kept by IntelLayers while the panel is closed), like useWeatherLayers.
// The server decides who may ask (satsr_my_quota / satsr_request); hasFeature() is not enough here
// because it lets everyone through while plans are not enforced, and this feature is always paid.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import L from 'leaflet';
import { Download, Eye, EyeOff, Lock, Sparkles, X } from 'lucide-react';
import { useI18n } from '@/i18n';
import type { TranslationKey } from '@/i18n/en';
import { useAuth } from '@/hooks/useAuth';
import { openGate, openGateFor } from '@/components/plans/GateDialog';
import {
  anyOpen, availableProducts, cellBox, downloadName, jobMessageKey, swipeClips,
  type LatLng, type SatsrProduct, type SatsrView, type SatsrWhich,
} from '@/lib/satEnhance';
import {
  fetchMyEnhancements, fetchSatsrQuota, requestEnhance, resultDownloadUrl, resultUrl, type SatsrJob, type SatsrQuota,
} from '@/services/satEnhanceService';

const POLL_MS = 10_000;
const PANE_BEFORE = 'ofmSrA';
const PANE_AFTER = 'ofmSrB';

interface Msg { key: TranslationKey; vars?: Record<string, string | number>; plans?: boolean }

/** The overlay panes: inside leaflet-rotate's rotating pane, just above the satellite layer's panes (250/251). */
function srPanes(map: L.Map): { a: HTMLElement; b: HTMLElement } {
  const parent = map.getPane('rotatePane') ?? undefined;
  const a = map.getPane(PANE_BEFORE) ?? map.createPane(PANE_BEFORE, parent);
  const b = map.getPane(PANE_AFTER) ?? map.createPane(PANE_AFTER, parent);
  a.style.zIndex = '252';
  b.style.zIndex = '253';
  a.style.pointerEvents = 'none';
  b.style.pointerEvents = 'none';
  return { a, b };
}

/**
 * @param date the satellite layer's day when it shows a Sentinel-2 picture (enhanceDate), else null = newest clear
 * @param active the Intelligence panel is open (quota and list are loaded then, not on every page view)
 */
export function useSatEnhance(map: L.Map | null, date: string | null, active: boolean) {
  const { profile } = useAuth();
  const [quota, setQuota] = useState<SatsrQuota | null>(null);
  const [jobs, setJobs] = useState<SatsrJob[]>([]);
  const [picking, setPicking] = useState(false);
  const [pending, setPending] = useState<LatLng | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg | null>(null);
  const [lastReq, setLastReq] = useState<string | null>(null);
  const [awaiting, setAwaiting] = useState<string | null>(null);
  const [shownId, setShownId] = useState<string | null>(null);
  const [product, setProduct] = useState<SatsrProduct>('tci');
  const [view, setView] = useState<SatsrView>('swipe');
  const [opacity, setOpacity] = useState(1);
  const [swipe, setSwipe] = useState(0.5);
  const [urls, setUrls] = useState<{ key: string; sr: string | null; lr: string | null } | null>(null);

  const refresh = useCallback(async () => {
    const [q, list] = await Promise.all([
      fetchSatsrQuota(),
      profile ? fetchMyEnhancements().catch(() => null) : Promise.resolve([] as SatsrJob[]),
    ]);
    if (q) setQuota(q);
    if (list) setJobs(list);
  }, [profile]);

  const open = anyOpen(jobs);
  useEffect(() => {
    if (active || open) void refresh();
  }, [active, refresh]); // eslint-disable-line react-hooks/exhaustive-deps
  // While a job is on its way: ask again every 10 s (not while the tab is hidden).
  useEffect(() => {
    if (!open) return;
    const t = window.setInterval(() => { if (!document.hidden) void refresh(); }, POLL_MS);
    return () => window.clearInterval(t);
  }, [open, refresh]);
  // Signed out: forget everything that belonged to the account.
  useEffect(() => {
    if (profile) return;
    setJobs([]); setShownId(null); setAwaiting(null); setLastReq(null); setPending(null); setPicking(false);
  }, [profile]);

  // The job we were waiting for is done → show it.
  useEffect(() => {
    if (!awaiting) return;
    const j = jobs.find((x) => x.requestId === awaiting);
    if (!j) return;
    if (j.status === 'done') { setShownId(j.requestId); setAwaiting(null); }
    else if (j.status === 'failed') setAwaiting(null);
  }, [jobs, awaiting]);

  const start = useCallback(async () => {
    setMsg(null);
    if (!profile) return openGate('signup', 'sat_enhance');
    const q = quota ?? (await fetchSatsrQuota());
    if (q) setQuota(q);
    if (!q?.signedIn) return openGate('signup', 'sat_enhance');
    if (!q.enabled) return openGate('upgrade', 'sat_enhance', 'plan');
    setPending(null);
    setPicking(true);
  }, [profile, quota]);
  const cancel = useCallback(() => { setPicking(false); setPending(null); }, []);

  // Pick mode: crosshair, a dashed square following the mouse, a click marks the spot.
  useEffect(() => {
    if (!map || !picking) return;
    const el = map.getContainer();
    const prev = el.style.cursor;
    el.style.cursor = 'crosshair';
    const c = map.getCenter();
    const rect = L.rectangle(cellBox(c.lat, c.lng), { color: '#7c3aed', weight: 2, dashArray: '6 4', fillOpacity: 0.06, interactive: false });
    let shown = false;
    const move = (e: L.LeafletMouseEvent) => {
      rect.setBounds(L.latLngBounds(cellBox(e.latlng.lat, e.latlng.lng)));
      if (!shown) { rect.addTo(map); shown = true; }
    };
    const click = (e: L.LeafletMouseEvent) => {
      setPending({ lat: e.latlng.lat, lng: e.latlng.lng });
      setPicking(false);
    };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') setPicking(false); };
    map.on('mousemove', move);
    map.on('click', click);
    document.addEventListener('keydown', key);
    return () => {
      el.style.cursor = prev;
      rect.remove();
      map.off('mousemove', move);
      map.off('click', click);
      document.removeEventListener('keydown', key);
    };
  }, [map, picking]);

  // The marked square, until confirmed or cancelled.
  useEffect(() => {
    if (!map || !pending) return;
    const rect = L.rectangle(cellBox(pending.lat, pending.lng), { color: '#7c3aed', weight: 2, fillOpacity: 0.12, interactive: false }).addTo(map);
    return () => void rect.remove();
  }, [map, pending]);

  const confirm = useCallback(async () => {
    if (!pending || busy) return;
    setBusy(true);
    setMsg(null);
    try {
      const r = await requestEnhance(pending.lat, pending.lng, date);
      if (r.ok && r.requestId) {
        setPending(null);
        setLastReq(r.requestId);
        setAwaiting(r.requestId);
        if (r.cacheHit) setMsg({ key: 'satsr.cached' });
        await refresh();
        return;
      }
      if (r.reason === 'signup_required' || r.reason === 'not_in_plan') return void openGateFor(r.reason, 'sat_enhance');
      if (r.reason === 'quota_exceeded') return setMsg({ key: 'satsr.quota', vars: { limit: r.limit ?? 0 }, plans: true });
      if (r.reason === 'busy') return setMsg({ key: 'satsr.busy' });
      if (r.reason === 'bad_input') return setMsg({ key: 'satsr.badInput' });
      setMsg({ key: 'satsr.error' });
    } finally {
      setBusy(false);
    }
  }, [pending, busy, date, refresh]);

  const shown = useMemo(() => jobs.find((j) => j.requestId === shownId && j.status === 'done' && j.bounds) ?? null, [jobs, shownId]);
  const products = useMemo(() => availableProducts(shown?.products), [shown]);
  const shownProduct: SatsrProduct | null = products.includes(product) ? product : products[0] ?? null;
  const current = jobs.find((j) => j.requestId === (awaiting ?? lastReq)) ?? null;

  // A result picked from the list that is off screen: go there.
  const shownJobId = shown?.jobId;
  useEffect(() => {
    if (!map || !shown?.bounds) return;
    const b = L.latLngBounds(shown.bounds);
    if (!map.getBounds().contains(b)) map.flyToBounds(b, { maxZoom: 15, duration: 0.8 });
  }, [map, shownJobId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Signed links for the shown product (private bucket, 1 hour).
  useEffect(() => {
    const paths = shown && shownProduct ? shown.products?.[shownProduct] : null;
    if (!shown || !shownProduct || !paths?.sr || !paths.lr) return setUrls(null);
    let alive = true;
    void Promise.all([resultUrl(paths.sr), resultUrl(paths.lr)]).then(([sr, lr]) => {
      if (alive) setUrls({ key: `${shown.jobId}:${shownProduct}`, sr, lr });
    });
    return () => { alive = false; };
  }, [shown, shownProduct]);

  // The overlays: original (pixelated, 10 m) in pane A, enhanced in pane B.
  const panesRef = useRef<{ a: HTMLElement; b: HTMLElement } | null>(null);
  const layersRef = useRef<{ lr: L.ImageOverlay; sr: L.ImageOverlay } | null>(null);
  useEffect(() => {
    if (map && !panesRef.current) panesRef.current = srPanes(map);
  }, [map]);
  useEffect(() => {
    if (!map || !shown?.bounds || !urls?.sr || !urls.lr) return;
    const b = L.latLngBounds(shown.bounds);
    const lr = L.imageOverlay(urls.lr, b, { pane: PANE_BEFORE, opacity, interactive: false, className: 'ofm-sr-before' });
    const sr = L.imageOverlay(urls.sr, b, { pane: PANE_AFTER, opacity, interactive: false, className: 'ofm-sr-after', attribution: 'Copernicus Sentinel · SEN2SR' });
    if (view !== 'after') {
      lr.addTo(map);
      const img = lr.getElement();
      if (img) img.style.imageRendering = 'pixelated';
    }
    if (view !== 'before') sr.addTo(map);
    layersRef.current = { lr, sr };
    return () => {
      lr.remove();
      sr.remove();
      layersRef.current = null;
    };
  }, [map, shown?.bounds, urls, view]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    layersRef.current?.lr.setOpacity(opacity);
    layersRef.current?.sr.setOpacity(opacity);
  }, [opacity]);

  // The swipe: original left of the line, enhanced right of it — on screen, whatever the map's bearing.
  useEffect(() => {
    const panes = panesRef.current;
    if (!map || !panes) return;
    const clear = () => { panes.a.style.clipPath = ''; panes.b.style.clipPath = ''; };
    if (!shown || view !== 'swipe') return clear();
    const update = () => {
      const size = map.getSize();
      const c = swipeClips(size.x, size.y, swipe, (p) => {
        const l = map.containerPointToLayerPoint(L.point(p.x, p.y));
        return { x: l.x, y: l.y };
      });
      panes.a.style.clipPath = c.before;
      panes.b.style.clipPath = c.after;
    };
    update();
    map.on('move zoom zoomend resize viewreset rotate', update);
    return () => {
      map.off('move zoom zoomend resize viewreset rotate', update);
      clear();
    };
  }, [map, shown, view, swipe]);

  const download = useCallback(async (which: SatsrWhich) => {
    const path = shown && shownProduct ? shown.products?.[shownProduct]?.[which] : null;
    if (!shown || !shownProduct || !path) return;
    const url = await resultDownloadUrl(path, downloadName(shown, shownProduct, which));
    if (!url) return;
    const a = document.createElement('a');
    a.href = url;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
  }, [shown, shownProduct]);

  const toggleShown = useCallback((requestId: string) => setShownId((cur) => (cur === requestId ? null : requestId)), []);

  return {
    map, profile, quota, jobs, picking, pending, busy, msg, current, date, start, cancel, confirm,
    shown, products, product: shownProduct, setProduct, view, setView, opacity, setOpacity, swipe, setSwipe,
    toggleShown, close: () => setShownId(null), download,
  };
}

export type SatEnhanceState = ReturnType<typeof useSatEnhance>;

const btn = 'inline-flex items-center justify-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold';
const seg = (on: boolean) => `${btn} flex-1 ${on ? 'bg-violet-600 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700'}`;

/** The button, today's count, the pick / confirm steps, the status line and my recent results. */
export function SatEnhancePanel({ s }: { s: SatEnhanceState }) {
  const { t, locale } = useI18n();
  const q = s.quota;
  const locked = !s.profile || (q !== null && !q.enabled);
  const left = q && q.enabled && !q.staff && q.limit != null ? t('gate.left', { n: Math.max(q.limit - q.used, 0), limit: q.limit }) : null;
  const status = s.current ? jobMessageKey(s.current, !!q?.workerOnline) : null;
  const recent = s.jobs.slice(0, 5);
  const when = (iso: string) => new Date(iso).toLocaleString(locale, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  return (
    <div className="space-y-1.5 ps-6 text-xs text-slate-600 dark:text-slate-300" data-satsr-panel>
      <div className="flex items-center gap-2">
        <button type="button" onClick={() => void s.start()} disabled={s.busy || s.picking} data-satsr-start
          className={`${btn} bg-violet-600 py-1.5 text-white hover:bg-violet-700 disabled:opacity-60`}>
          {locked ? <Lock className="size-3.5" aria-hidden /> : <Sparkles className="size-3.5" aria-hidden />}
          {t('satsr.button')}
        </button>
        {left ? <span className="text-[11px] text-slate-500">{left}</span> : null}
      </div>
      {s.picking ? (
        <p className="flex items-center gap-2 font-semibold text-violet-700 dark:text-violet-300">
          {t('satsr.pick')}
          <button type="button" onClick={s.cancel} className="font-normal text-slate-500 hover:underline">{t('common.cancel')}</button>
        </p>
      ) : null}
      {s.pending ? (
        <div className="space-y-1 rounded-lg bg-violet-50 p-2 dark:bg-violet-500/10">
          <p>{s.date ? t('satsr.forDate', { date: s.date }) : t('satsr.newest')}</p>
          <div className="flex gap-1.5">
            <button type="button" onClick={() => void s.confirm()} disabled={s.busy} data-satsr-confirm
              className={`${btn} flex-1 bg-violet-600 py-1.5 text-white hover:bg-violet-700 disabled:opacity-60`}>{t('satsr.confirm')}</button>
            <button type="button" onClick={s.cancel} className={`${btn} bg-white text-slate-700 ring-1 ring-slate-200 dark:bg-slate-900 dark:text-slate-200 dark:ring-slate-700`}>{t('common.cancel')}</button>
          </div>
        </div>
      ) : null}
      {s.msg ? (
        <p className="text-amber-700 dark:text-amber-400" role="status">
          {t(s.msg.key, s.msg.vars)}
          {s.msg.plans ? <> <Link to="/packages" className="font-semibold text-sky-700 hover:underline dark:text-sky-400">{t('gate.plans')}</Link></> : null}
        </p>
      ) : null}
      {status && s.current?.status !== 'done' ? (
        <p role="status" className={s.current?.status === 'failed' ? 'text-red-600' : s.current?.status === 'queued' && !q?.workerOnline ? 'text-amber-700 dark:text-amber-400' : ''}>
          {t(status.key, status.vars)}
        </p>
      ) : null}
      {recent.length ? (
        <div className="pt-1">
          <p className="mb-0.5 text-[11px] font-semibold text-slate-500">{t('satsr.recent')}</p>
          <ul className="space-y-0.5">
            {recent.map((j) => {
              const m = jobMessageKey(j, !!q?.workerOnline);
              const on = s.shown?.requestId === j.requestId;
              return (
                <li key={j.requestId} className="flex items-center gap-1.5">
                  <span className="min-w-0 flex-1 truncate" title={`${j.lat.toFixed(4)}, ${j.lng.toFixed(4)}`}>
                    {j.sceneDate ?? j.requestedDate ?? when(j.createdAt)} · <span className="text-slate-500">{t(m.key, m.vars)}</span>
                  </span>
                  {j.status === 'done' && j.bounds ? (
                    <button type="button" onClick={() => s.toggleShown(j.requestId)} aria-pressed={on}
                      className="inline-flex shrink-0 items-center gap-1 font-semibold text-sky-700 hover:underline dark:text-sky-400">
                      {on ? <EyeOff className="size-3.5" aria-hidden /> : <Eye className="size-3.5" aria-hidden />}
                      {on ? t('satsr.hide') : t('satsr.show')}
                    </button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

const NDVI_GRADIENT = 'linear-gradient(90deg,#2166ac,#8c6e50 20%,#dec484 40%,#d9ef8b 52%,#91cf60 65%,#1a9850 78%,#00441b)';

/** While a result is shown: its card (product, before / swipe / after, opacity, download, caveat) and the swipe line. */
export function SatEnhanceOverlay({ s }: { s: SatEnhanceState }) {
  const { t, dir } = useI18n();
  const map = s.map;
  const container = map?.getContainer() ?? null;
  const setSwipe = s.setSwipe;
  const dividerCb = useCallback((el: HTMLDivElement | null) => {
    if (!el || !map) return;
    L.DomEvent.disableClickPropagation(el);
    L.DomEvent.disableScrollPropagation(el);
    el.addEventListener('pointerdown', (e: PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const box = map.getContainer().getBoundingClientRect();
      const move = (ev: PointerEvent) => setSwipe(Math.min(0.98, Math.max(0.02, (ev.clientX - box.left) / box.width)));
      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        map.dragging.enable();
      };
      map.dragging.disable();
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    });
  }, [map, setSwipe]);
  const isolate = (el: HTMLDivElement | null) => {
    if (!el) return;
    L.DomEvent.disableClickPropagation(el);
    L.DomEvent.disableScrollPropagation(el);
  };
  const job = s.shown;
  if (!container || !job) return null;
  return createPortal(
    <>
      {s.view === 'swipe' ? (
        <div ref={dividerCb} data-satsr-divider
          className="absolute inset-y-0 z-[641] w-1 -translate-x-1/2 cursor-ew-resize bg-violet-200/90 shadow-[0_0_0_1px_rgba(76,29,149,0.5)]"
          style={{ left: `${s.swipe * 100}%`, touchAction: 'none' }}
          role="slider" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(s.swipe * 100)} aria-label={t('satsr.swipeHint')}>
          <span style={{ left: '50%' }} className="absolute top-[62%] grid size-7 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-violet-600 text-xs font-bold text-white shadow ring-2 ring-white">⇆</span>
          <span style={{ right: 8 }} className="absolute bottom-10 rounded bg-violet-900/85 px-1.5 py-0.5 text-[10px] font-semibold whitespace-nowrap text-white">{t('satsr.before')} · 10 m</span>
          <span style={{ left: 8 }} className="absolute bottom-10 rounded bg-violet-900/85 px-1.5 py-0.5 text-[10px] font-semibold whitespace-nowrap text-white">{t('satsr.after')} · 2.5 m</span>
        </div>
      ) : null}
      <div ref={isolate} dir={dir} data-satsr-overlay
        className="absolute end-3 top-16 z-[650] w-72 max-w-[calc(100vw-24px)] space-y-2 rounded-xl bg-white/95 p-3 text-xs text-slate-700 shadow-xl ring-1 ring-slate-900/10 backdrop-blur dark:bg-slate-900/95 dark:text-slate-200 dark:ring-white/10">
        <div className="flex items-start gap-2">
          <Sparkles className="mt-0.5 size-4 shrink-0 text-violet-600" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold text-slate-900 dark:text-white">{t('satsr.title')}</p>
            <p className="text-[11px] text-slate-500">
              {t('satsr.scene', { date: job.sceneDate ?? '—', cloud: job.cloudPct != null ? Math.round(job.cloudPct * 10) / 10 : '—' })}
            </p>
          </div>
          <button type="button" onClick={s.close} aria-label={t('common.close')} className="inline-flex size-7 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800">
            <X className="size-4" aria-hidden />
          </button>
        </div>
        {s.products.length > 1 ? (
          <div className="flex gap-1" role="group" aria-label={t('satsr.productLabel')}>
            {s.products.map((p) => (
              <button key={p} type="button" onClick={() => s.setProduct(p)} aria-pressed={s.product === p} className={seg(s.product === p)}>
                {t(`satsr.product.${p}` as TranslationKey)}
              </button>
            ))}
          </div>
        ) : null}
        <div className="flex gap-1" role="group" aria-label={t('satsr.view')}>
          {(['before', 'swipe', 'after'] as const).map((v) => (
            <button key={v} type="button" onClick={() => s.setView(v)} aria-pressed={s.view === v} className={seg(s.view === v)}>
              {t(`satsr.${v}` as TranslationKey)}
            </button>
          ))}
        </div>
        {s.view === 'swipe' ? <p className="text-[11px] text-slate-500">{t('satsr.swipeHint')}</p> : null}
        <label className="flex items-center gap-2">
          {t('satsr.opacity')}
          <input type="range" min={0.2} max={1} step={0.05} value={s.opacity} onChange={(e) => s.setOpacity(Number(e.target.value))} className="flex-1 accent-violet-600" />
        </label>
        {s.product === 'ndvi' ? (
          <div>
            <span className="block h-2 rounded" style={{ background: NDVI_GRADIENT }} />
            <span className="mt-0.5 flex justify-between text-[10px] text-slate-500">
              <span>{t('satsr.legend.water')}</span><span>{t('satsr.legend.bare')}</span><span>{t('satsr.legend.veg')}</span>
            </span>
          </div>
        ) : null}
        <div className="flex items-center gap-1.5">
          <Download className="size-3.5 shrink-0 text-slate-500" aria-hidden />
          <button type="button" onClick={() => void s.download('lr')} className={`${btn} flex-1 bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-200`}>{t('satsr.downloadBefore')}</button>
          <button type="button" onClick={() => void s.download('sr')} className={`${btn} flex-1 bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-200`}>{t('satsr.downloadAfter')}</button>
        </div>
        <p className="rounded-lg bg-amber-50 p-2 text-[11px] leading-snug text-amber-800 dark:bg-amber-500/10 dark:text-amber-300">{t('satsr.caveat')}</p>
        <p className="text-[10px] text-slate-400">{t('satsr.credit')}</p>
      </div>
    </>,
    container,
  );
}
