import { useCallback, useEffect, useState } from 'react';
import { Loader2, Trash2 } from 'lucide-react';
import { useI18n } from '@/i18n';
import { useToast } from '@/components/common/Toast';
import {
  adminAddTerm, adminBacktest, adminLexicon, adminRemoveTerm, adminResolve, adminSearchMarkets, adminSetSignalConfig,
  type OfiAdminSignal, type OfiLexiconTerm,
} from '@/services/ofiService';
import { cn } from '@/utils/cn';

const input = 'h-9 rounded-lg border border-slate-300 bg-white px-2.5 text-sm text-slate-900 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/30 dark:border-slate-700 dark:bg-slate-900 dark:text-white';
const btn = 'inline-flex h-9 items-center justify-center gap-1.5 rounded-lg px-3.5 text-sm font-semibold disabled:opacity-60';
const h3 = 'mt-6 text-sm font-semibold text-slate-900 dark:text-white';
const CATS = ['escalation', 'de_escalation', 'intercept', 'proxy', 'airspace', 'threat', 'evacuation'] as const;

/** More super-admin tools under the main panel: resolve windows, lexicon, prediction markets, backtest. */
export function OfiAdminTools({ slug, eventId, polymarket, onChanged }: { slug: string; eventId: string; polymarket?: OfiAdminSignal; onChanged: () => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const run = async (key: string, fn: () => Promise<unknown>, ok?: string) => {
    setBusy(key);
    try {
      const r = await fn();
      if (ok) toast.success(ok);
      return r;
    } catch (e) {
      toast.error(String((e as Error)?.message ?? e));
    } finally {
      setBusy(null);
    }
  };

  // Resolve a window
  const [start, setStart] = useState(() => new Date(Date.now() - 86_400_000).toISOString().slice(0, 16));
  const [outcome, setOutcome] = useState(false);
  const [notes, setNotes] = useState('');

  // Lexicon
  const [terms, setTerms] = useState<OfiLexiconTerm[]>([]);
  const [term, setTerm] = useState('');
  const [cat, setCat] = useState<(typeof CATS)[number]>('escalation');
  const [weight, setWeight] = useState(1);
  const loadTerms = useCallback(() => adminLexicon(eventId).then(setTerms).catch(() => setTerms([])), [eventId]);
  useEffect(() => {
    void loadTerms();
  }, [loadTerms]);

  // Markets
  const cfg = (polymarket?.config ?? {}) as { search?: string; markets?: { slug: string; invert?: boolean }[] };
  const [markets, setMarkets] = useState(cfg.markets ?? []);
  const [q, setQ] = useState(cfg.search ?? 'iran');
  const [found, setFound] = useState<{ slug: string; question: string; end_date: string; prices: string }[]>([]);

  // Backtest
  const [bt, setBt] = useState<Awaited<ReturnType<typeof adminBacktest>> | null>(null);

  return (
    <div className="mt-2">
      {/* Resolve */}
      <h3 className={h3}>{t('ofi.admin.resolve')}</h3>
      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{t('ofi.admin.resolveHint')}</p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <input type="datetime-local" className={input} value={start} onChange={(e) => setStart(e.target.value)} dir="ltr" aria-label={t('ofi.admin.windowStart')} />
        <select className={input} value={outcome ? 'yes' : 'no'} onChange={(e) => setOutcome(e.target.value === 'yes')}>
          <option value="no">{t('ofi.notHappened')}</option>
          <option value="yes">{t('ofi.happened')}</option>
        </select>
        <input className={cn(input, 'min-w-0 flex-1')} value={notes} maxLength={500} onChange={(e) => setNotes(e.target.value)} placeholder={t('ofi.admin.notePh')} />
        <button type="button" disabled={busy !== null} className={cn(btn, 'bg-sky-600 text-white hover:bg-sky-700')}
          onClick={() => void run('resolve', async () => { await adminResolve(slug, new Date(start).toISOString(), outcome, notes); onChanged(); }, t('ofi.admin.saved'))}>
          {t('ofi.admin.resolveSave')}
        </button>
      </div>

      {/* Lexicon */}
      <h3 className={h3}>{t('ofi.admin.lexicon')}</h3>
      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{t('ofi.admin.lexiconHint')}</p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <input className={cn(input, 'min-w-0 flex-1')} value={term} maxLength={120} onChange={(e) => setTerm(e.target.value)} placeholder={t('ofi.admin.termPh')} dir="auto" />
        <select className={input} value={cat} onChange={(e) => setCat(e.target.value as (typeof CATS)[number])}>
          {CATS.map((c) => <option key={c} value={c}>{t(`ofi.cat.${c}`)}</option>)}
        </select>
        <input className={cn(input, 'w-20')} type="number" min={0.1} max={10} step={0.1} value={weight} onChange={(e) => setWeight(Number(e.target.value))} dir="ltr" aria-label={t('ofi.admin.weightCol')} />
        <button type="button" disabled={busy !== null || !term.trim()} className={cn(btn, 'bg-sky-600 text-white hover:bg-sky-700')}
          onClick={() => void run('term', async () => { await adminAddTerm(eventId, term, cat, weight); setTerm(''); await loadTerms(); }, t('ofi.admin.saved'))}>
          {t('ofi.admin.addTerm')}
        </button>
      </div>
      <details className="mt-2">
        <summary className="cursor-pointer text-xs font-medium text-slate-600 dark:text-slate-300">{t('ofi.admin.showTerms', { n: terms.length })}</summary>
        <ul className="mt-2 max-h-64 overflow-y-auto text-sm">
          {terms.map((x) => (
            <li key={x.id} className="flex items-center justify-between gap-2 border-t border-slate-200 py-1 dark:border-slate-800">
              <span dir="auto" className="text-slate-800 dark:text-slate-100">{x.term}</span>
              <span className="ms-auto text-xs text-slate-500">{t(`ofi.cat.${x.category as (typeof CATS)[number]}`)}, {Number(x.weight)}</span>
              <button type="button" aria-label={t('ofi.alerts.remove')} className="rounded p-1 text-slate-400 hover:text-red-600"
                onClick={() => void run(`rm-${x.id}`, async () => { await adminRemoveTerm(x.id); await loadTerms(); })}>
                <Trash2 className="size-3.5" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      </details>

      {/* Prediction markets */}
      {polymarket ? (
        <>
          <h3 className={h3}>{t('ofi.admin.markets')}</h3>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{t('ofi.admin.marketsHint')}</p>
          <ul className="mt-2 space-y-1 text-sm">
            {markets.map((m, i) => (
              <li key={m.slug} className="flex flex-wrap items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-slate-800 dark:text-slate-100" dir="ltr">{m.slug}</span>
                <label className="flex items-center gap-1 text-xs text-slate-600 dark:text-slate-300">
                  <input type="checkbox" className="accent-sky-600" checked={!!m.invert}
                    onChange={(e) => setMarkets(markets.map((x, j) => (j === i ? { ...x, invert: e.target.checked } : x)))} />
                  {t('ofi.admin.invert')}
                </label>
                <button type="button" aria-label={t('ofi.alerts.remove')} className="rounded p-1 text-slate-400 hover:text-red-600"
                  onClick={() => setMarkets(markets.filter((_, j) => j !== i))}><Trash2 className="size-3.5" aria-hidden /></button>
              </li>
            ))}
          </ul>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <input className={cn(input, 'w-40')} value={q} onChange={(e) => setQ(e.target.value)} dir="ltr" aria-label={t('ofi.admin.search')} />
            <button type="button" disabled={busy !== null} className={cn(btn, 'ring-1 ring-slate-300 hover:bg-slate-50 dark:ring-slate-700 dark:hover:bg-slate-800')}
              onClick={() => void run('find', async () => setFound((await adminSearchMarkets(q)).markets))}>
              {busy === 'find' ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}{t('ofi.admin.search')}
            </button>
            <button type="button" disabled={busy !== null} className={cn(btn, 'bg-sky-600 text-white hover:bg-sky-700')}
              onClick={() => void run('mk', async () => { await adminSetSignalConfig(polymarket.id, { ...cfg, search: q, markets }); onChanged(); }, t('ofi.admin.saved'))}>
              {t('ofi.admin.saveMarkets')}
            </button>
          </div>
          {found.length ? (
            <ul className="mt-2 max-h-56 overflow-y-auto rounded-lg border border-slate-200 text-sm dark:border-slate-800">
              {found.map((m) => (
                <li key={m.slug} className="flex items-center justify-between gap-2 border-b border-slate-100 px-2 py-1.5 last:border-0 dark:border-slate-800">
                  <span className="min-w-0 text-slate-800 dark:text-slate-100" dir="ltr">{m.question} <span className="text-xs text-slate-500">({m.end_date?.slice(0, 10)}, {m.prices})</span></span>
                  <button type="button" className="shrink-0 text-xs font-semibold text-sky-700 hover:underline dark:text-sky-400"
                    onClick={() => !markets.some((x) => x.slug === m.slug) && setMarkets([...markets, { slug: m.slug, invert: /ceasefire|continues/i.test(m.question) }])}>
                    {t('ofi.admin.addMarket')}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </>
      ) : null}

      {/* Backtest */}
      <h3 className={h3}>{t('ofi.admin.backtest')}</h3>
      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{t('ofi.admin.backtestHint')}</p>
      <button type="button" disabled={busy !== null} className={cn(btn, 'mt-2 ring-1 ring-slate-300 hover:bg-slate-50 dark:ring-slate-700 dark:hover:bg-slate-800')}
        onClick={() => void run('bt', async () => setBt(await adminBacktest(slug)))}>
        {busy === 'bt' ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}{t('ofi.admin.runBacktest')}
      </button>
      {bt ? (
        <p className="mt-2 text-sm text-slate-700 dark:text-slate-300">
          {t('ofi.admin.backtestResult', {
            days: bt.days, ev: bt.event_days, bm: bt.brier_model.toFixed(4), bb: bt.brier_base_rate.toFixed(4),
            pe: ((bt.mean_p_event_days ?? 0) * 100).toFixed(1), po: ((bt.mean_p_other_days ?? 0) * 100).toFixed(1),
          })}
        </p>
      ) : null}
    </div>
  );
}
