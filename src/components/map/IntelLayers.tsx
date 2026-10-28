import { hasFeature } from '@/lib/plans';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import L from 'leaflet';
import { Plane as PlaneIcon, RefreshCw, Satellite, Ship, X } from 'lucide-react';
import { useI18n } from '@/i18n';
import { AreaLayersPanel, useAreaLayers } from './areaLayers';
import {
  EMERGENCY_SQUAWKS, SAT_SOURCES, SHIP_COLORS, SHIP_KINDS, fetchPlanes, fetchVessels, satDays, satKey, satTiles, shipFlag, shipKind,
  type Plane, type SatDay, type SatSource, type ShipKind, type Vessel,
} from '@/lib/intelLayers';

// Texts of this panel (Hebrew / English).
const TXT = {
  he: {
    title: 'שכבות מודיעין', close: 'סגירה', refresh: 'רענון לאזור הנוכחי', loading: 'טוען…', none: 'אין תמונות לאזור הזה בתקופה',
    sat: 'תמונת לוויין', source: 'מקור', s2: 'Sentinel-2 · 10 מ׳ (Copernicus)', hlss30: 'Sentinel-2 · 30 מ׳ (NASA HLS)', hlsl30: 'Landsat · 30 מ׳ (NASA HLS)', viirs: 'VIIRS · יומי, 375 מ׳ (NASA)',
    s2Off: 'לא מחובר — צריך מפתח Copernicus', single: 'תאריך אחד', compare: 'לפני / אחרי', date: 'תאריך', before: 'לפני', after: 'אחרי', cloud: 'עננות',
    zoomIn: 'התקרבו (זום 8 ומעלה) כדי לראות את Sentinel-2', swipeHint: 'גררו את הקו במפה כדי להשוות', fires: 'שריפות ומוקדי חום (NASA FIRMS) ליום הנבחר',
    ships: 'אוניות (AIS)', kinds: 'סוג', flag: 'דגל', allFlags: 'כל הדגלים', moving: 'רק בתנועה', search: 'שם / MMSI', age: 'עדכון אחרון',
    h1: 'שעה', h3: '3 שעות', h12: '12 שעות', shown: 'מוצגות', noShips: 'אין נתוני אוניות עדיין (המאסף לא פעיל?)',
    cargo: 'מטען', tanker: 'מכלית', passenger: 'נוסעים', fishing: 'דיג', military: 'צבאי / אכיפה', service: 'גוררת / שירות', pleasure: 'פנאי / מפרשית', fast: 'מהירה', other: 'אחר / לא ידוע',
    planes: 'מטוסים (ADS-B)', milOnly: 'רק צבאיים', milWorld: 'צבאיים בכל העולם', emergency: 'רק מצוקה (7500/7600/7700)', alt: 'גובה', altAll: 'הכול',
    planeCivil: 'אזרחי', planeMil: 'צבאי', planeEmergency: 'מצוקה', altGround: 'על הקרקע', altLow: 'עד 10,000 רגל', altMid: '10,000–30,000', altHigh: 'מעל 30,000', planeSearch: 'אות קריאה / סוג / רישום', radius: 'רדיוס 250 מייל ימי סביב מרכז המפה',
    speed: 'מהירות', course: 'כיוון', dest: 'יעד', seen: 'נראה', type: 'סוג', length: 'אורך', status: 'מצב', altitude: 'גובה', squawk: 'קוד', reg: 'רישום',
    error: 'שגיאה בטעינה',
  },
  en: {
    title: 'Intelligence layers', close: 'Close', refresh: 'Refresh for this area', loading: 'Loading…', none: 'No pictures of this area in the period',
    sat: 'Satellite picture', source: 'Source', s2: 'Sentinel-2 · 10 m (Copernicus)', hlss30: 'Sentinel-2 · 30 m (NASA HLS)', hlsl30: 'Landsat · 30 m (NASA HLS)', viirs: 'VIIRS · daily, 375 m (NASA)',
    s2Off: 'Not connected — needs a Copernicus key', single: 'One date', compare: 'Before / after', date: 'Date', before: 'Before', after: 'After', cloud: 'cloud',
    zoomIn: 'Zoom in (level 8+) to see Sentinel-2', swipeHint: 'Drag the line on the map to compare', fires: 'Fires and hot spots (NASA FIRMS) for the chosen day',
    ships: 'Ships (AIS)', kinds: 'Type', flag: 'Flag', allFlags: 'All flags', moving: 'Moving only', search: 'Name / MMSI', age: 'Last update',
    h1: '1 hour', h3: '3 hours', h12: '12 hours', shown: 'shown', noShips: 'No ship data yet (collector not running?)',
    cargo: 'Cargo', tanker: 'Tanker', passenger: 'Passenger', fishing: 'Fishing', military: 'Military / law enforcement', service: 'Tug / service', pleasure: 'Pleasure / sailing', fast: 'High-speed', other: 'Other / unknown',
    planes: 'Aircraft (ADS-B)', milOnly: 'Military only', milWorld: 'Military worldwide', emergency: 'Emergencies only (7500/7600/7700)', alt: 'Altitude', altAll: 'All',
    planeCivil: 'Civil', planeMil: 'Military', planeEmergency: 'Emergency', altGround: 'On the ground', altLow: 'Up to 10,000 ft', altMid: '10,000–30,000', altHigh: 'Above 30,000', planeSearch: 'Callsign / type / registration', radius: '250 NM around the map centre',
    speed: 'Speed', course: 'Course', dest: 'Destination', seen: 'Seen', type: 'Type', length: 'Length', status: 'Status', altitude: 'Altitude', squawk: 'Squawk', reg: 'Registration',
    error: 'Could not load',
  },
} as const;
type Txt = Record<keyof (typeof TXT)['he'], string>;

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const ago = (iso: string, lang: string) => {
  const min = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000));
  return lang === 'he' ? (min < 60 ? `לפני ${min} דק׳` : `לפני ${Math.round(min / 60)} שע׳`) : min < 60 ? `${min} min ago` : `${Math.round(min / 60)} h ago`;
};

type AltBand = 'all' | 'ground' | 'low' | 'mid' | 'high';

interface IntelLayersProps {
  map: L.Map | null;
  open: boolean;
  onClose: () => void;
  firesOn: boolean;
  onFires: (on: boolean) => void;
  /** The day the fires layer shows (the satellite picture's day), or null for the last 48 hours. */
  onFiresDate: (date: string | null) => void;
}

const SHIP_EMOJI: Record<string, string> = {
  cargo: '📦', tanker: '🛢️', passenger: '🛳️', fishing: '🎣', military: '⚓', service: '🛟', pleasure: '⛵', fast: '🚤', other: '•',
};
const hoverTips = typeof window !== 'undefined' && window.matchMedia('(hover: hover) and (pointer: fine)').matches;

export function IntelLayers({ map, open, onClose, firesOn, onFires, onFiresDate }: IntelLayersProps) {
  const { lang, dir } = useI18n();
  const T: Txt = TXT[lang === 'he' ? 'he' : 'en'];
  const areaLayers = useAreaLayers(map, lang, dir);

  // ── Satellite ──
  const [satOn, setSatOn] = useState(false);
  const [src, setSrc] = useState<SatSource>('hlss30');
  const [mode, setMode] = useState<'single' | 'compare'>('single');
  const [days, setDays] = useState<SatDay[]>([]);
  const [dayA, setDayA] = useState('');
  const [dayB, setDayB] = useState('');
  const [satBusy, setSatBusy] = useState(false);
  const [satErr, setSatErr] = useState('');
  const [key, setKey] = useState<{ k: string; sentinel2: boolean } | null>(null);
  const [swipe, setSwipe] = useState(0.5);
  const [zoom, setZoom] = useState(map?.getZoom() ?? 0);

  useEffect(() => {
    if (!map) return;
    const z = () => setZoom(map.getZoom());
    map.on('zoomend', z);
    z();
    return () => void map.off('zoomend', z);
  }, [map]);

  useEffect(() => {
    if (satOn && !key) satKey().then(setKey).catch(() => setKey({ k: '', sentinel2: false }));
  }, [satOn, key]);

  const loadDays = useCallback(async () => {
    if (!map) return;
    setSatBusy(true);
    setSatErr('');
    try {
      const b = map.getBounds();
      const list = await satDays(src, [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()]);
      setDays(list);
      // Newest fairly clear day for "after", the clear day before it for "before".
      const clear = list.filter((d) => d.cloud === null || d.cloud <= 30);
      const after = clear[0] ?? list[0];
      const before = clear.find((d) => after && d.date < after.date) ?? list.find((d) => after && d.date < after.date);
      setDayB(after?.date ?? '');
      setDayA(before?.date ?? after?.date ?? '');
    } catch {
      setSatErr(T.error);
      setDays([]);
    } finally {
      setSatBusy(false);
    }
  }, [map, src, T.error]);

  useEffect(() => {
    if (satOn) void loadDays();
  }, [satOn, src]); // eslint-disable-line react-hooks/exhaustive-deps

  // Single = the "after" day; compare = "before" on the left, "after" on the right.
  const shownA = mode === 'single' ? dayB : dayA;
  useEffect(() => onFiresDate(satOn && dayB ? dayB : null), [satOn, dayB, onFiresDate]);

  const panesRef = useRef<{ a: HTMLElement; b: HTMLElement } | null>(null);
  useEffect(() => {
    if (!map) return;
    if (!panesRef.current) {
      const a = map.getPane('ofmSatA') ?? map.createPane('ofmSatA');
      const b = map.getPane('ofmSatB') ?? map.createPane('ofmSatB');
      a.style.zIndex = '250';
      b.style.zIndex = '251';
      panesRef.current = { a, b };
    }
  }, [map]);

  useEffect(() => {
    if (!map || !satOn || !key || !panesRef.current) return;
    if (src === 's2' && !key.sentinel2) return;
    const layers: L.TileLayer[] = [];
    const add = (date: string, pane: string) => {
      if (!date) return;
      const spec = satTiles(src, date, key.k);
      const layer = L.tileLayer(spec.url, { pane, maxNativeZoom: spec.maxNativeZoom, maxZoom: 19, minZoom: spec.minZoom, attribution: spec.attribution, crossOrigin: true });
      layer.addTo(map);
      layers.push(layer);
    };
    add(shownA, 'ofmSatA');
    if (mode === 'compare') add(dayB, 'ofmSatB');
    return () => layers.forEach((l) => l.remove());
  }, [map, satOn, key, src, shownA, dayB, mode]);

  // The swipe: "before" shows left of the line, "after" right of it.
  useEffect(() => {
    const panes = panesRef.current;
    if (!map || !panes) return;
    const clear = () => {
      panes.a.style.clip = '';
      panes.b.style.clip = '';
    };
    if (!satOn || mode !== 'compare') {
      clear();
      return;
    }
    const update = () => {
      const size = map.getSize();
      const nw = map.containerPointToLayerPoint([0, 0]);
      const se = map.containerPointToLayerPoint(size);
      const x = nw.x + size.x * swipe;
      panes.a.style.clip = `rect(${nw.y}px, ${x}px, ${se.y}px, ${nw.x}px)`;
      panes.b.style.clip = `rect(${nw.y}px, ${se.x}px, ${se.y}px, ${x}px)`;
    };
    update();
    map.on('move zoom resize viewreset', update);
    return () => {
      map.off('move zoom resize viewreset', update);
      clear();
    };
  }, [map, satOn, mode, swipe]);

  const dividerRef = useRef<HTMLDivElement | null>(null);
  const dividerCb = useCallback(
    (el: HTMLDivElement | null) => {
      dividerRef.current = el;
      if (!el || !map) return;
      L.DomEvent.disableClickPropagation(el);
      L.DomEvent.disableScrollPropagation(el);
      const down = (e: PointerEvent) => {
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
      };
      el.addEventListener('pointerdown', down);
    },
    [map],
  );

  // ── Ships ──
  const [shipsOn, setShipsOn] = useState(false);
  const [kinds, setKinds] = useState<Set<ShipKind>>(() => new Set(SHIP_KINDS));
  const [flag, setFlag] = useState('');
  const [moving, setMoving] = useState(false);
  const [shipQ, setShipQ] = useState('');
  const [age, setAge] = useState(3);
  const [vessels, setVessels] = useState<Vessel[]>([]);
  const [shipErr, setShipErr] = useState('');
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!map || !shipsOn) return;
    let timer: number | undefined;
    const bump = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setTick((n) => n + 1), 500);
    };
    map.on('moveend', bump);
    return () => {
      map.off('moveend', bump);
      window.clearTimeout(timer);
    };
  }, [map, shipsOn]);

  useEffect(() => {
    if (!map || !shipsOn) return;
    let stop = false;
    const load = async () => {
      try {
        const b = map.getBounds().pad(0.2);
        const list = await fetchVessels({ south: b.getSouth(), west: b.getWest(), north: b.getNorth(), east: b.getEast() }, age);
        if (!stop) {
          setVessels(list);
          setShipErr('');
        }
      } catch {
        if (!stop) setShipErr(T.error);
      }
    };
    void load();
    const every = window.setInterval(load, 60_000);
    return () => {
      stop = true;
      window.clearInterval(every);
    };
  }, [map, shipsOn, age, tick, T.error]);

  const shownShips = useMemo(() => {
    const q = shipQ.trim().toLowerCase();
    return vessels.filter((v) => {
      if (!kinds.has(shipKind(v.ship_type))) return false;
      if (flag && shipFlag(v.mmsi) !== flag) return false;
      if (moving && !((v.sog ?? 0) >= 1)) return false;
      if (q && !(`${v.name ?? ''} ${v.mmsi} ${v.callsign ?? ''} ${v.imo ?? ''}`.toLowerCase().includes(q))) return false;
      return true;
    });
  }, [vessels, kinds, flag, moving, shipQ]);

  const flags = useMemo(() => {
    const count = new Map<string, number>();
    for (const v of vessels) {
      const f = shipFlag(v.mmsi);
      if (f) count.set(f, (count.get(f) ?? 0) + 1);
    }
    return [...count.entries()].sort((a, b) => b[1] - a[1]);
  }, [vessels]);
  const regionName = useMemo(() => {
    try {
      const names = new Intl.DisplayNames([lang], { type: 'region' });
      return (code: string) => names.of(code) ?? code;
    } catch {
      return (code: string) => code;
    }
  }, [lang]);

  const shipLayerRef = useRef<L.LayerGroup | null>(null);
  const canvasRef = useRef<L.Canvas | null>(null);
  useEffect(() => {
    if (!map) return;
    shipLayerRef.current?.remove();
    shipLayerRef.current = null;
    if (!shipsOn) return;
    canvasRef.current ??= L.canvas({ padding: 0.3 });
    const group = L.layerGroup();
    const z = map.getZoom();
    const detailed = z >= 9 && shownShips.length <= 400;
    for (const v of shownShips) {
      const kind = shipKind(v.ship_type);
      const color = SHIP_COLORS[kind];
      const flagCode = shipFlag(v.mmsi);
      const popup = `<div dir="${dir}" style="min-width:200px;font-size:12px;line-height:1.5">
        <b style="font-size:13px">${esc(v.name || `MMSI ${v.mmsi}`)}</b><br/>
        ${esc(T[kind])}${v.ship_type ? ` (${v.ship_type})` : ''}${flagCode ? ` · ${esc(regionName(flagCode))}` : ''}<br/>
        MMSI ${v.mmsi}${v.imo ? ` · IMO ${v.imo}` : ''}${v.callsign ? ` · ${esc(v.callsign)}` : ''}<br/>
        ${T.speed}: ${v.sog ?? '—'} kn · ${T.course}: ${v.cog ?? '—'}°${v.length_m ? ` · ${T.length}: ${v.length_m} m` : ''}<br/>
        ${v.destination ? `${T.dest}: ${esc(v.destination)}${v.eta ? ` (${esc(v.eta)})` : ''}<br/>` : ''}
        ${T.seen}: ${ago(v.updated_at, lang)}<br/>
        <a href="https://www.marinetraffic.com/en/ais/details/ships/mmsi:${v.mmsi}" target="_blank" rel="noopener noreferrer nofollow">MarineTraffic ↗</a>
      </div>`;
      // Zoomed in (few ships): an icon per type; otherwise fast coloured dots.
      const marker = detailed
        ? L.marker([v.lat, v.lng], {
            keyboard: false,
            icon: L.divIcon({
              className: '',
              iconSize: [20, 20],
              iconAnchor: [10, 10],
              html: `<span style="display:grid;place-items:center;width:20px;height:20px;border-radius:9999px;background:${color};border:1.5px solid #fff;font-size:11px;line-height:1;box-shadow:0 0 2px rgba(0,0,0,.4)">${SHIP_EMOJI[kind]}</span>`,
            }),
          })
        : L.circleMarker([v.lat, v.lng], {
            renderer: canvasRef.current!, radius: kind === 'military' ? 5 : 3.5, color: '#ffffff', weight: 1, fillColor: color, fillOpacity: 0.95,
          });
      marker.bindPopup(popup, { maxWidth: 280 });
      if (hoverTips) marker.bindTooltip(`${esc(v.name || `MMSI ${v.mmsi}`)} · ${esc(T[kind])}`, { direction: 'top' });
      marker.addTo(group);
      // Moving: a short line along the course.
      if ((v.sog ?? 0) >= 1 && v.cog !== null) {
        const mpp = (40075016 * Math.cos((v.lat * Math.PI) / 180)) / 2 ** (z + 8);
        const m = 14 * mpp;
        const rad = (v.cog * Math.PI) / 180;
        const to: L.LatLngExpression = [v.lat + (m * Math.cos(rad)) / 111320, v.lng + (m * Math.sin(rad)) / (111320 * Math.cos((v.lat * Math.PI) / 180))];
        L.polyline([[v.lat, v.lng], to], { renderer: canvasRef.current!, color, weight: 1.5, interactive: false }).addTo(group);
      }
    }
    group.addTo(map);
    shipLayerRef.current = group;
    return () => {
      group.remove();
    };
  }, [map, shipsOn, shownShips, dir, lang, T, regionName]);

  // ── Aircraft ──
  const [planesOn, setPlanesOn] = useState(false);
  const [milOnly, setMilOnly] = useState(false);
  const [milWorld, setMilWorld] = useState(false);
  const [emergency, setEmergency] = useState(false);
  const [alt, setAlt] = useState<AltBand>('all');
  const [planeQ, setPlaneQ] = useState('');
  const [planes, setPlanes] = useState<Plane[]>([]);
  const [planeErr, setPlaneErr] = useState('');
  const [planeTick, setPlaneTick] = useState(0);

  useEffect(() => {
    if (!map || !planesOn) return;
    let timer: number | undefined;
    const bump = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setPlaneTick((n) => n + 1), 500);
    };
    map.on('moveend', bump);
    return () => {
      map.off('moveend', bump);
      window.clearTimeout(timer);
    };
  }, [map, planesOn]);

  useEffect(() => {
    if (!map || !planesOn) return;
    let stop = false;
    const load = async () => {
      if (document.hidden) return;
      try {
        const c = map.getCenter();
        const corner = map.getBounds().getNorthEast();
        const nm = Math.min(250, c.distanceTo(corner) / 1852);
        const list = await fetchPlanes({ lat: c.lat, lng: c.lng }, nm, milWorld);
        if (!stop) {
          setPlanes(list);
          setPlaneErr('');
        }
      } catch {
        if (!stop) setPlaneErr(T.error);
      }
    };
    void load();
    const every = window.setInterval(load, 15_000);
    return () => {
      stop = true;
      window.clearInterval(every);
    };
  }, [map, planesOn, milWorld, planeTick, T.error]);

  const shownPlanes = useMemo(() => {
    const q = planeQ.trim().toLowerCase();
    return planes.filter((p) => {
      if ((milOnly || milWorld) && !p.mil) return false;
      if (emergency && !EMERGENCY_SQUAWKS.includes(p.squawk)) return false;
      const a = p.alt;
      if (alt === 'ground' && a !== 'ground') return false;
      if (alt === 'low' && !(typeof a === 'number' && a < 10000)) return false;
      if (alt === 'mid' && !(typeof a === 'number' && a >= 10000 && a <= 30000)) return false;
      if (alt === 'high' && !(typeof a === 'number' && a > 30000)) return false;
      if (q && !(`${p.flight} ${p.type} ${p.reg} ${p.hex} ${p.desc}`.toLowerCase().includes(q))) return false;
      return true;
    });
  }, [planes, milOnly, milWorld, emergency, alt, planeQ]);

  const planeLayerRef = useRef<L.LayerGroup | null>(null);
  useEffect(() => {
    if (!map) return;
    planeLayerRef.current?.remove();
    planeLayerRef.current = null;
    if (!planesOn) return;
    const group = L.layerGroup();
    for (const p of shownPlanes) {
      const urgent = EMERGENCY_SQUAWKS.includes(p.squawk);
      const color = urgent ? '#ea580c' : p.mil ? '#dc2626' : p.alt === 'ground' ? '#64748b' : '#0284c7';
      const icon = L.divIcon({
        className: 'ofm-plane',
        iconSize: [22, 22],
        iconAnchor: [11, 11],
        html: `<svg viewBox="0 0 24 24" width="22" height="22" style="transform:rotate(${p.track ?? 0}deg);filter:drop-shadow(0 0 1px #fff)"><path fill="${color}" stroke="#fff" stroke-width="0.8" d="M12 2c.8 0 1.3.9 1.3 2v5.2l7.7 4.6v2l-7.7-2.3v4.3l2.3 1.7v1.6L12 20l-3.6 1.1v-1.6l2.3-1.7v-4.3L3 15.8v-2l7.7-4.6V4c0-1.1.5-2 1.3-2z"/></svg>`,
      });
      const altText = p.alt === 'ground' ? T.altGround : p.alt === null ? '—' : `${p.alt.toLocaleString()} ft`;
      const popup = `<div dir="${dir}" style="min-width:190px;font-size:12px;line-height:1.5">
        <b style="font-size:13px">${esc(p.flight || p.reg || p.hex.toUpperCase())}</b>${p.mil ? ' <span style="color:#dc2626;font-weight:700">MIL</span>' : ''}<br/>
        ${esc(p.desc || p.type || '')}${p.type && p.desc ? ` (${esc(p.type)})` : ''}<br/>
        ${p.reg ? `${T.reg}: ${esc(p.reg)} · ` : ''}ICAO ${esc(p.hex.toUpperCase())}<br/>
        ${T.altitude}: ${altText} · ${T.speed}: ${p.gs ?? '—'} kn · ${T.course}: ${p.track !== null ? Math.round(p.track) : '—'}°<br/>
        ${p.squawk ? `${T.squawk}: <b style="${urgent ? 'color:#ea580c' : ''}">${esc(p.squawk)}</b><br/>` : ''}
        <a href="https://globe.adsbexchange.com/?icao=${esc(p.hex)}" target="_blank" rel="noopener noreferrer nofollow">ADS-B Exchange ↗</a> ·
        <a href="https://adsb.lol/?icao=${esc(p.hex)}" target="_blank" rel="noopener noreferrer nofollow">adsb.lol ↗</a>
      </div>`;
      const m = L.marker([p.lat, p.lon], { icon, zIndexOffset: p.mil || urgent ? 600 : 300, keyboard: false }).bindPopup(popup, { maxWidth: 280 });
      if (hoverTips) m.bindTooltip(`${esc(p.flight || p.reg || p.hex.toUpperCase())}${p.mil ? ' · MIL' : ''} · ${altText}`, { direction: 'top' });
      m.addTo(group);
    }
    group.addTo(map);
    planeLayerRef.current = group;
    return () => {
      group.remove();
    };
  }, [map, planesOn, shownPlanes, dir, T]);

  // ── Panel ──
  const box = 'rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-900';
  const sectionHead = (Icon: typeof Ship, label: string, on: boolean, set: (v: boolean) => void, extra?: string) => (
    <label className="flex cursor-pointer items-center gap-2 text-sm font-semibold text-slate-800 dark:text-slate-100">
      <input type="checkbox" className="size-4 accent-sky-600" checked={on} onChange={(e) => set(e.target.checked)} />
      <Icon className="size-4 text-slate-500" aria-hidden />
      <span className="flex-1">{label}</span>
      {extra ? <span className="text-[11px] font-normal text-slate-500">{extra}</span> : null}
    </label>
  );
  const dayLabel = (d: SatDay) => `${d.date}${d.cloud !== null ? ` · ${T.cloud} ${d.cloud}%` : ''}`;

  const container = map?.getContainer() ?? null;

  // Map legend for the open data layers (ships by type, aircraft by state).
  const mapLegend = !open && (shipsOn || planesOn) ? (
    <div dir={dir} className="pointer-events-auto absolute bottom-8 start-2 z-[600] max-w-[220px] rounded-lg bg-white/95 px-2.5 py-2 text-[11px] text-slate-700 shadow-lg ring-1 ring-slate-900/10 dark:bg-slate-900/95 dark:text-slate-200 dark:ring-white/10">
      {shipsOn ? (
        <div className="grid grid-cols-2 gap-x-2 gap-y-0.5">
          {SHIP_KINDS.map((k) => (
            <span key={k} className="flex items-center gap-1">
              <span className="grid size-3.5 place-items-center rounded-full text-[8px]" style={{ background: SHIP_COLORS[k] }} aria-hidden>{SHIP_EMOJI[k]}</span>{T[k]}
            </span>
          ))}
        </div>
      ) : null}
      {planesOn ? (
        <div className={shipsOn ? 'mt-1.5 border-t border-slate-200 pt-1.5 dark:border-slate-700' : ''}>
          {([['#0284c7', T.planeCivil], ['#dc2626', T.planeMil], ['#ea580c', T.planeEmergency], ['#64748b', T.altGround]] as const).map(([c, l]) => (
            <span key={c} className="me-2 inline-flex items-center gap-1"><span className="size-2.5 rounded-full" style={{ background: c }} />{l}</span>
          ))}
        </div>
      ) : null}
    </div>
  ) : null;

  return (
    <>
      {mapLegend}
      {container && satOn && mode === 'compare'
        ? createPortal(
            <div
              ref={dividerCb}
              className="absolute inset-y-0 z-[640] w-1 -translate-x-1/2 cursor-ew-resize bg-white/90 shadow-[0_0_0_1px_rgba(15,23,42,0.4)]"
              style={{ left: `${swipe * 100}%`, touchAction: 'none' }}
              role="slider"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(swipe * 100)}
              aria-label={T.swipeHint}
            >
              <span style={{ left: '50%' }} className="absolute top-1/2 grid size-7 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-white text-xs font-bold text-slate-700 shadow ring-1 ring-slate-300">⇆</span>
              <span style={{ right: 8 }} className="absolute top-2 rounded bg-slate-900/80 px-1.5 py-0.5 text-[10px] font-semibold whitespace-nowrap text-white">{T.before} · {dayA}</span>
              <span style={{ left: 8 }} className="absolute top-2 rounded bg-slate-900/80 px-1.5 py-0.5 text-[10px] font-semibold whitespace-nowrap text-white">{T.after} · {dayB}</span>
            </div>,
            container,
          )
        : null}
      {open ? (
        <div
          className="ofm-scroll absolute start-14 top-3 z-[650] max-h-[calc(100%-24px)] w-80 max-w-[calc(100vw-72px)] overflow-y-auto rounded-xl bg-white/95 p-3 shadow-xl ring-1 ring-slate-900/10 backdrop-blur dark:bg-slate-900/95 dark:ring-white/10"
          dir={dir}
          ref={(el) => {
            if (el) {
              L.DomEvent.disableClickPropagation(el);
              L.DomEvent.disableScrollPropagation(el);
            }
          }}
        >
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-bold text-slate-900 dark:text-white">{T.title}</h2>
            <button type="button" onClick={onClose} aria-label={T.close} className="inline-flex size-7 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800">
              <X className="size-4" aria-hidden />
            </button>
          </div>

          {/* Satellite */}
          <section className="space-y-2 border-b border-slate-100 pb-3 dark:border-slate-800">
            {sectionHead(Satellite, T.sat, satOn, (v) => (!v || hasFeature(undefined, 'satellite')) && setSatOn(v))}
            {satOn ? (
              <div className="space-y-2 ps-6 text-xs text-slate-600 dark:text-slate-300">
                <select className={`${box} w-full`} value={src} onChange={(e) => setSrc(e.target.value as SatSource)} aria-label={T.source}>
                  {SAT_SOURCES.map((s) => (
                    <option key={s} value={s} disabled={s === 's2' && key !== null && !key.sentinel2}>
                      {T[s]}{s === 's2' && key !== null && !key.sentinel2 ? ` — ${T.s2Off}` : ''}
                    </option>
                  ))}
                </select>
                <div className="flex gap-1">
                  {(['single', 'compare'] as const).map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setMode(m)}
                      className={`flex-1 rounded-lg px-2 py-1.5 font-semibold ${mode === m ? 'bg-sky-600 text-white' : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200'}`}
                    >
                      {T[m]}
                    </button>
                  ))}
                </div>
                {satBusy ? <p>{T.loading}</p> : satErr ? <p className="text-red-600">{satErr}</p> : !days.length ? <p>{T.none}</p> : (
                  <div className="space-y-1.5">
                    {mode === 'compare' ? (
                      <label className="block">
                        {T.before}
                        <select className={`${box} mt-0.5 w-full`} value={dayA} onChange={(e) => setDayA(e.target.value)}>
                          {days.map((d) => <option key={d.date} value={d.date}>{dayLabel(d)}</option>)}
                        </select>
                      </label>
                    ) : null}
                    <label className="block">
                      {mode === 'compare' ? T.after : T.date}
                      <select className={`${box} mt-0.5 w-full`} value={dayB} onChange={(e) => setDayB(e.target.value)}>
                        {days.map((d) => <option key={d.date} value={d.date}>{dayLabel(d)}</option>)}
                      </select>
                    </label>
                    {mode === 'compare' ? <p className="text-[11px] text-slate-500">{T.swipeHint}</p> : null}
                  </div>
                )}
                {src === 's2' && zoom < 8 ? <p className="text-amber-700 dark:text-amber-400">{T.zoomIn}</p> : null}
                <button type="button" onClick={() => void loadDays()} className="inline-flex items-center gap-1 font-semibold text-sky-700 hover:underline dark:text-sky-400">
                  <RefreshCw className="size-3.5" aria-hidden />
                  {T.refresh}
                </button>
                <label className="flex cursor-pointer items-center gap-2 pt-1">
                  <input type="checkbox" className="size-4 accent-orange-600" checked={firesOn} onChange={(e) => onFires(e.target.checked)} />
                  {T.fires}
                </label>
              </div>
            ) : null}
          </section>

          {/* Ships */}
          <section className="space-y-2 border-b border-slate-100 py-3 dark:border-slate-800">
            {sectionHead(Ship, T.ships, shipsOn, (v) => (!v || hasFeature(undefined, 'ships_aircraft')) && setShipsOn(v), shipsOn ? `${shownShips.length} ${T.shown}` : undefined)}
            {shipsOn ? (
              <div className="space-y-2 ps-6 text-xs text-slate-600 dark:text-slate-300">
                {shipErr ? <p className="text-red-600">{shipErr}</p> : !vessels.length ? <p>{T.noShips}</p> : null}
                <div className="grid grid-cols-2 gap-x-2 gap-y-1">
                  {SHIP_KINDS.map((k) => (
                    <label key={k} className="flex cursor-pointer items-center gap-1.5">
                      <input
                        type="checkbox"
                        className="size-3.5"
                        checked={kinds.has(k)}
                        onChange={(e) =>
                          setKinds((cur) => {
                            const next = new Set(cur);
                            if (e.target.checked) next.add(k);
                            else next.delete(k);
                            return next;
                          })
                        }
                      />
                      <span className="grid size-4 shrink-0 place-items-center rounded-full text-[9px]" style={{ background: SHIP_COLORS[k] }} aria-hidden>{SHIP_EMOJI[k]}</span>
                      <span className="truncate">{T[k]}</span>
                    </label>
                  ))}
                </div>
                <select className={`${box} w-full`} value={flag} onChange={(e) => setFlag(e.target.value)} aria-label={T.flag}>
                  <option value="">{T.allFlags}</option>
                  {flags.map(([code, n]) => (
                    <option key={code} value={code}>{regionName(code)} ({n})</option>
                  ))}
                </select>
                <input className={`${box} w-full`} value={shipQ} onChange={(e) => setShipQ(e.target.value)} placeholder={T.search} />
                <div className="flex items-center gap-2">
                  <label className="flex cursor-pointer items-center gap-1.5">
                    <input type="checkbox" className="size-3.5" checked={moving} onChange={(e) => setMoving(e.target.checked)} />
                    {T.moving}
                  </label>
                  <select className={`${box} ms-auto`} value={age} onChange={(e) => setAge(Number(e.target.value))} aria-label={T.age}>
                    <option value={1}>{T.h1}</option>
                    <option value={3}>{T.h3}</option>
                    <option value={12}>{T.h12}</option>
                  </select>
                </div>
              </div>
            ) : null}
          </section>

          {/* Aircraft */}
          <section className="space-y-2 pt-3">
            {sectionHead(PlaneIcon, T.planes, planesOn, (v) => (!v || hasFeature(undefined, 'ships_aircraft')) && setPlanesOn(v), planesOn ? `${shownPlanes.length} ${T.shown}` : undefined)}
            {planesOn ? (
              <div className="space-y-2 ps-6 text-xs text-slate-600 dark:text-slate-300">
                {planeErr ? <p className="text-red-600">{planeErr}</p> : null}
                <label className="flex cursor-pointer items-center gap-1.5">
                  <input type="checkbox" className="size-3.5" checked={milOnly} onChange={(e) => setMilOnly(e.target.checked)} />
                  {T.milOnly}
                </label>
                <label className="flex cursor-pointer items-center gap-1.5">
                  <input type="checkbox" className="size-3.5" checked={milWorld} onChange={(e) => setMilWorld(e.target.checked)} />
                  {T.milWorld}
                </label>
                <label className="flex cursor-pointer items-center gap-1.5">
                  <input type="checkbox" className="size-3.5" checked={emergency} onChange={(e) => setEmergency(e.target.checked)} />
                  {T.emergency}
                </label>
                <label className="block">
                  {T.alt}
                  <select className={`${box} mt-0.5 w-full`} value={alt} onChange={(e) => setAlt(e.target.value as AltBand)}>
                    <option value="all">{T.altAll}</option>
                    <option value="ground">{T.altGround}</option>
                    <option value="low">{T.altLow}</option>
                    <option value="mid">{T.altMid}</option>
                    <option value="high">{T.altHigh}</option>
                  </select>
                </label>
                <input className={`${box} w-full`} value={planeQ} onChange={(e) => setPlaneQ(e.target.value)} placeholder={T.planeSearch} />
                {!milWorld ? <p className="text-[11px] text-slate-500">{T.radius}</p> : null}
              </div>
            ) : null}
          </section>
          <div className="mt-3">
            <AreaLayersPanel s={areaLayers} />
          </div>
        </div>
      ) : null}
    </>
  );
}
