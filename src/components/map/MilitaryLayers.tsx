// "Military bases" inside the "Airfields & ports" section: OpenStreetMap + Wikidata sites for the Middle East
// without Israel (static files built by tools/military/build_military.py), square clustered markers, foreign
// operators ringed in gold with their flag. Bunkers & checkpoints load on demand and draw from zoom 11.
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet.markercluster';
import { Shield } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { hasFeature } from '@/lib/plans';
import { openGate } from '@/components/plans/GateDialog';
import { LayerSection } from './LayerSection';
import { useI18n } from '@/i18n';
import { supabase } from '@/integrations/supabase/client';
import { clusterIconHtml, isNotBuilt, loadInfra } from '@/lib/infra';
import { MilitaryMarkers, foreignShown } from '@/lib/militaryMarkers';
import { FOREIGN_RING, MIL_COLORS, MIL_GLYPH, MIL_TXT, flag, milName, militaryPopup, type MilKind, type MilProps } from '@/lib/military';

const KINDS: MilKind[] = ['base', 'naval', 'range', 'minor'];
const MAIN_KINDS: MilKind[] = ['base', 'naval', 'range'];
const MINOR_ZOOM = 11;
type Status = 'unavailable' | 'notBuilt';

function icon(p: MilProps): L.DivIcon {
  const size = p.k === 'minor' ? 10 : 18;
  const ring = p.f ? `0 0 0 1px #fff,0 0 0 3px ${FOREIGN_RING}` : '0 0 0 1.5px #fff';
  const badge = p.f && flag(p.op)
    ? `<span style="position:absolute;top:-9px;right:-11px;font-size:11px;line-height:1">${flag(p.op)}</span>` : '';
  return L.divIcon({
    className: p.f ? 'ofm-mil ofm-mil-foreign' : 'ofm-mil',
    iconSize: [size, size],
    html: `<span style="position:relative;display:grid;place-items:center;width:${size}px;height:${size}px;border-radius:3px;background:${MIL_COLORS[p.k]};`
      + `color:#fff;font-size:11px;line-height:1;box-shadow:${ring}">${MIL_GLYPH[p.k]}${badge}</span>`,
  });
}

function cluster(color: string): L.MarkerClusterGroup {
  return L.markerClusterGroup({
    maxClusterRadius: 40, showCoverageOnHover: false, disableClusteringAtZoom: 12, chunkedLoading: true,
    iconCreateFunction: (c) => {
      const n = c.getChildCount();
      const size = n < 10 ? 28 : n < 100 ? 32 : n < 1000 ? 36 : 40;
      return L.divIcon({ className: 'ofm-mil-cluster', iconSize: [size, size], html: clusterIconHtml(n, color) });
    },
  });
}

export function useMilitaryLayers(map: L.Map | null, lang: string, dir: 'ltr' | 'rtl') {
  const he = lang === 'he';
  const T = MIL_TXT[he ? 'he' : 'en'];
  const { profile } = useAuth();
  const [on, setOn] = useState<Record<MilKind, boolean>>({ base: false, naval: false, range: false, minor: false });
  const [foreignOnly, setForeignOnlyState] = useState(false);
  const [status, setStatus] = useState<{ main?: Status; minor?: Status }>({});
  const [loaded, setLoaded] = useState<{ main?: GeoJSON.FeatureCollection; minor?: GeoJSON.FeatureCollection }>({});
  const [zoomOk, setZoomOk] = useState(false);

  useEffect(() => {
    if (!map) return;
    const f = () => setZoomOk(map.getZoom() >= MINOR_ZOOM);
    f();
    map.on('zoomend', f);
    return () => { map.off('zoomend', f); };
  }, [map]);

  const allowed = useCallback((v: boolean) => {
    if (v && !profile) { openGate('signup', 'military_assets'); return false; }
    if (v && !hasFeature(undefined, 'military_assets')) { openGate('upgrade', 'military_assets'); return false; }
    return true;
  }, [profile]);
  const toggle = useCallback((k: MilKind, v: boolean) => { if (allowed(v)) setOn((cur) => ({ ...cur, [k]: v })); }, [allowed]);
  const setForeignOnly = useCallback((v: boolean) => { if (allowed(v)) setForeignOnlyState(v); }, [allowed]);

  // Each file on first need; a 404 means the data workflow has not run yet.
  const wantMain = MAIN_KINDS.some((k) => on[k]);
  useEffect(() => {
    for (const [key, file, want] of [['main', 'military', wantMain], ['minor', 'military-minor', on.minor]] as const) {
      if (!want || loaded[key]) continue;
      setStatus((s) => ({ ...s, [key]: undefined }));
      loadInfra(file)
        .then((fc) => setLoaded((cur) => ({ ...cur, [key]: fc })))
        .catch((e) => setStatus((s) => ({ ...s, [key]: isNotBuilt(e) ? 'notBuilt' : 'unavailable' })));
    }
  }, [wantMain, on.minor, loaded]);

  // Popup now, the nearest town (Hebrew in Hebrew) as soon as it is known.
  const bindPopup = useCallback((mk: L.Marker, p: MilProps) => {
    const lg = he ? 'he' : 'en';
    const { lat, lng } = mk.getLatLng();
    const html = (near: string | null) => militaryPopup(p, lg, near, lat, lng);
    mk.bindPopup(html(null), { maxWidth: 300 });
    mk.on('popupopen', () => {
      if (!supabase) return;
      void supabase.rpc('geo_nearest_place', { p_lat: lat, p_lng: lng }).then(({ data }) => {
        const r = Array.isArray(data) ? data[0] : null;
        if (!r || !mk.isPopupOpen()) return;
        mk.setPopupContent(html((he ? r.name_he : r.name_en) || r.name));
      });
    });
  }, [he]);

  // Markers: built per file (and again on a language change); a group is refilled only when its own inputs change.
  const ctrl = useRef<MilitaryMarkers<L.Marker> | null>(null);
  ctrl.current ??= new MilitaryMarkers<L.Marker>((k) => cluster(MIL_COLORS[k]));
  const build = useCallback((fc: GeoJSON.FeatureCollection, kinds: MilKind[]) => {
    const list = [];
    for (const feat of fc.features) {
      const p = feat.properties as MilProps;
      if (!kinds.includes(p.k)) continue;
      const [lng, lat] = (feat.geometry as GeoJSON.Point).coordinates;
      const mk = L.marker([lat, lng], { icon: icon(p), title: milName(p, he ? 'he' : 'en') ?? '' });
      bindPopup(mk, p);
      list.push({ k: p.k, f: !!p.f, m: mk });
    }
    ctrl.current!.setMarkers(kinds, list);
  }, [bindPopup, he]);
  const [built, setBuilt] = useState(0);
  useEffect(() => { if (loaded.main) { build(loaded.main, MAIN_KINDS); setBuilt((n) => n + 1); } }, [loaded.main, build]);
  useEffect(() => { if (loaded.minor) { build(loaded.minor, ['minor']); setBuilt((n) => n + 1); } }, [loaded.minor, build]);
  useEffect(() => {
    if (map) ctrl.current!.apply({ on, foreignOnly, zoomOk }, map);
  }, [map, on, foreignOnly, zoomOk, built]);
  useEffect(() => () => ctrl.current?.removeAll(), []);

  const anyForeign = useMemo(() => foreignShown([loaded.main, loaded.minor], on), [loaded, on]);
  return { T, dir, on, foreignOnly, setForeignOnly, toggle, status, zoomOk, guest: !profile, any: KINDS.some((k) => on[k]), anyForeign };
}

type MilState = ReturnType<typeof useMilitaryLayers>;

function Swatch({ k, size = 16 }: { k: MilKind; size?: number }) {
  return (
    <span className="grid shrink-0 place-items-center rounded-[3px] text-[9px] text-white" aria-hidden
      style={{ width: size, height: size, background: MIL_COLORS[k] }}>{MIL_GLYPH[k]}</span>
  );
}

/** The "Military bases" toggles: their own collapsible section of the Intelligence panel. */
export function MilitaryLayersGroup({ s }: { s: MilState }) {
  const { T } = s;
  const { t } = useI18n();
  const row = (k: MilKind) => {
    const st = k === 'minor' ? s.status.minor : s.status.main;
    return (
      <Fragment key={k}>
        <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
          <input type="checkbox" className="size-4 accent-sky-600" data-mil-toggle={k} checked={s.on[k]} onChange={(e) => s.toggle(k, e.target.checked)} />
          <Swatch k={k} />
          <span className="flex-1">{T[k]}{s.guest ? ' 🔒' : ''}</span>
          {st && s.on[k] ? <span className="text-[11px] text-amber-600">⚠️ {st === 'notBuilt' ? T.notBuilt : T.unavailable}</span> : null}
        </label>
        {k === 'minor' && s.on.minor && !s.zoomOk && !st
          ? <p data-mil-zoom-hint className="ps-6 text-[11px] text-slate-500 dark:text-slate-400">{T.zoomIn}</p> : null}
      </Fragment>
    );
  };
  return (
    <LayerSection id="military" icon={<Shield className="size-4 text-slate-500" aria-hidden />} title={T.title} info={t('info.military')}
      active={KINDS.filter((k) => s.on[k]).length + (s.foreignOnly ? 1 : 0)} locked={s.guest || !hasFeature(undefined, 'military_assets')}>
      {(['base', 'naval', 'range', 'minor'] as MilKind[]).map(row)}
      <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
        <input type="checkbox" className="size-4 accent-amber-500" data-mil-foreign checked={s.foreignOnly} onChange={(e) => s.setForeignOnly(e.target.checked)} />
        <span className="size-4 shrink-0 rounded-[3px] bg-slate-200 dark:bg-slate-700" aria-hidden style={{ boxShadow: `0 0 0 2px ${FOREIGN_RING}` }} />
        <span className="flex-1">{T.foreignOnly}{s.guest ? ' 🔒' : ''}</span>
      </label>
    </LayerSection>
  );
}

/** Legend entries for the kinds that are on, plus "Foreign-operated" when a foreign site is shown. */
export function MilitaryLegendItems({ s }: { s: MilState }) {
  const { T } = s;
  return (
    <>
      {KINDS.filter((k) => s.on[k]).map((k) => (
        <span key={k} className="me-2 inline-flex items-center gap-1"><Swatch k={k} size={14} />{T.kind[k]}</span>
      ))}
      {s.anyForeign ? (
        <span className="me-2 inline-flex items-center gap-1">
          <span className="size-3.5 rounded-[3px] bg-slate-300" aria-hidden style={{ boxShadow: `0 0 0 2px ${FOREIGN_RING}` }} />{T.foreign}
        </span>
      ) : null}
    </>
  );
}
