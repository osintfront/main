import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { FileDown, ImageDown, Loader2, X } from 'lucide-react';
import { useI18n } from '@/i18n';
import { useTheme } from '@/context/ThemeContext';
import { DASH_CREDITS, exportFileName, fmtNum, PRESETS, sourceLines, type DashSelection, type DashState, type Preset } from '@/lib/askStats';
import { SITE_URL } from '@/config/welcome';
import { EXPORT_WIDTH } from '@/lib/dashExportLayout';
import { mapShapesReady } from './MiniMap';
import { type View } from '@/lib/dashGeometry';
import { DashboardSheet } from './DashboardSheet';
import { TipBox, useTip } from './charts/Tip';
import { DASH_COLORS, DashColorsContext } from './charts/dashColors';
import { cn } from '@/utils/cn';

/** The statistics dashboard window: full screen on a phone, a large modal on a desktop. */
export function StatsDashboard({ state, staff, left, onSelect, onPeriod, onClose }: {
  state: DashState; staff: boolean; left: number | null; onSelect: (sel: DashSelection) => void; onPeriod: (preset: Preset) => Promise<void> | void; onClose: () => void;
}) {
  const { t, dir } = useI18n();
  const exportRef = useRef<HTMLDivElement>(null);
  const { theme } = useTheme();
  const { tip, text, at } = useTip();
  const [preparedFor, setPreparedFor] = useState('');
  const [view, setView] = useState<View | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState<'pdf' | 'jpeg' | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  /** A chip was pressed and its request is on the way (the chips stay off until the rebuild shows). */
  const [pending, setPending] = useState(false);
  const r = state.result;
  useEffect(() => { closeRef.current?.focus(); }, []);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape' && !tip.shown) onClose(); };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose, tip.shown]);
  // A new figure set (period rebuild): the map fits its hotspots again.
  useEffect(() => setView(null), [state.id]);
  useEffect(() => {
    const n = state.note;
    setError(n === 'failed' ? t('dash.failed') : n === 'too_many' ? t('dash.tooMany') : n === 'busy' ? t('dash.busy') : n === 'quota' ? t('dash.needCredits', { n: DASH_CREDITS, left: left ?? 0 }) : null);
  }, [state.note]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!r) return null;
  const rebuilding = !!state.rebuild || pending;
  const showCost = !staff && left !== null;
  const pick = (p: Preset) => {
    if (rebuilding || p === r.period.preset) return;
    if (left !== null && !staff && left < DASH_CREDITS) return setError(t('dash.needCredits', { n: DASH_CREDITS, left }));
    setError(null);
    setPending(true);
    // Whatever the reply (a rebuild, or the same refusal twice), the chips come back.
    void Promise.resolve(onPeriod(p)).finally(() => setPending(false));
  };
  const frame = () => new Promise<void>((ok) => requestAnimationFrame(() => ok()));
  /** One export at a time: the off-screen light copy (current period, prepared-for and map view) → the file. */
  const run = async (kind: 'pdf' | 'jpeg') => {
    if (exporting) return;
    setExporting(kind);
    setError(null);
    try {
      await frame();
      await frame();
      await mapShapesReady();
      await frame();
      const node = exportRef.current;
      if (!node) throw new Error('no export node');
      const lib = await import('@/lib/dashboardExport');
      if (kind === 'jpeg') lib.download(await lib.renderJpeg(node), exportFileName(r.title, 'jpg'));
      else {
        const generated = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Jerusalem', numberingSystem: 'latn', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date());
        lib.download(await lib.renderPdf(node, {
          sources: sourceLines(r, SITE_URL), dir,
          labels: { sources: t('dash.sources'), preparedFor: preparedFor.trim() ? t('dash.preparedForName', { name: preparedFor.trim() }) : null, generated: t('dash.generated', { time: generated }), site: 'osintfront.com' },
          logoUrl: '/icon-192.png',
        }), exportFileName(r.title, 'pdf'));
      }
    } catch {
      setError(t('dash.exportFailed'));
    } finally {
      setExporting(null);
    }
  };
  const btn = 'inline-flex h-10 items-center justify-center gap-1.5 rounded-lg px-3 text-sm font-semibold';
  return (
    <div className="fixed inset-0 z-[2500] flex items-stretch justify-center bg-slate-950/55 sm:items-center sm:p-4" onClick={() => (tip.shown ? tip.hide() : onClose())}>
      <div data-dash data-dash-sheet data-dash-theme={theme === 'dark' ? 'dark' : 'light'} role="dialog" aria-modal="true" aria-label={r.title}
        onClick={(e) => (e.stopPropagation(), tip.shown && tip.hide())}
        className="ofm-scroll relative flex h-full w-full flex-col overflow-y-auto sm:h-auto sm:max-h-[92vh] sm:max-w-[1040px] sm:rounded-2xl sm:shadow-2xl"
        style={{ background: 'var(--dash-bg)', color: 'var(--dash-ink)' }}>
        <div className="sticky top-0 z-10 flex flex-wrap items-center gap-1.5 border-b px-3 py-2" style={{ background: 'var(--dash-bg)', borderColor: 'var(--dash-line)' }}>
          <span className="me-1 text-xs font-semibold" style={{ color: 'var(--dash-muted)' }}>{t('dash.periods')}</span>
          {PRESETS.map((p) => (
            <button key={p} type="button" data-dash-period={p} aria-pressed={r.period.preset === p} disabled={rebuilding} onClick={() => pick(p)}
              className={cn('h-8 rounded-full px-3 text-xs font-semibold ring-1 disabled:opacity-60', r.period.preset === p ? 'text-white' : '')}
              style={r.period.preset === p ? { background: 'var(--dash-accent)', borderColor: 'var(--dash-accent)' } : { color: 'var(--dash-ink)', borderColor: 'var(--dash-line)' }}>
              {t(`dash.period.${p}`)}{showCost && r.period.preset !== p ? ` ${t('dash.cost', { n: DASH_CREDITS })}` : ''}
            </button>
          ))}
          <button ref={closeRef} type="button" data-dash-action="close" onClick={onClose} aria-label={t('common.close')}
            className="ms-auto inline-flex size-9 items-center justify-center rounded-lg" style={{ color: 'var(--dash-ink)' }}>
            <X className="size-5" aria-hidden />
          </button>
          {state.rebuild ? (
            <p data-dash-progress role="status" className="flex w-full items-center gap-1.5 text-xs font-semibold" style={{ color: 'var(--dash-muted)' }}>
              <Loader2 className="size-3.5 animate-spin" aria-hidden />
              {state.rebuild.stage === 'classifying' && state.rebuild.progress
                ? t('dash.stage.classifying', { done: fmtNum(state.rebuild.progress.done), total: fmtNum(state.rebuild.progress.total) })
                : t(`dash.stage.${state.rebuild.stage}`)}
            </p>
          ) : null}
          {error ? <p data-dash-error role="alert" className="w-full text-xs font-semibold text-red-600">{error}</p> : null}
        </div>
        <div className={cn('transition-opacity', rebuilding && 'pointer-events-none opacity-50')}>
          <DashColorsContext.Provider value={DASH_COLORS[theme === 'dark' ? 'dark' : 'light']}>
            <DashboardSheet result={r} preparedFor={preparedFor} view={view} variant="screen" staff={staff} onPreparedFor={setPreparedFor} onView={setView} onSelect={onSelect} tip={tip} />
          </DashColorsContext.Provider>
        </div>
        <div className="grid grid-cols-2 gap-2 border-t px-4 py-3" style={{ borderColor: 'var(--dash-line)' }}>
          <button type="button" data-dash-action="pdf" disabled={!!exporting} onClick={(e) => (e.stopPropagation(), void run('pdf'))} className={cn(btn, 'text-white disabled:opacity-60')} style={{ background: 'var(--dash-accent)' }}>
            {exporting === 'pdf' ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <FileDown className="size-4" aria-hidden />}
            {exporting === 'pdf' ? t('dash.exporting') : t('dash.pdf')}
          </button>
          <button type="button" data-dash-action="jpeg" disabled={!!exporting} onClick={(e) => (e.stopPropagation(), void run('jpeg'))} className={cn(btn, 'ring-1 disabled:opacity-60')} style={{ color: 'var(--dash-ink)', borderColor: 'var(--dash-line)' }}>
            {exporting === 'jpeg' ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <ImageDown className="size-4" aria-hidden />}
            {exporting === 'jpeg' ? t('dash.exporting') : t('dash.jpeg')}
          </button>
        </div>
      </div>
      <TipBox text={text} at={at} />
      {exporting
        ? createPortal(
            <div ref={exportRef} data-dash-export data-dash-theme="light" dir={dir} style={{ position: 'fixed', left: -20000, top: 0, width: EXPORT_WIDTH }}>
              <DashColorsContext.Provider value={DASH_COLORS.light}>
                <DashboardSheet result={r} preparedFor={preparedFor} view={view} variant="export" />
              </DashColorsContext.Provider>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
