import { useCallback, useEffect, useState } from 'react';
import { Loader2, RefreshCw, ShieldCheck } from 'lucide-react';
import { useI18n } from '@/i18n';
import { useToast } from '@/components/common/Toast';
import {
  adminCompute, adminLoad, adminRecompute, adminSetManual, adminUpdateEvent, adminUpdateSignal,
  type OfiAdminEvent, type OfiAdminSignal, type OfiManualReading,
} from '@/services/ofiService';
import { formatDateTime } from '@/utils/time';
import { cn } from '@/utils/cn';
import { OfiAdminTools } from './OfiAdminTools';

const box = 'rounded-2xl border-2 border-dashed border-sky-300 bg-sky-50/50 p-5 sm:p-6 dark:border-sky-500/40 dark:bg-sky-500/5';
const input = 'h-9 rounded-lg border border-slate-300 bg-white px-2.5 text-sm text-slate-900 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/30 dark:border-slate-700 dark:bg-slate-900 dark:text-white';
const btn = 'inline-flex h-9 items-center justify-center gap-1.5 rounded-lg px-3.5 text-sm font-semibold disabled:opacity-60';
const HOURS = [6, 12, 24, 48, 72, 168];

/**
 * Super admin only (the page shows it for that role; the server refuses everyone else anyway):
 * the manual parameter, "Recompute now", the event's settings and the signal weights.
 */
export function OfiAdminPanel({ slug, onChanged }: { slug: string; onChanged: () => void }) {
  const { t, lang, locale } = useI18n();
  const toast = useToast();
  const [ev, setEv] = useState<OfiAdminEvent | null>(null);
  const [signals, setSignals] = useState<OfiAdminSignal[]>([]);
  const [manual, setManual] = useState<OfiManualReading | null>(null);
  const [level, setLevel] = useState(0);
  const [note, setNote] = useState('');
  const [hours, setHours] = useState(24);
  const [busy, setBusy] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const r = await adminLoad(slug);
    setEv(r.event);
    setSignals(r.signals);
    setManual(r.manual);
  }, [slug]);
  useEffect(() => {
    reload().catch((e) => toast.error(String(e?.message ?? e)));
  }, [reload, toast]);

  const run = async (key: string, fn: () => Promise<unknown>, ok: string) => {
    setBusy(key);
    try {
      await fn();
      toast.success(ok);
      await reload();
      onChanged();
    } catch (e) {
      toast.error(String((e as Error)?.message ?? e));
    } finally {
      setBusy(null);
    }
  };

  if (!ev) return null;
  const manualActive = manual && manual.metadata?.hours
    ? Date.now() - new Date(manual.ts).getTime() < Number(manual.metadata.hours) * 3_600_000 : false;

  return (
    <section className={box} aria-labelledby="ofi-admin">
      <h2 id="ofi-admin" className="flex items-center gap-2 text-base font-semibold text-slate-900 dark:text-white">
        <ShieldCheck className="size-5 text-sky-600" aria-hidden /> {t('ofi.admin.title')}
      </h2>
      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{t('ofi.admin.onlyYou')}</p>

      {/* Manual parameter */}
      <div className="mt-5">
        <h3 className="text-sm font-semibold text-slate-900 dark:text-white">{t('ofi.admin.manual')}</h3>
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{t('ofi.admin.manualHint')}</p>
        {manual ? (
          <p className="mt-2 text-xs text-slate-600 dark:text-slate-300">
            {t(manualActive ? 'ofi.admin.manualNow' : 'ofi.admin.manualExpired', { level: Number(manual.raw_value ?? 0), time: formatDateTime(manual.ts, locale) })}
            {manual.metadata?.note ? <> “{manual.metadata.note}”</> : null}
          </p>
        ) : null}
        <div className="mt-3 flex items-center gap-3">
          <span className="text-xs text-teal-700 dark:text-teal-400">−100</span>
          <input type="range" min={-100} max={100} step={5} value={level} onChange={(e) => setLevel(Number(e.target.value))}
            aria-label={t('ofi.admin.manual')} className="h-2 flex-1 accent-sky-600" dir="ltr" />
          <span className="text-xs text-red-600 dark:text-red-400">+100</span>
          <output className={cn('w-12 text-end text-sm font-bold tabular-nums', level > 0 ? 'text-red-600' : level < 0 ? 'text-teal-700' : 'text-slate-600')} dir="ltr">
            {level > 0 ? `+${level}` : level}
          </output>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input className={cn(input, 'min-w-0 flex-1')} value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} placeholder={t('ofi.admin.notePh')} />
          <label className="flex items-center gap-1.5 text-sm text-slate-700 dark:text-slate-300">
            {t('ofi.admin.holdFor')}
            <select className={input} value={hours} onChange={(e) => setHours(Number(e.target.value))}>
              {HOURS.map((h) => <option key={h} value={h}>{t('ofi.admin.hours', { h })}</option>)}
            </select>
          </label>
          <button type="button" disabled={busy !== null} className={cn(btn, 'bg-sky-600 text-white hover:bg-sky-700')}
            onClick={() => run('manual', async () => { await adminSetManual(slug, level, note, hours); await adminCompute(slug); }, t('ofi.admin.manualSaved'))}>
            {busy === 'manual' ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
            {t('ofi.admin.manualSave')}
          </button>
        </div>
      </div>

      {/* Recompute + event settings */}
      <div className="mt-6 flex flex-wrap items-end gap-3">
        <button type="button" disabled={busy !== null} className={cn(btn, 'bg-slate-900 text-white hover:bg-slate-700 dark:bg-white dark:text-slate-900')}
          onClick={() => run('recompute', () => adminRecompute(slug), t('ofi.admin.recomputed'))}>
          {busy === 'recompute' ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <RefreshCw className="size-4" aria-hidden />}
          {t('ofi.admin.recompute')}
        </button>
        <label className="flex flex-col gap-1 text-xs text-slate-600 dark:text-slate-300">
          {t('ofi.admin.status')}
          <select className={input} value={ev.status} disabled={busy !== null}
            onChange={(e) => run('status', () => adminUpdateEvent(ev.id, { status: e.target.value as OfiAdminEvent['status'] }), t('ofi.admin.saved'))}>
            {(['draft', 'active', 'paused', 'resolved'] as const).map((s) => <option key={s} value={s}>{t(`ofi.admin.st.${s}`)}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-slate-600 dark:text-slate-300">
          {t('ofi.admin.interval')}
          <select className={input} value={ev.refresh_interval_hours} disabled={busy !== null}
            onChange={(e) => run('interval', () => adminUpdateEvent(ev.id, { refresh_interval_hours: Number(e.target.value) }), t('ofi.admin.saved'))}>
            {[6, 12, 24, 48].map((h) => <option key={h} value={h}>{t('ofi.admin.hours', { h })}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-slate-600 dark:text-slate-300">
          {t('ofi.admin.baseRate')}
          <input className={cn(input, 'w-24')} type="number" min={0.1} max={50} step={0.1} defaultValue={(ev.base_rate * 100).toFixed(1)} dir="ltr"
            onBlur={(e) => {
              const v = Number(e.target.value) / 100;
              if (v > 0 && v < 0.5 && Math.abs(v - ev.base_rate) > 1e-6) void run('base', () => adminUpdateEvent(ev.id, { base_rate: v }), t('ofi.admin.saved'));
            }} />
        </label>
        <label className="flex items-center gap-2 text-sm font-medium text-slate-800 dark:text-slate-100">
          <input type="checkbox" className="size-4 accent-sky-600" checked={ev.is_published} disabled={busy !== null}
            onChange={(e) => run('publish', () => adminUpdateEvent(ev.id, { is_published: e.target.checked }), t('ofi.admin.saved'))} />
          {t('ofi.admin.published')}
        </label>
      </div>
      <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
        {t('ofi.admin.runs', { last: ev.last_run_at ? formatDateTime(ev.last_run_at, locale) : '–', next: formatDateTime(ev.next_run_at, locale) })}
      </p>

      {/* Signals */}
      <h3 className="mt-6 text-sm font-semibold text-slate-900 dark:text-white">{t('ofi.admin.signals')}</h3>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full min-w-[34rem] text-sm">
          <thead>
            <tr className="text-start text-xs text-slate-500 dark:text-slate-400">
              <th className="py-1.5 text-start font-medium">{t('ofi.admin.signal')}</th>
              <th className="py-1.5 text-start font-medium">{t('ofi.admin.on')}</th>
              <th className="py-1.5 text-start font-medium">{t('ofi.admin.weightCol')}</th>
              <th className="py-1.5 text-start font-medium">{t('ofi.admin.lastRead')}</th>
            </tr>
          </thead>
          <tbody>
            {signals.map((s) => (
              <tr key={s.id} className="border-t border-slate-200 align-top dark:border-slate-800">
                <td className="py-2 pe-2">
                  <span className="text-slate-900 dark:text-white">{lang === 'he' ? s.name_he : s.name_en}</span>
                  {s.is_circuit_breaker ? <span className="ms-1 text-xs text-red-600 dark:text-red-400">({t('ofi.admin.breaker')})</span> : null}
                  {s.last_error ? <span className="mt-0.5 block text-xs text-amber-700 dark:text-amber-400" dir="ltr">{s.last_error}</span> : null}
                </td>
                <td className="py-2 pe-2">
                  <input type="checkbox" className="size-4 accent-sky-600" checked={s.enabled} disabled={busy !== null}
                    aria-label={lang === 'he' ? s.name_he : s.name_en}
                    onChange={(e) => run(`en-${s.id}`, () => adminUpdateSignal(s.id, { enabled: e.target.checked }), t('ofi.admin.saved'))} />
                </td>
                <td className="py-2 pe-2">
                  <input className={cn(input, 'h-8 w-20')} type="number" min={0} max={10} step={0.1} defaultValue={Number(s.weight)} dir="ltr"
                    aria-label={t('ofi.admin.weightCol')}
                    onBlur={(e) => {
                      const w = Number(e.target.value);
                      if (w >= 0 && w <= 10 && w !== Number(s.weight)) void run(`w-${s.id}`, () => adminUpdateSignal(s.id, { weight: w }), t('ofi.admin.saved'));
                    }} />
                </td>
                <td className="py-2 text-xs text-slate-500 dark:text-slate-400">{s.last_updated ? formatDateTime(s.last_updated, locale) : '–'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">{t('ofi.admin.weightsHint')}</p>
      <OfiAdminTools slug={slug} eventId={ev.id} polymarket={signals.find((x) => x.key === 'polymarket')}
        onChanged={() => { void reload(); onChanged(); }} />
    </section>
  );
}
