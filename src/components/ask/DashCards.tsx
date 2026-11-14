import { BarChart3, Loader2, MapPin, RotateCcw } from 'lucide-react';
import { useI18n } from '@/i18n';
import { changeText, DASH_CREDITS, fmtNum, type DashState } from '@/lib/askStats';
import { cn } from '@/utils/cn';

const chip = 'inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-xs font-semibold ring-1 disabled:opacity-50';

/** The map's "dashboard or text?" question: two quick replies (free). */
export function ClarifyChips({ left, busy, onPick }: { left: number | null; busy: boolean; onPick: (chip: 'dashboard' | 'text') => void }) {
  const { t } = useI18n();
  return (
    <div className="mt-1.5 flex flex-wrap gap-1.5">
      <button type="button" data-ask-chip="dashboard" disabled={busy} onClick={(e) => (e.stopPropagation(), onPick('dashboard'))}
        className={cn(chip, 'bg-sky-600 text-white ring-sky-600 hover:bg-sky-500')}>
        <BarChart3 className="size-3.5" aria-hidden />
        {left === null ? t('dash.chipDashboardFree') : t('dash.chipDashboard', { n: DASH_CREDITS })}
      </button>
      <button type="button" data-ask-chip="text" disabled={busy} onClick={(e) => (e.stopPropagation(), onPick('text'))}
        className={cn(chip, 'bg-white text-slate-700 ring-slate-300 hover:bg-slate-50 dark:bg-slate-900 dark:text-slate-200 dark:ring-slate-700')}>
        {t('dash.chipText')}
      </button>
    </div>
  );
}

/** A dashboard in the thread: build progress → the headline line with Open / Show on map → failed + Retry. */
export function DashCard({ state, onOpen, onShow, onRetry }: { state: DashState; onOpen: () => void; onShow: () => void; onRetry: () => void }) {
  const { t } = useI18n();
  const r = state.result;
  const btn = 'inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-semibold';
  return (
    <div data-dash-card data-status={state.status} data-stage={state.stage} className="mt-1 rounded-lg bg-slate-50 p-2 ring-1 ring-slate-200 dark:bg-slate-800/60 dark:ring-slate-700" onClick={(e) => e.stopPropagation()}>
      {state.status === 'running' ? (
        <div role="status">
          <p className="flex items-center gap-1.5 text-xs font-semibold text-slate-700 dark:text-slate-200">
            <Loader2 className="size-3.5 animate-spin text-sky-600" aria-hidden />
            {state.stage === 'classifying' && state.progress
              ? t('dash.stage.classifying', { done: fmtNum(state.progress.done), total: fmtNum(state.progress.total) })
              : t(`dash.stage.${state.stage}`)}
          </p>
          <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
            <div className="h-full rounded-full bg-sky-500 transition-[width] duration-500"
              style={{ width: `${state.stage === 'finding' ? 8 : state.stage === 'classifying' ? 10 + 70 * (state.progress?.total ? state.progress.done / state.progress.total : 0) : state.stage === 'merging' ? 85 : 95}%` }} />
          </div>
        </div>
      ) : state.status === 'done' && r ? (
        <div>
          <p className="text-sm font-semibold text-slate-900 dark:text-white" dir="auto">{r.title}</p>
          <p className="text-xs text-slate-600 dark:text-slate-300" dir="auto">
            {r.totals.previous == null
              ? t('dash.cardLineNoPrev', { count: fmtNum(r.totals.incidents) })
              : t('dash.cardLine', { count: fmtNum(r.totals.incidents), change: changeText(r.totals.change_pct, t('dash.tile.none')), prev: t(`dash.prev.${r.period.preset ?? 'custom'}`) })}
          </p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            <button type="button" data-dash-action="open" onClick={onOpen} className={cn(btn, 'bg-sky-600 text-white hover:bg-sky-500')}>
              <BarChart3 className="size-3.5" aria-hidden />
              {t('dash.open')}
            </button>
            {r.totals.incidents ? (
              <button type="button" data-dash-action="show" onClick={onShow} className={cn(btn, 'text-sky-700 hover:bg-sky-50 dark:text-sky-400 dark:hover:bg-sky-500/10')}>
                <MapPin className="size-3.5" aria-hidden />
                {t('dash.show')}
              </button>
            ) : null}
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <p className="min-w-0 flex-1 text-xs text-red-700 dark:text-red-400">{t('dash.failed')}</p>
          <button type="button" data-dash-action="retry" onClick={onRetry} className={cn(btn, 'text-sky-700 hover:bg-sky-50 dark:text-sky-400')}>
            <RotateCcw className="size-3.5" aria-hidden />
            {t('dash.retry')}
          </button>
        </div>
      )}
    </div>
  );
}
