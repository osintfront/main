// Ships → "Chokepoints now": crossings against our own history at six straits, open to everyone.
import { useEffect, useState } from 'react';
import L from 'leaflet';
import { MapPin, Ship } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { shipFlag } from '@/lib/intelLayers';
import { CHOKEPOINT_TXT, fetchChokepoints, statusOf, type ChokepointStat, type Status } from '@/lib/ships';

const CHIP: Record<Status, string> = {
  normal: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200',
  below: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200',
  low: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200',
  collecting: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
};
// Where "See it on the map" goes: the strait and its waiting areas.
const VIEW: Record<ChokepointStat['id'], L.LatLngBoundsExpression> = {
  hormuz: [[24.8, 54.5], [27.2, 57.8]], bab_el_mandeb: [[11.8, 42.6], [13.6, 45.2]], suez: [[29.5, 32.0], [31.7, 32.8]],
  tiran: [[27.6, 34.2], [28.4, 34.8]], bosphorus: [[40.85, 28.8], [41.45, 29.4]], dardanelles: [[39.9, 25.9], [40.6, 27.2]],
};

function since(iso: string, he: boolean): string {
  const min = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000));
  if (min < 60) return he ? `${min} דק׳` : `${min} min`;
  const h = Math.round(min / 60);
  return he ? `${h} ש׳` : `${h} h`;
}

export function ChokepointPanel({ map, lang, onMap, sanctioned, silent, regionName, onShow }: {
  map: L.Map | null; lang: string; onMap: number; sanctioned: number | null; silent: number | null;
  regionName: (code: string) => string; onShow: () => void;
}) {
  const he = lang === 'he';
  const T = CHOKEPOINT_TXT[he ? 'he' : 'en'];
  const [stats, setStats] = useState<ChokepointStat[] | null>(null);
  const [err, setErr] = useState(false);

  useEffect(() => {
    if (!supabase) return;
    let alive = true;
    const load = () => fetchChokepoints((fn) => supabase!.rpc(fn))
      .then((s) => { if (alive) { setStats(s); setErr(false); } })
      .catch(() => alive && setErr(true));
    void load();
    const t = window.setInterval(load, 5 * 60_000);
    return () => { alive = false; window.clearInterval(t); };
  }, []);

  const tile = (n: number | null, label: string) => (
    <div className="rounded-lg border border-slate-200 px-2 py-1.5 dark:border-slate-700">
      <p className="font-mono text-base font-semibold tabular-nums">{n === null ? '—' : n.toLocaleString(he ? 'he-IL' : 'en-GB')}</p>
      <p className="text-[10px] leading-tight text-slate-500">{label}</p>
    </div>
  );

  return (
    <div className="space-y-2 text-xs" data-chokepoints>
      <div className="grid grid-cols-3 gap-1.5">{tile(onMap, T.onMap)}{tile(sanctioned, T.sanctioned)}{tile(silent, T.silent)}</div>
      <p className="pt-1 text-[10px] font-semibold tracking-wide text-slate-500 uppercase">{T.title}</p>
      {err ? <p className="text-red-600">—</p> : null}
      {(stats ?? []).map((c) => {
        const st = statusOf(c.pct_normal);
        const last = c.last;
        const flag = last ? shipFlag(last.mmsi) : '';
        return (
          <div key={c.id} data-chokepoint={c.id} className="space-y-1 rounded-lg border border-slate-200 p-2 dark:border-slate-700">
            <div className="flex items-center gap-1.5">
              <Ship className="size-3.5 text-slate-500" aria-hidden />
              <span className="flex-1 font-semibold">{T[c.id]}</span>
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${CHIP[st]}`} data-status={st}>{T[st]}</span>
            </div>
            <p className="text-slate-600 dark:text-slate-300">
              {c.pct_normal === null ? T.collectingDays.replace('{n}', String(c.days)) : <>≈{c.pct_normal}% {T.ofNormal}</>}
            </p>
            <div className="grid grid-cols-3 gap-1 text-center">
              <div><p className="font-mono font-semibold">{c.crossings_24h}</p><p className="text-[10px] text-slate-500">{T.crossings}</p></div>
              <div><p className="font-mono font-semibold">{c.tankers_24h}</p><p className="text-[10px] text-slate-500">{T.tankers}</p></div>
              <div><p className="font-mono font-semibold">{c.avg_7d}</p><p className="text-[10px] text-slate-500">{T.avg}</p></div>
            </div>
            {c.waiting.length ? (
              <p className="text-slate-600 dark:text-slate-300">
                {c.waiting.map((w) => `${w.n} ${T.waiting} ${he ? w.he : w.en}`).join(' · ')}
              </p>
            ) : null}
            <p className="text-slate-600 dark:text-slate-300">
              {last ? (
                <>{T.last}: <b>{last.name || `MMSI ${last.mmsi}`}</b>{flag ? ` (${regionName(flag)})` : ''} {he ? last.dir_he : last.dir_en} · {he ? `${T.ago} ${since(last.at, he)}` : `${since(last.at, he)} ${T.ago}`}</>
              ) : T.none}
            </p>
            <button type="button" className="flex w-full items-center justify-center gap-1 rounded-md border border-dashed border-slate-300 py-1 font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
              onClick={() => { onShow(); map?.fitBounds(VIEW[c.id], { padding: [20, 20] }); }}>
              <MapPin className="size-3.5" aria-hidden />{T.seeMap}
            </button>
          </div>
        );
      })}
      <p className="text-[10px] text-slate-400">{T.footer}</p>
    </div>
  );
}
