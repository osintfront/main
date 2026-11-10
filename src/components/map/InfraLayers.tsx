// "Airfields & ports" in the Intelligence layers panel: OurAirports and the NGA World Port Index for the
// Middle East without Israel (static files built by tools/infra/build_infra.py), clustered, with popups.
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import L from 'leaflet';
import 'leaflet.markercluster';
import { Anchor, Plane } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { hasFeature } from '@/lib/plans';
import { openGate } from '@/components/plans/GateDialog';
import { supabase } from '@/integrations/supabase/client';
import { INFRA_TXT, airfieldPopup, clusterIconHtml, loadInfra, portPopup, type AirfieldClass, type AirfieldProps, type PortProps } from '@/lib/infra';

type Toggle = AirfieldClass | 'ports';
const CLASSES: AirfieldClass[] = ['civil', 'military', 'strip', 'closed'];
const COLORS: Record<Toggle, string> = { civil: '#0284c7', military: '#991b1b', strip: '#64748b', closed: '#9ca3af', ports: '#0f766e' };
const GLYPH: Record<Toggle, string> = { civil: '✈', military: '✈', strip: '•', closed: '✕', ports: '⚓' };

function icon(k: Toggle): L.DivIcon {
  const size = k === 'strip' ? 12 : 20;
  return L.divIcon({
    className: 'ofm-infra',
    iconSize: [size, size],
    html: `<span style="display:grid;place-items:center;width:${size}px;height:${size}px;border-radius:9999px;background:${COLORS[k]};color:#fff;font-size:${k === 'strip' ? 9 : 12}px;box-shadow:0 0 0 1.5px #fff">${GLYPH[k]}</span>`,
  });
}

export function useInfraLayers(map: L.Map | null, lang: string, dir: 'ltr' | 'rtl', live: { aircraft: () => void; ships: () => void }) {
  const he = lang === 'he';
  const T = INFRA_TXT[he ? 'he' : 'en'];
  const { profile } = useAuth();
  const [on, setOn] = useState<Record<Toggle, boolean>>({ civil: false, military: false, strip: false, closed: false, ports: false });
  const [bad, setBad] = useState<{ airfields?: boolean; ports?: boolean }>({});
  const [loaded, setLoaded] = useState<{ airfields?: GeoJSON.FeatureCollection; ports?: GeoJSON.FeatureCollection }>({});
  const liveRef = useRef(live);
  liveRef.current = live;

  const toggle = useCallback((k: Toggle, v: boolean) => {
    if (v && !profile) return openGate('signup', 'airfields_ports');
    if (v && !hasFeature(undefined, 'airfields_ports')) return openGate('upgrade', 'airfields_ports');
    setOn((cur) => ({ ...cur, [k]: v }));
  }, [profile]);

  // Load each file on first need.
  const wantAirfields = CLASSES.some((c) => on[c]);
  useEffect(() => {
    for (const [kind, want] of [['airfields', wantAirfields], ['ports', on.ports]] as const) {
      if (!want || loaded[kind]) continue;
      setBad((b) => ({ ...b, [kind]: false }));
      loadInfra(kind).then((fc) => setLoaded((cur) => ({ ...cur, [kind]: fc }))).catch(() => setBad((b) => ({ ...b, [kind]: true })));
    }
  }, [wantAirfields, on.ports, loaded]);

  // Popups: basics now, the nearest town (Hebrew in Hebrew) as soon as it is known, and the live-traffic button.
  const bindPopup = useCallback((marker: L.Marker, kind: 'airfield' | 'port', props: AirfieldProps | PortProps) => {
    const lg = he ? 'he' : 'en';
    const html = (near: string | null) => (kind === 'airfield' ? airfieldPopup(props as AirfieldProps, lg, near) : portPopup(props as PortProps, lg, near));
    marker.bindPopup(html(null), { maxWidth: 300 });
    marker.on('popupopen', (e) => {
      const wire = () => {
        const el = (e as L.PopupEvent).popup.getElement()?.querySelector<HTMLButtonElement>('[data-infra-traffic]');
        if (el) el.onclick = () => {
          if (kind === 'airfield') liveRef.current.aircraft();
          else liveRef.current.ships();
          map?.setView(marker.getLatLng(), 10);
        };
      };
      wire();
      if (!supabase) return;
      const { lat, lng } = marker.getLatLng();
      void supabase.rpc('geo_nearest_place', { p_lat: lat, p_lng: lng }).then(({ data }) => {
        const r = Array.isArray(data) ? data[0] : null;
        if (!r || !marker.isPopupOpen()) return;
        marker.setPopupContent(html((he ? r.name_he : r.name_en) || r.name));
        wire();
      });
    });
  }, [he, map]);

  // Markers: built once per file and language, re-filtered when toggles change.
  const groups = useRef<{ airfields?: L.MarkerClusterGroup; ports?: L.MarkerClusterGroup }>({});
  const markers = useRef<{ airfields: { k: AirfieldClass; m: L.Marker }[]; ports: L.Marker[] }>({ airfields: [], ports: [] });
  useEffect(() => {
    if (!map) return;
    const cluster = (color: string) => L.markerClusterGroup({
      maxClusterRadius: 40, showCoverageOnHover: false, disableClusteringAtZoom: 11, chunkedLoading: true,
      iconCreateFunction: (c) => {
        const n = c.getChildCount();
        const size = n < 10 ? 28 : n < 100 ? 32 : n < 1000 ? 36 : 40;
        return L.divIcon({ className: 'ofm-infra-cluster', iconSize: [size, size], html: clusterIconHtml(n, color) });
      },
    });
    if (loaded.airfields) {
      groups.current.airfields ??= cluster('#334155');
      markers.current.airfields = loaded.airfields.features.map((f) => {
        const p = f.properties as AirfieldProps;
        const [lng, lat] = (f.geometry as GeoJSON.Point).coordinates;
        const mk = L.marker([lat, lng], { icon: icon(p.k), title: p.n });
        bindPopup(mk, 'airfield', p);
        return { k: p.k, m: mk };
      });
    }
    if (loaded.ports) {
      groups.current.ports ??= cluster(COLORS.ports);
      markers.current.ports = loaded.ports.features.map((f) => {
        const p = f.properties as PortProps;
        const [lng, lat] = (f.geometry as GeoJSON.Point).coordinates;
        const mk = L.marker([lat, lng], { icon: icon('ports'), title: p.n });
        bindPopup(mk, 'port', p);
        return mk;
      });
    }
  }, [map, loaded, bindPopup]);

  useEffect(() => {
    if (!map) return;
    const a = groups.current.airfields;
    if (a) {
      a.clearLayers();
      a.addLayers(markers.current.airfields.filter((x) => on[x.k]).map((x) => x.m));
      if (wantAirfields) a.addTo(map); else a.remove();
    }
    const p = groups.current.ports;
    if (p) {
      p.clearLayers();
      if (on.ports) { p.addLayers(markers.current.ports); p.addTo(map); } else p.remove();
    }
  }, [map, on, wantAirfields, loaded, bindPopup]);
  useEffect(() => () => { groups.current.airfields?.remove(); groups.current.ports?.remove(); }, []);

  return { T, dir, on, bad, toggle, guest: !profile, any: wantAirfields || on.ports };
}

type InfraState = ReturnType<typeof useInfraLayers>;

export function InfraLayersPanel({ s, children }: { s: InfraState; children?: ReactNode }) {
  const { T } = s;
  const row = (k: Toggle, label: string) => {
    const failed = k === 'ports' ? s.bad.ports : s.bad.airfields;
    return (
      <label key={k} className="flex cursor-pointer items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
        <input type="checkbox" className="size-4 accent-sky-600" data-infra-toggle={k} checked={s.on[k]} onChange={(e) => s.toggle(k, e.target.checked)} />
        <span className="grid size-4 place-items-center rounded-full text-[9px] text-white" style={{ background: COLORS[k] }} aria-hidden>{GLYPH[k]}</span>
        <span className="flex-1">{label}{s.guest ? ' 🔒' : ''}</span>
        {failed && s.on[k] ? <span className="text-[11px] text-amber-600">⚠️ {T.unavailable}</span> : null}
      </label>
    );
  };
  return (
    <section className="space-y-2 border-b border-slate-100 py-3 dark:border-slate-800">
      <p className="flex items-center gap-2 text-sm font-semibold text-slate-800 dark:text-slate-100">
        <Plane className="size-4 text-slate-500" aria-hidden /><Anchor className="-ms-1 size-4 text-slate-500" aria-hidden />{T.title}
      </p>
      <div className="space-y-1.5 ps-6">
        {row('civil', T.civilToggle)}{row('military', T.militaryToggle)}{row('strip', T.stripToggle)}{row('closed', T.closedToggle)}{row('ports', T.ports)}
        {children}
      </div>
    </section>
  );
}

/** A small legend while any airfield/port toggle (or, through `extra`, a military-bases toggle) is on. */
export function InfraLegend({ s, extra, children }: { s: InfraState; extra?: boolean; children?: ReactNode }) {
  if (!s.any && !extra) return null;
  const { T } = s;
  const items: [Toggle, string][] = [['civil', T.civil], ['military', T.military], ['strip', T.strip], ['closed', T.closed], ['ports', T.ports]];
  return (
    <div dir={s.dir} className="pointer-events-auto absolute bottom-8 end-2 z-[600] max-w-[60%] rounded-lg bg-white/95 px-2.5 py-1.5 text-[11px] text-slate-700 shadow-lg ring-1 ring-slate-900/10 dark:bg-slate-900/95 dark:text-slate-200 dark:ring-white/10">
      {items.filter(([k]) => s.on[k]).map(([k, label]) => (
        <span key={k} className="me-2 inline-flex items-center gap-1">
          <span className="grid size-3.5 place-items-center rounded-full text-[8px] text-white" style={{ background: COLORS[k] }} aria-hidden>{GLYPH[k]}</span>{label}
        </span>
      ))}
      {children}
    </div>
  );
}
