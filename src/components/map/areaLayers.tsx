// Map layers of areas: who controls what (Israel in Lebanon and Syria, Yemen, Gaza — copied daily
// from a public war map), Lebanese villages by religious community (Wikipedia) and the
// courses of Lebanon's wadis and streams (OpenStreetMap).
import { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import { Church, Flag, Waves } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';

export type ControlRegion = 'lebanon' | 'syria' | 'yemen' | 'gaza';
export const CONTROL_REGIONS: ControlRegion[] = ['lebanon', 'syria', 'yemen', 'gaza'];
export type Sect = 'shia' | 'sunni' | 'druze' | 'alawite' | 'maronite' | 'orthodox' | 'melkite' | 'armenian' | 'christian';
export const SECTS: Sect[] = ['shia', 'sunni', 'druze', 'alawite', 'maronite', 'orthodox', 'melkite', 'armenian', 'christian'];
export const SECT_COLORS: Record<Sect, string> = {
  shia: '#16a34a', sunni: '#0f766e', druze: '#7c3aed', alawite: '#a3e635',
  maronite: '#2563eb', orthodox: '#0ea5e9', melkite: '#f59e0b', armenian: '#e11d48', christian: '#64748b',
};

interface ControlArea { id: string; region: ControlRegion; name: string; kind: 'polygon' | 'line'; color: string; geometry: GeoJSON.Geometry; first_seen: string }
interface SectPlace { title: string; name_en: string; name_he: string | null; name_ar: string | null; lat: number; lng: number; sects: Sect[] }

const AREA_TXT = {
  he: {
    control: 'אזורי שליטה', sects: 'עדות בלבנון', lebanon: 'לבנון', syria: 'סוריה', yemen: 'תימן', gaza: 'עזה',
    updated: 'סונכרן', source: 'מקור: מפת המלחמה (Google My Maps)', since: 'במפה מאז', sectsSource: 'מקור: ויקיפדיה (קטגוריות יישובים לפי עדה)',
    mixed: 'מעורב', places: 'יישובים', wiki: 'ויקיפדיה',
    wadis: 'ואדיות ונחלים בלבנון', wadisSource: 'מקור: OpenStreetMap', courses: 'תוואים', km: 'ק"מ', aiName: 'שם בעברית: תעתיק AI',
    shia: 'שיעים', sunni: 'סונים', druze: 'דרוזים', alawite: 'עלאווים', maronite: 'מרונים', orthodox: 'יוונים-אורתודוקסים', melkite: 'יוונים-קתולים', armenian: 'ארמנים', christian: 'נוצרים (אחר)',
  },
  en: {
    control: 'Areas of control', sects: 'Lebanon: communities', lebanon: 'Lebanon', syria: 'Syria', yemen: 'Yemen', gaza: 'Gaza',
    updated: 'Synced', source: 'Source: war map (Google My Maps)', since: 'On the map since', sectsSource: 'Source: Wikipedia (communities by sect)',
    mixed: 'Mixed', places: 'places', wiki: 'Wikipedia',
    wadis: 'Lebanon: wadis and streams', wadisSource: 'Source: OpenStreetMap', courses: 'courses', km: 'km', aiName: 'Hebrew name: AI transliteration',
    shia: 'Shia', sunni: 'Sunni', druze: 'Druze', alawite: 'Alawite', maronite: 'Maronite', orthodox: 'Greek Orthodox', melkite: 'Greek Catholic', armenian: 'Armenian', christian: 'Christian (other)',
  },
} as const;
type AreaTxt = Record<keyof (typeof AREA_TXT)['he'], string>;

// Hebrew names for the source map's areas (others keep the source's name).
const NAME_HE: [RegExp, string][] = [
  [/^IDF in Lebanon$/i, 'צה"ל בלבנון'], [/^IDF In Syria$/i, 'צה"ל בסוריה'], [/Hezbollah Baalbek/i, 'חיזבאללה – גזרת בעלבכ'],
  [/Hezbollah Beirut/i, 'חיזבאללה – גזרת ביירות (הדאחיה)'], [/Southern and Nabatieh Sectors/i, 'חיזבאללה – גזרות הדרום ונבטיה'],
  [/Populated Christian Towns/i, 'עיירות נוצריות מאוכלסות'], [/Lebanon Final Line of Contact/i, 'קו המגע האחרון בלבנון'],
  [/^Sector ([ABC])$/i, 'גזרה $1'], [/Suwayda Military Council/i, 'המועצה הצבאית של סווידא'], [/^Ansarallah-(.*)$/i, "חות'ים – $1"],
  [/Gaza Buffer Zone/i, 'אזור החיץ בעזה'], [/^Yellow Line$/i, 'הקו הצהוב'], [/Hamas/i, 'חמאס'], [/^Invasion of Gaza$/i, 'הפלישה לעזה'],
];
function areaName(name: string, lang: string): string {
  if (lang !== 'he') return name;
  for (const [re, he] of NAME_HE) if (re.test(name)) return name.replace(re, he);
  return name;
}

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export function useAreaLayers(map: L.Map | null, lang: string, dir: 'ltr' | 'rtl') {
  const T: AreaTxt = AREA_TXT[lang === 'he' ? 'he' : 'en'];
  const [controlOn, setControlOn] = useState(false);
  const [regions, setRegions] = useState<Set<ControlRegion>>(() => new Set<ControlRegion>(['lebanon', 'syria', 'yemen']));
  const [areas, setAreas] = useState<ControlArea[]>([]);
  const [synced, setSynced] = useState<{ control?: string; sects?: string }>({});
  const [sectsOn, setSectsOn] = useState(false);
  const [sects, setSects] = useState<Set<Sect>>(() => new Set(SECTS));
  const [places, setPlaces] = useState<SectPlace[]>([]);
  const [wadisOn, setWadisOn] = useState(false);
  const [wadis, setWadis] = useState<GeoJSON.FeatureCollection | null>(null);

  useEffect(() => {
    if (!supabase || !wadisOn || wadis) return;
    void supabase.rpc('wadi_lines_geojson').then(({ data }) => setWadis((data as GeoJSON.FeatureCollection) ?? { type: 'FeatureCollection', features: [] }));
  }, [wadisOn, wadis]);

  useEffect(() => {
    if (!supabase || (!controlOn && !sectsOn)) return;
    void supabase.from('layer_sync').select('layer,synced_at').then(({ data }) => {
      const out: { control?: string; sects?: string } = {};
      for (const r of (data ?? []) as { layer: string; synced_at: string }[]) out[r.layer as 'control' | 'sects'] = r.synced_at;
      setSynced(out);
    });
  }, [controlOn, sectsOn]);

  useEffect(() => {
    if (!supabase || !controlOn || areas.length) return;
    void supabase.from('control_areas').select('id,region,name,kind,color,geometry,first_seen').then(({ data }) => setAreas((data ?? []) as ControlArea[]));
  }, [controlOn, areas.length]);

  useEffect(() => {
    if (!supabase || !sectsOn || places.length) return;
    void supabase.from('lebanon_sects').select('title,name_en,name_he,name_ar,lat,lng,sects').limit(3000).then(({ data }) => setPlaces((data ?? []) as SectPlace[]));
  }, [sectsOn, places.length]);

  // Areas sit under the event pins (their own pane), lines on top of the areas.
  useEffect(() => {
    if (!map) return;
    // Inside the rotating pane (leaflet-rotate), so the areas turn with the map and stay above the tiles.
    if (!map.getPane('ofmAreas')) map.createPane('ofmAreas', map.getPane('rotatePane')).style.zIndex = '330';
  }, [map]);

  useEffect(() => {
    if (!map || !controlOn) return;
    const group = L.layerGroup();
    const day = (iso?: string) => (iso ? new Date(iso).toLocaleDateString(lang === 'he' ? 'he-IL' : 'en-GB') : '—');
    for (const a of areas) {
      if (!regions.has(a.region)) continue;
      const label = areaName(a.name, lang);
      const layer = L.geoJSON(a.geometry as GeoJSON.GeoJsonObject, {
        pane: 'ofmAreas',
        style: a.kind === 'line'
          ? { color: a.color, weight: 3, opacity: 0.9, dashArray: '6 4' }
          : { color: a.color, weight: 1.5, opacity: 0.9, fillColor: a.color, fillOpacity: 0.28 },
      });
      layer.bindTooltip(esc(label), { sticky: true, direction: 'top' });
      layer.bindPopup(
        `<div dir="${dir}" style="font-size:12px;line-height:1.5;min-width:180px"><b style="font-size:13px">${esc(label)}</b>${label !== a.name ? `<br/><span style="color:#64748b">${esc(a.name)}</span>` : ''}<br/>${esc(T[a.region])} · ${T.since}: ${day(a.first_seen)}<br/><span style="color:#64748b">${T.source} · ${T.updated}: ${day(synced.control)}</span></div>`,
      );
      layer.addTo(group);
    }
    group.addTo(map);
    return () => void group.remove();
  }, [map, controlOn, areas, regions, lang, dir, T, synced.control]);

  const canvasRef = useRef<L.Canvas | null>(null);
  const shownPlaces = useMemo(() => places.filter((p) => p.sects.some((s) => sects.has(s))), [places, sects]);
  useEffect(() => {
    if (!map || !sectsOn) return;
    canvasRef.current ??= L.canvas({ padding: 0.3, pane: 'ofmAreas' });
    const group = L.layerGroup();
    for (const p of shownPlaces) {
      const main = p.sects.find((s) => sects.has(s)) ?? p.sects[0];
      const mixed = p.sects.length > 1;
      const name = (lang === 'he' ? p.name_he : null) || p.name_ar || p.name_en;
      const marker = L.circleMarker([p.lat, p.lng], {
        renderer: canvasRef.current!, pane: 'ofmAreas', radius: 5, weight: mixed ? 2.5 : 1,
        color: mixed ? SECT_COLORS[p.sects.find((s) => s !== main) ?? main] : '#ffffff', fillColor: SECT_COLORS[main], fillOpacity: 0.9,
      });
      marker.bindTooltip(`${esc(name)} · ${p.sects.map((s) => esc(T[s])).join(' / ')}`, { direction: 'top' });
      marker.bindPopup(
        `<div dir="${dir}" style="font-size:12px;line-height:1.5"><b style="font-size:13px">${esc(name)}</b><br/>${esc([p.name_ar, p.name_en].filter((x) => x && x !== name).join(' · '))}<br/>${mixed ? `${T.mixed}: ` : ''}${p.sects.map((s) => esc(T[s])).join(' / ')}<br/><a href="https://en.wikipedia.org/wiki/${encodeURIComponent(p.title.replace(/ /g, '_'))}" target="_blank" rel="noopener noreferrer nofollow">${T.wiki} ↗</a></div>`,
      );
      marker.addTo(group);
    }
    group.addTo(map);
    return () => void group.remove();
  }, [map, sectsOn, shownPlaces, sects, lang, dir, T]);

  useEffect(() => {
    if (!map || !wadisOn || !wadis) return;
    const layer = L.geoJSON(wadis, {
      pane: 'ofmAreas',
      style: { color: '#0284c7', weight: 2.5, opacity: 0.85 },
      onEachFeature: (f, l) => {
        const p = (f.properties ?? {}) as { name: string; ar?: string; en?: string; he?: string; ai?: boolean; km?: number };
        const name = (lang === 'he' ? p.he : p.en) || p.name;
        const other = [p.he, p.ar, p.en, p.name].filter((x, i, a) => x && x !== name && a.indexOf(x) === i).join(' · ');
        l.bindTooltip(esc(name), { sticky: true, direction: 'top' });
        l.bindPopup(
          `<div dir="${dir}" style="font-size:12px;line-height:1.5"><b style="font-size:13px">${esc(name)}</b>${other ? `<br/><span style="color:#64748b">${esc(other)}</span>` : ''}${p.km ? `<br/>${p.km} ${T.km}` : ''}${lang === 'he' && p.he && p.ai ? `<br/><span style="color:#64748b">${T.aiName}</span>` : ''}<br/><span style="color:#64748b">${T.wadisSource}</span></div>`,
        );
      },
    });
    layer.addTo(map);
    return () => void layer.remove();
  }, [map, wadisOn, wadis, lang, dir, T]);

  return { T, lang, wadisOn, setWadisOn, wadiCount: wadis?.features.length ?? 0, controlOn, setControlOn, regions, setRegions, areas, synced, sectsOn, setSectsOn, sects, setSects, shownPlaces };
}

type AreaState = ReturnType<typeof useAreaLayers>;

export function AreaLayersPanel({ s }: { s: AreaState }) {
  const { T, lang } = s;
  const toggle = <V,>(set: (f: (cur: Set<V>) => Set<V>) => void, v: V, on: boolean) =>
    set((cur) => {
      const next = new Set(cur);
      if (on) next.add(v);
      else next.delete(v);
      return next;
    });
  const day = (iso?: string) => (iso ? new Date(iso).toLocaleString(lang === 'he' ? 'he-IL' : 'en-GB', { dateStyle: 'short', timeStyle: 'short' }) : '—');
  return (
    <>
      <section className="space-y-2 border-t border-slate-100 pt-3 dark:border-slate-800">
        <label className="flex cursor-pointer items-center gap-2 text-sm font-semibold text-slate-800 dark:text-slate-100">
          <input type="checkbox" className="size-4 accent-sky-600" checked={s.controlOn} onChange={(e) => s.setControlOn(e.target.checked)} />
          <Flag className="size-4 text-slate-500" aria-hidden />
          <span className="flex-1">{T.control}</span>
        </label>
        {s.controlOn ? (
          <div className="space-y-1.5 ps-6 text-xs text-slate-600 dark:text-slate-300">
            <div className="flex flex-wrap gap-x-3 gap-y-1">
              {CONTROL_REGIONS.map((r) => (
                <label key={r} className="flex cursor-pointer items-center gap-1.5">
                  <input type="checkbox" className="size-3.5" checked={s.regions.has(r)} onChange={(e) => toggle(s.setRegions, r, e.target.checked)} />
                  {T[r]}
                </label>
              ))}
            </div>
            <p className="text-[11px] text-slate-500">
              {T.source} · {T.updated}: {day(s.synced.control)}
            </p>
          </div>
        ) : null}
      </section>
      <section className="mt-3 space-y-2 border-t border-slate-100 pt-3 dark:border-slate-800">
        <label className="flex cursor-pointer items-center gap-2 text-sm font-semibold text-slate-800 dark:text-slate-100">
          <input type="checkbox" className="size-4 accent-sky-600" checked={s.sectsOn} onChange={(e) => s.setSectsOn(e.target.checked)} />
          <Church className="size-4 text-slate-500" aria-hidden />
          <span className="flex-1">{T.sects}</span>
          {s.sectsOn ? <span className="text-[11px] font-normal text-slate-500">{s.shownPlaces.length} {T.places}</span> : null}
        </label>
        {s.sectsOn ? (
          <div className="space-y-1.5 ps-6 text-xs text-slate-600 dark:text-slate-300">
            <div className="grid grid-cols-2 gap-x-2 gap-y-1">
              {SECTS.map((k) => (
                <label key={k} className="flex cursor-pointer items-center gap-1.5">
                  <input type="checkbox" className="size-3.5" checked={s.sects.has(k)} onChange={(e) => toggle(s.setSects, k, e.target.checked)} />
                  <span className="size-2.5 shrink-0 rounded-full" style={{ background: SECT_COLORS[k] }} aria-hidden />
                  <span className="truncate">{T[k]}</span>
                </label>
              ))}
            </div>
            <p className="text-[11px] text-slate-500">{T.sectsSource}</p>
          </div>
        ) : null}
      </section>
      <section className="mt-3 space-y-2 border-t border-slate-100 pt-3 dark:border-slate-800">
        <label className="flex cursor-pointer items-center gap-2 text-sm font-semibold text-slate-800 dark:text-slate-100">
          <input type="checkbox" className="size-4 accent-sky-600" checked={s.wadisOn} onChange={(e) => s.setWadisOn(e.target.checked)} />
          <Waves className="size-4 text-slate-500" aria-hidden />
          <span className="flex-1">{T.wadis}</span>
          {s.wadisOn && s.wadiCount ? <span className="text-[11px] font-normal text-slate-500">{s.wadiCount} {T.courses}</span> : null}
        </label>
        {s.wadisOn ? <p className="ps-6 text-[11px] text-slate-500">{T.wadisSource}</p> : null}
      </section>
    </>
  );
}
