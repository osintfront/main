import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Lock } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useI18n } from '@/i18n';
import type { TranslationKey } from '@/i18n/en';
import { OFI_TEXT } from '@/content/ofi';
import { openGate } from '@/components/plans/GateDialog';
import { getInsight, getTrackRecord, type OfiContribution, type OfiDetail, type OfiSignal, type OfiTrackRecord } from '@/services/ofiService';
import { formatDateTime } from '@/utils/time';
import { cn } from '@/utils/cn';
import { Gauge, MOOD_COLOR, moodOf, OfiAvatar, OfiDisclaimerShort, pct, Sparkline } from '@/components/ofi/OfiParts';
import { OfiAdminPanel } from '@/components/ofi/OfiAdminPanel';
import { GuestGate, OfiFrame, Trend, UpdateTimes } from './InsightsPage';

const card = 'rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-900/5 sm:p-6 dark:bg-slate-900 dark:ring-white/10';
const h2 = 'text-base font-semibold text-slate-900 dark:text-white';

const SOURCE_KEY: Record<string, TranslationKey> = {
  internal_events: 'ofi.src.internal', hfc: 'ofi.src.official', advisory: 'ofi.src.official', polymarket: 'ofi.src.market',
  finance: 'ofi.src.finance', manual: 'ofi.src.manual', engine: 'ofi.src.engine', notam: 'ofi.src.official',
  gdelt: 'ofi.src.internal', trends: 'ofi.src.internal', shipping: 'ofi.src.finance', rhetoric: 'ofi.src.internal',
};

/** OFI's speech bubble: the stored template text for Pro+, a number-only sentence for Free. */
function Bubble({ d }: { d: OfiDetail }) {
  const { t, lang } = useI18n();
  let text = lang === 'he' ? d.summary_he : d.summary_en;
  if (!text && d.probability != null) {
    text = d.previous_probability == null
      ? t('ofi.bubbleFirst', { p: pct(d.probability) })
      : Math.abs(d.probability - d.previous_probability) < 0.0005
        ? t('ofi.bubbleSame', { p: pct(d.probability) })
        : t(d.probability > d.previous_probability ? 'ofi.bubbleUp' : 'ofi.bubbleDown', {
            pts: Math.abs((d.probability - d.previous_probability) * 100).toFixed(1), p: pct(d.probability) });
  }
  if (!text) return null;
  return (
    <div className="flex items-start gap-3">
      <OfiAvatar mood={moodOf(d.probability)} size={40} className="shrink-0" />
      <p className="relative rounded-2xl rounded-ss-sm bg-slate-100 px-4 py-2.5 text-[15px] leading-relaxed text-slate-800 dark:bg-slate-800 dark:text-slate-100">{text}</p>
    </div>
  );
}

/** Base rate → each signal → final, in percentage points (they add up exactly). */
function Waterfall({ base, items, final }: { base: number; items: OfiContribution[]; final: number }) {
  const { t, lang } = useI18n();
  const rows: { label: string; from: number; to: number; kind: 'base' | 'up' | 'down' | 'final'; stale?: boolean }[] = [];
  let acc = base * 100;
  rows.push({ label: t('ofi.baseRate'), from: 0, to: acc, kind: 'base' });
  for (const c of items) {
    if (Math.abs(c.pp) < 0.005) continue;
    rows.push({ label: lang === 'he' ? c.name_he : c.name_en, from: acc, to: acc + c.pp, kind: c.pp > 0 ? 'up' : 'down', stale: c.stale });
    acc += c.pp;
  }
  rows.push({ label: t('ofi.final'), from: 0, to: final * 100, kind: 'final' });
  const max = Math.max(...rows.map((r) => Math.max(r.from, r.to))) * 1.08 || 1;
  const color = { base: '#94a3b8', up: '#d6342c', down: '#0e9f8b', final: MOOD_COLOR[moodOf(final)] };
  return (
    <div className="space-y-1.5">
      {rows.map((r, i) => {
        const lo = Math.min(r.from, r.to), hi = Math.max(r.from, r.to);
        const v = r.kind === 'base' || r.kind === 'final' ? `${r.to.toFixed(1)}%` : `${r.to - r.from > 0 ? '+' : '−'}${Math.abs(r.to - r.from).toFixed(2)}`;
        return (
          <div key={i} className="grid grid-cols-[minmax(0,10rem)_1fr_4rem] items-center gap-2 text-sm sm:grid-cols-[minmax(0,14rem)_1fr_4.5rem]">
            <span className={cn('truncate text-slate-700 dark:text-slate-300', (r.kind === 'final') && 'font-semibold text-slate-900 dark:text-white')} title={r.label}>
              {r.label}{r.stale ? <span className="ms-1 text-xs text-amber-600 dark:text-amber-400">({t('ofi.stale')})</span> : null}
            </span>
            <span className="relative h-3.5 rounded bg-slate-100 dark:bg-slate-800" dir="ltr">
              <span className="absolute inset-y-0 rounded" style={{ left: `${(lo / max) * 100}%`, width: `${Math.max(0.6, ((hi - lo) / max) * 100)}%`, background: color[r.kind] }} />
            </span>
            <span className="text-end tabular-nums text-slate-700 dark:text-slate-300" dir="ltr">{v}</span>
          </div>
        );
      })}
    </div>
  );
}

function SignalCards({ signals }: { signals: OfiSignal[] }) {
  const { t, lang, locale } = useI18n();
  const groups = new Map<string, OfiSignal[]>();
  for (const s of signals) {
    const g = SOURCE_KEY[s.source_type] ?? 'ofi.src.internal';
    groups.set(g, [...(groups.get(g) ?? []), s]);
  }
  return (
    <div className="space-y-5">
      {[...groups].map(([g, list]) => (
        <div key={g}>
          <h3 className="text-sm font-semibold text-slate-600 dark:text-slate-300">{t(g as TranslationKey)}</h3>
          <ul className="mt-2 grid gap-2 sm:grid-cols-2">
            {list.map((s) => {
              const last = s.readings.at(-1)?.[1];
              return (
                <li key={s.key} className="rounded-xl border border-slate-200 p-3 dark:border-slate-800">
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-sm font-medium text-slate-900 dark:text-white">{lang === 'he' ? s.name_he : s.name_en}</span>
                    {s.stale ? <span className="shrink-0 text-xs text-amber-600 dark:text-amber-400">{t('ofi.stale')}</span> : null}
                  </div>
                  <div className="mt-1 flex items-end justify-between gap-2">
                    <span className="text-xs text-slate-500 dark:text-slate-400">
                      {t('ofi.weight', { w: Number(s.weight).toFixed(1) })}
                      {last != null ? <> {t('ofi.reading', { s: Math.round(last * 100) })}</> : null}
                      {s.last_updated ? <span className="block">{formatDateTime(s.last_updated, locale)}</span> : null}
                    </span>
                    {s.readings.length > 1 ? (
                      <span className="text-slate-500 dark:text-slate-400"><Sparkline points={s.readings} width={90} height={26} /></span>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}

function History({ history }: { history: NonNullable<OfiDetail['history']> }) {
  const { t, locale } = useI18n();
  if (history.length < 2) return <p className="text-sm text-slate-500 dark:text-slate-400">{t('ofi.historyShort')}</p>;
  return (
    <div>
      <div className="text-slate-700 dark:text-slate-300"><Sparkline points={history.map((h) => [h.ts, h.p])} width={640} height={90} className="h-auto w-full" /></div>
      <ul className="mt-3 space-y-1 text-xs text-slate-600 dark:text-slate-400">
        {history.filter((h) => h.trigger !== 'schedule').slice(-6).map((h) => (
          <li key={h.ts}>{formatDateTime(h.ts, locale)}: {pct(h.p)} ({t(h.trigger === 'circuit_breaker' ? 'ofi.trigBreaker' : 'ofi.trigManual')})</li>
        ))}
      </ul>
    </div>
  );
}

function TrackRecord({ tr }: { tr: OfiTrackRecord | null }) {
  const { t, locale } = useI18n();
  if (!tr || tr.n === 0) return <p className="text-sm text-slate-500 dark:text-slate-400">{t('ofi.trackEmpty')}</p>;
  return (
    <div>
      <p className="text-sm text-slate-700 dark:text-slate-300">{t('ofi.trackSummary', { n: tr.n, brier: tr.brier?.toFixed(3) ?? '–' })}</p>
      <ul className="mt-2 space-y-1 text-sm">
        {tr.windows.slice(0, 10).map((w) => (
          <li key={w.start} className="flex justify-between gap-2 text-slate-600 dark:text-slate-400">
            <span>{formatDateTime(w.start, locale)}</span>
            <span className="tabular-nums">{w.p != null ? pct(w.p) : '–'}</span>
            <span className={w.outcome ? 'font-semibold text-red-600 dark:text-red-400' : ''}>{t(w.outcome ? 'ofi.happened' : 'ofi.notHappened')}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** /insights/:slug */
export function InsightDetailPage() {
  const { slug = '' } = useParams();
  const { t, lang } = useI18n();
  const { status, profile } = useAuth();
  const [d, setD] = useState<OfiDetail | null | undefined>(undefined);
  const [tr, setTr] = useState<OfiTrackRecord | null>(null);
  const signedIn = status === 'signed_in';
  const back = { to: '/insights', label: t('ofi.allInsights') };

  const load = useCallback(() => {
    if (!signedIn) return;
    getInsight(slug).then(setD).catch(() => setD(null));
    getTrackRecord(slug).then(setTr).catch(() => setTr(null));
  }, [slug, signedIn]);
  useEffect(load, [load]);

  if (status === 'loading') return <OfiFrame back={back}>{null}</OfiFrame>;
  if (!signedIn) return <OfiFrame back={back}><GuestGate /></OfiFrame>;
  if (d === undefined) return <OfiFrame back={back}><div className="h-64 animate-pulse rounded-2xl bg-slate-200/60 dark:bg-slate-800/60" aria-hidden /></OfiFrame>;
  if (d === null) return <OfiFrame back={back}><p className={card}>{t('ofi.notFound')}</p></OfiFrame>;

  const pro = d.signals !== null;
  const title = lang === 'he' ? d.title_he : d.title_en;
  const criteria = lang === 'he' ? d.resolution_criteria_he : d.resolution_criteria_en;
  const band = d.confidence_low != null && d.confidence_high != null ? ([d.confidence_low, d.confidence_high] as [number, number]) : null;
  const locked = d.signal_count - d.contributions.length;
  const tx = OFI_TEXT[lang === 'he' ? 'he' : 'en'];

  return (
    <OfiFrame back={back} mood={moodOf(d.probability)}>
      <div className="space-y-6">
        <section className={card}>
          <h2 className="text-xl font-bold leading-snug text-slate-900 dark:text-white">{title}</h2>
          <div className="mt-4 flex flex-col items-center gap-5 sm:flex-row sm:items-center">
            <div className="shrink-0">
              <Gauge value={d.probability} band={band} blurred={d.locked} size={230} />
              {band ? <p className="mt-1 text-center text-xs tabular-nums text-slate-500 dark:text-slate-400">{t('ofi.band', { lo: pct(band[0]), hi: pct(band[1]) })}</p> : null}
            </div>
            <div className="min-w-0 flex-1 space-y-3">
              {d.locked ? (
                <button type="button" onClick={() => openGate('upgrade')} className="inline-flex items-center gap-1.5 text-sm font-semibold text-sky-700 hover:underline dark:text-sky-400">
                  <Lock className="size-4" aria-hidden /> {t(d.min_tier >= 3 ? 'ofi.lockedMax' : 'ofi.lockedPro')}
                </button>
              ) : (
                <>
                  <Trend p={d.probability} prev={d.previous_probability} />
                  <Bubble d={d} />
                </>
              )}
              <UpdateTimes last={d.last_update} next={d.next_update} />
            </div>
          </div>
          <OfiDisclaimerShort className="mt-4" />
          <details className="mt-3 text-sm text-slate-600 dark:text-slate-300">
            <summary className="cursor-pointer font-medium text-slate-800 dark:text-slate-100">{t('ofi.criteria')}</summary>
            <p className="mt-2 leading-relaxed">{criteria}</p>
          </details>
        </section>

        {!d.locked ? (
          <section className={card}>
            <h2 className={h2}>{t('ofi.whyTitle')}</h2>
            {pro && d.base_rate != null && d.probability != null ? (
              <div className="mt-4"><Waterfall base={d.base_rate} items={d.contributions} final={d.probability} /></div>
            ) : (
              <div className="mt-3 space-y-3">
                {d.contributions.map((c) => (
                  <p key={c.key} className="text-sm text-slate-700 dark:text-slate-300">
                    {t('ofi.teaserOne', { name: lang === 'he' ? c.name_he : c.name_en, pp: `${c.pp > 0 ? '+' : '−'}${Math.abs(c.pp).toFixed(2)}` })}
                  </p>
                ))}
                {locked > 0 ? (
                  <button type="button" onClick={() => openGate('upgrade')}
                    className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-sky-600 px-4 text-sm font-semibold text-white hover:bg-sky-700">
                    <Lock className="size-4" aria-hidden /> {t('ofi.unlock', { n: locked })}
                  </button>
                ) : null}
              </div>
            )}
          </section>
        ) : null}

        {pro && d.signals ? (
          <section className={card}>
            <h2 className={h2}>{t('ofi.signalsTitle')}</h2>
            <div className="mt-4"><SignalCards signals={d.signals} /></div>
          </section>
        ) : null}

        {pro && d.history ? (
          <section className={card}>
            <h2 className={h2}>{t('ofi.historyTitle')}</h2>
            <div className="mt-4"><History history={d.history} /></div>
          </section>
        ) : null}

        {pro ? (
          <section className={card}>
            <h2 className={h2}>{t('ofi.modelTitle')}</h2>
            <ul className="mt-3 list-disc space-y-1.5 ps-5 text-sm leading-relaxed text-slate-700 dark:text-slate-300">
              {tx.model.map((m) => <li key={m}>{m}</li>)}
            </ul>
          </section>
        ) : null}

        <section className={card}>
          <h2 className={h2}>{t('ofi.trackTitle')}</h2>
          <div className="mt-3"><TrackRecord tr={tr} /></div>
        </section>

        {profile?.role === 'super_admin' ? <OfiAdminPanel slug={d.slug} onChanged={load} /> : null}

        {!pro && !d.locked ? (
          <p className="text-center text-sm text-slate-600 dark:text-slate-300">
            {t('ofi.proPitch')} <Link to="/packages" className="font-semibold text-sky-700 hover:underline dark:text-sky-400">{t('gate.plans')}</Link>
          </p>
        ) : null}
      </div>
    </OfiFrame>
  );
}
