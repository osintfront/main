import { useCallback, useEffect, useMemo, useState } from 'react';
import { Bell, FileDown, Share2, Trash2 } from 'lucide-react';
import { track } from '@vercel/analytics';
import { useI18n } from '@/i18n';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/components/common/Toast';
import { computeForecast, type EngineSignal } from '../../../supabase/functions/_shared/ofi/engine.ts';
import type { OfiDetail } from '@/services/ofiService';
import { pct } from './OfiParts';
import { cn } from '@/utils/cn';

const card = 'rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-900/5 sm:p-6 dark:bg-slate-900 dark:ring-white/10';
const input = 'h-9 rounded-lg border border-slate-300 bg-white px-2.5 text-sm text-slate-900 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/30 dark:border-slate-700 dark:bg-slate-900 dark:text-white';

/** Funnel analytics (Vercel Analytics custom events; no personal data). */
export function ofiTrack(name: 'view_gauge' | 'click_locked_signal' | 'upgrade_modal_shown' | 'upgrade_modal_converted' | 'scenario_used' | 'alert_created', props?: Record<string, string | number>) {
  try {
    track(name, props);
  } catch {
    /* analytics blocked: nothing to do */
  }
}

// ── Threshold alerts (Pro: 3, Max: unlimited + webhook) ─────────────────────────────────────
interface AlertRow { id: string; kind: 'above' | 'below' | 'change'; value: number; webhook_url: string | null; enabled: boolean; last_fired_at: string | null }

export function OfiAlerts({ slug, eventTier }: { slug: string; eventTier: number }) {
  const { t } = useI18n();
  const toast = useToast();
  const [eventId, setEventId] = useState<string | null>(null);
  const [rows, setRows] = useState<AlertRow[]>([]);
  const [kind, setKind] = useState<AlertRow['kind']>('above');
  const [value, setValue] = useState(10);
  const [hook, setHook] = useState('');
  const max = eventTier >= 3;

  const load = useCallback(async () => {
    if (!supabase) return;
    // Readers cannot see insight_events; ofi_event_id gives the id of a published insight (Pro+).
    const { data: id } = await supabase.rpc('ofi_event_id', { p_slug: slug });
    if (typeof id !== 'string') return;
    setEventId(id);
    const { data } = await supabase.from('insight_alerts').select('id,kind,value,webhook_url,enabled,last_fired_at')
      .eq('event_id', id).order('created_at');
    setRows((data ?? []) as AlertRow[]);
  }, [slug]);
  useEffect(() => {
    void load();
  }, [load]);

  const add = async () => {
    if (!supabase || !eventId) return toast.error(t('ofi.alerts.failed'));
    const v = kind === 'change' ? value : value / 100;
    const { error } = await supabase.from('insight_alerts').insert({ event_id: eventId, kind, value: v, webhook_url: max && hook.trim() ? hook.trim() : null });
    if (error) return toast.error(error.message.includes('plan:') ? t('ofi.alerts.limit') : t('ofi.alerts.failed'));
    ofiTrack('alert_created', { kind });
    toast.success(t('ofi.alerts.added'));
    setHook('');
    await load();
  };
  const remove = async (id: string) => {
    await supabase?.from('insight_alerts').delete().eq('id', id);
    await load();
  };

  const describe = (r: AlertRow) =>
    r.kind === 'change' ? t('ofi.alerts.descChange', { v: Number(r.value) }) : t(r.kind === 'above' ? 'ofi.alerts.descAbove' : 'ofi.alerts.descBelow', { v: pct(Number(r.value)) });

  return (
    <section className={card}>
      <h2 className="flex items-center gap-2 text-base font-semibold text-slate-900 dark:text-white"><Bell className="size-4" aria-hidden /> {t('ofi.alerts.title')}</h2>
      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{t(max ? 'ofi.alerts.hintMax' : 'ofi.alerts.hintPro')}</p>
      {rows.length ? (
        <ul className="mt-3 space-y-1.5">
          {rows.map((r) => (
            <li key={r.id} className="flex items-center justify-between gap-2 text-sm text-slate-700 dark:text-slate-300">
              <span>{describe(r)}{r.webhook_url ? <span className="ms-1 text-xs text-slate-500">(+ webhook)</span> : null}</span>
              <button type="button" onClick={() => void remove(r.id)} aria-label={t('ofi.alerts.remove')} className="rounded p-1 text-slate-400 hover:text-red-600">
                <Trash2 className="size-4" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <select className={input} value={kind} onChange={(e) => setKind(e.target.value as AlertRow['kind'])} aria-label={t('ofi.alerts.kind')}>
          <option value="above">{t('ofi.alerts.above')}</option>
          <option value="below">{t('ofi.alerts.below')}</option>
          <option value="change">{t('ofi.alerts.change')}</option>
        </select>
        <input className={cn(input, 'w-20')} type="number" dir="ltr" min={kind === 'change' ? 0.5 : 1} max={kind === 'change' ? 50 : 95} step={kind === 'change' ? 0.5 : 1}
          value={value} onChange={(e) => setValue(Number(e.target.value))} aria-label={t('ofi.alerts.value')} />
        <span className="text-sm text-slate-600 dark:text-slate-300">{kind === 'change' ? t('ofi.alerts.pts') : '%'}</span>
        {max ? <input className={cn(input, 'min-w-0 flex-1')} dir="ltr" placeholder="https://… (webhook)" value={hook} onChange={(e) => setHook(e.target.value)} /> : null}
        <button type="button" onClick={() => void add()} className="inline-flex h-9 items-center rounded-lg bg-sky-600 px-3.5 text-sm font-semibold text-white hover:bg-sky-700">
          {t('ofi.alerts.add')}
        </button>
      </div>
      <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">{t('ofi.alerts.pushNote')}</p>
    </section>
  );
}

// ── Scenario explorer (Max): move any signal and see the estimate change, computed in the browser ──
export function ScenarioExplorer({ d }: { d: OfiDetail }) {
  const { t, lang } = useI18n();
  const base = useMemo(() => {
    const now = Date.now();
    return (d.signals ?? []).map((s): EngineSignal => {
      const last = s.readings.at(-1);
      return {
        key: s.key, name_he: s.name_he, name_en: s.name_en, source_type: s.source_type, weight: Number(s.weight),
        direction: s.direction === -1 ? -1 : 1, is_circuit_breaker: s.is_circuit_breaker,
        score: last ? last[1] : null, age_hours: last ? (now - new Date(last[0]).getTime()) / 3_600_000 : null,
        stale_after_hours: s.stale ? 0.0001 : 1e6,
      };
    });
  }, [d.signals]);
  const [over, setOver] = useState<Record<string, number>>({});
  const scenario = useMemo(() => base.map((s) => (s.key in over ? { ...s, score: over[s.key], age_hours: 0, stale_after_hours: 1e6 } : s)), [base, over]);
  const now = useMemo(() => computeForecast(d.base_rate ?? 0.02, base, null).probability, [base, d.base_rate]);
  const sim = useMemo(() => computeForecast(d.base_rate ?? 0.02, scenario, null).probability, [scenario, d.base_rate]);
  const touched = Object.keys(over).length > 0;

  return (
    <section className={card}>
      <h2 className="text-base font-semibold text-slate-900 dark:text-white">{t('ofi.scenario.title')}</h2>
      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{t('ofi.scenario.hint')}</p>
      <p className="mt-3 text-sm text-slate-700 dark:text-slate-300">
        {t('ofi.scenario.result', { now: pct(now), sim: pct(sim) })}
      </p>
      <ul className="mt-3 grid gap-2 sm:grid-cols-2">
        {base.filter((s) => s.source_type !== 'manual').map((s) => {
          const v = over[s.key] ?? s.score ?? 0.5;
          return (
            <li key={s.key} className="rounded-lg border border-slate-200 p-2.5 dark:border-slate-800">
              <label className="block text-xs font-medium text-slate-800 dark:text-slate-100">
                {lang === 'he' ? s.name_he : s.name_en}
                <input type="range" min={0} max={1} step={0.05} value={v} dir="ltr" className="mt-1.5 block w-full accent-sky-600"
                  onChange={(e) => {
                    setOver((o) => ({ ...o, [s.key]: Number(e.target.value) }));
                    if (!touched) ofiTrack('scenario_used');
                  }} />
              </label>
            </li>
          );
        })}
      </ul>
      {touched ? (
        <button type="button" onClick={() => setOver({})} className="mt-3 text-sm font-semibold text-sky-700 hover:underline dark:text-sky-400">{t('ofi.scenario.reset')}</button>
      ) : null}
    </section>
  );
}

/** Max: print-ready brief (the browser saves it as PDF). */
export function PrintBrief() {
  const { t } = useI18n();
  return (
    <button type="button" onClick={() => window.print()}
      className="inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-sm font-semibold text-slate-700 ring-1 ring-slate-300 hover:bg-slate-50 print:hidden dark:text-slate-200 dark:ring-slate-700 dark:hover:bg-slate-800">
      <FileDown className="size-4" aria-hidden /> {t('ofi.brief.pdf')}
    </button>
  );
}

/** "OFI saw it first": share card for a past window where the estimate stood well above the base rate before it happened. */
export function SawItFirstShare({ slug, p, start }: { slug: string; p: number; start: string }) {
  const { t, lang, locale } = useI18n();
  const date = new Date(start).toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' });
  const text = lang === 'he'
    ? `OFI ראה את זה ראשון: ב-${date} ההערכה עמדה על ${pct(p)} לפני שזה קרה.\n(מערכת ניסיונית, הערכה סטטיסטית בלבד)\nhttps://osintfront.com/insights/${slug}`
    : `OFI saw it first: on ${date} the estimate stood at ${pct(p)} before it happened.\n(Experimental, a statistical estimate only)\nhttps://osintfront.com/insights/${slug}`;
  return (
    <a href={`https://wa.me/?text=${encodeURIComponent(text)}`} target="_blank" rel="noopener noreferrer"
      className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 hover:underline dark:text-emerald-400">
      <Share2 className="size-3.5" aria-hidden /> {t('ofi.sawFirst')}
    </a>
  );
}
