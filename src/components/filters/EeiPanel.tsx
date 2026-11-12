import { useMemo, useState } from 'react';
import { Loader2, Plus, Star, Trash2, X } from 'lucide-react';
import { useI18n } from '@/i18n';
import { AREAS } from '@/lib/eventFilters';
import { theatreColor, theatreTopics, type EeiList, type EeiTags, type EeiTheatre, type EeiView } from '@/lib/eeiLens';
import { openGate } from '@/components/plans/GateDialog';
import { myPlan } from '@/lib/plans';
import { parseEei } from '@/services/eeiService';
import type { PublicEvent } from '@/types/event';
import { cn } from '@/utils/cn';

interface EeiPanelProps {
  list: EeiList | null;
  rawText: string;
  prev: { rawText: string; list: EeiList } | null;
  tags: EeiTags;
  degraded: boolean;
  /** Events of the last 24 h in theatres that are on with no mark yet. */
  waiting: number;
  view: EeiView;
  onView: (v: EeiView) => void;
  onSave: (rawText: string, list: EeiList) => Promise<void>;
  onClear: () => Promise<void>;
  onRestore: () => Promise<void>;
  /** Everything loaded: the counts per theatre / topic. */
  events: PublicEvent[];
}

const MAX_RAW = 4000;
const MAX_TOPICS = 12;
const btn = 'inline-flex min-h-9 items-center justify-center gap-1.5 rounded-lg px-3 text-[13px] font-semibold disabled:opacity-50 sm:min-h-8 sm:text-xs';
const primary = cn(btn, 'bg-sky-600 text-white hover:bg-sky-500');
const secondary = cn(btn, 'border border-slate-200 text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800');
const input = 'h-9 w-full min-w-0 rounded-lg border border-slate-200 bg-white px-2 text-base text-slate-900 sm:text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-white';

/** The EEI (צי"ח) scope of the filter panel: paste → preview / edit → list in force. */
export function EeiPanel({ list, rawText, prev, tags, degraded, waiting, view, onView, onSave, onClear, onRestore, events }: EeiPanelProps) {
  const { t, lang } = useI18n();
  const [mode, setMode] = useState<'text' | 'preview' | null>(null);
  const [text, setText] = useState(rawText);
  const [draft, setDraft] = useState<EeiList | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const state = mode ?? (list ? 'active' : 'text');

  const fail = (e: unknown) => {
    const code = e instanceof Error ? e.message : 'failed';
    if (code === 'upgrade') return openGate(myPlan() === 'guest' ? 'signup' : 'upgrade', 'eei_text');
    setError(t(code === 'empty' ? 'eeiList.empty' : code === 'quota' ? 'eeiList.quota' : code === 'budget' ? 'eeiList.degraded' : 'eeiList.failed'));
  };
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  const analyse = () =>
    run(async () => {
      const parsed = await parseEei(text);
      setDraft(parsed);
      setMode('preview');
    });
  const save = () =>
    run(async () => {
      if (!draft) return;
      await onSave(text, draft);
      setDraft(null);
      setMode(null);
    });

  const areaLabel = (id: string) => {
    const a = AREAS.find((x) => x.id === id);
    return a ? (lang === 'he' ? a.he : a.en) : id.replace(/^c:/, '');
  };
  const editTheatre = (i: number, fn: (th: EeiTheatre) => EeiTheatre) =>
    setDraft((d) => (d ? { theatres: d.theatres.map((th, k) => (k === i ? fn(th) : th)) } : d));

  const counts = useMemo(() => {
    const now = Date.now();
    const byTheatre = new Map<string, number>();
    const byTopic = new Map<string, number>();
    const all = { off: [], topicsOff: [], priorityOnly: false };
    for (const th of list?.theatres ?? []) {
      let n = 0;
      for (const e of events) {
        const topics = theatreTopics(e, th, tags, all, now);
        if (!topics.length) continue;
        n++;
        for (const tp of topics) byTopic.set(`${th.id}:${tp.key}`, (byTopic.get(`${th.id}:${tp.key}`) ?? 0) + 1);
      }
      byTheatre.set(th.id, n);
    }
    return { byTheatre, byTopic };
  }, [list, events, tags]);

  return (
    <div data-eei-panel className="space-y-3 px-4 py-3">
      {error ? <p className="rounded-lg bg-red-50 px-3 py-2 text-xs font-medium text-red-800 dark:bg-red-500/10 dark:text-red-300">{error}</p> : null}

      {state === 'text' ? (
        <>
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">{t('eeiList.paste')}</span>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              maxLength={MAX_RAW}
              dir="auto"
              rows={8}
              className="w-full rounded-lg border border-slate-200 bg-white p-2 text-base text-slate-900 sm:text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-white"
            />
            <span className="block text-end font-mono text-[11px] text-slate-400" dir="ltr">
              {text.length}/{MAX_RAW}
            </span>
          </label>
          <div className="flex flex-wrap gap-2">
            <button type="button" data-eei-action="analyse" onClick={analyse} disabled={busy || text.trim().length < 10} className={primary}>
              {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
              {busy ? t('eeiList.analysing') : t('eeiList.analyse')}
            </button>
            {prev ? (
              <button type="button" data-eei-action="restore" onClick={() => run(async () => { await onRestore(); setMode(null); })} disabled={busy} className={secondary}>
                {t('eeiList.restore')}
              </button>
            ) : null}
            {list ? (
              <button type="button" onClick={() => setMode(null)} className={secondary}>
                <X className="size-4" aria-hidden />
              </button>
            ) : null}
          </div>
        </>
      ) : null}

      {state === 'preview' && draft ? (
        <>
          {draft.theatres.map((th, i) => (
            <section key={`${th.id}-${i}`} data-eei-theatre={th.id} className="space-y-2 rounded-xl border border-slate-200 p-2.5 dark:border-slate-700">
              <div className="flex items-center gap-2">
                <span className="size-3 shrink-0 rounded-full" style={{ background: theatreColor(i) }} aria-hidden />
                {th.kind === 'exceptional' ? (
                  <p className="min-w-0 flex-1 text-sm font-semibold">{t('eeiList.exceptional')}</p>
                ) : (
                  <input aria-label={t('eeiList.theatre')} value={th.name} maxLength={40} dir="auto" onChange={(e) => editTheatre(i, (x) => ({ ...x, name: e.target.value }))} className={input} />
                )}
                <button type="button" data-eei-action="remove-theatre" aria-label={t('sets.delete')} onClick={() => setDraft((d) => (d ? { theatres: d.theatres.filter((_, k) => k !== i) } : d))} className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg text-slate-500 hover:bg-red-50 hover:text-red-700 dark:hover:bg-red-500/10">
                  <Trash2 className="size-4" aria-hidden />
                </button>
              </div>
              {th.kind === 'exceptional' ? (
                <p className="text-xs text-slate-500 dark:text-slate-400">{t('eeiList.exceptionalHint')}</p>
              ) : (
                <>
                  <div className="flex flex-wrap gap-1">
                    {AREAS.map((a) => {
                      const on = th.areas.includes(a.id);
                      return (
                        <button
                          key={a.id}
                          type="button"
                          aria-pressed={on}
                          onClick={() => editTheatre(i, (x) => ({ ...x, areas: on ? x.areas.filter((y) => y !== a.id) : [...x.areas, a.id] }))}
                          className={cn('min-h-8 rounded-full border px-2.5 text-xs font-medium', on ? 'border-sky-600 bg-sky-600 text-white' : 'border-slate-200 text-slate-600 dark:border-slate-700 dark:text-slate-300')}
                        >
                          {lang === 'he' ? a.he : a.en}
                        </button>
                      );
                    })}
                    {th.areas.filter((a) => a.startsWith('c:')).map((a) => (
                      <span key={a} className="inline-flex min-h-8 items-center rounded-full border border-sky-600 bg-sky-600 px-2.5 text-xs font-medium text-white">{areaLabel(a)}</span>
                    ))}
                  </div>
                  {th.topics.map((tp, k) => (
                    <div key={tp.key} data-eei-topic={tp.key} className="flex items-center gap-1.5">
                      <button
                        type="button"
                        data-eei-action="priority"
                        aria-pressed={tp.priority}
                        aria-label={t('eeiList.priority')}
                        title={t('eeiList.priority')}
                        onClick={() => editTheatre(i, (x) => ({ ...x, topics: x.topics.map((y, m) => (m === k ? { ...y, priority: !y.priority } : y)) }))}
                        className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg hover:bg-amber-50 dark:hover:bg-amber-500/10"
                      >
                        <Star className={cn('size-4', tp.priority ? 'fill-amber-400 text-amber-500' : 'text-slate-400')} aria-hidden />
                      </button>
                      <input aria-label={t('eeiList.topic')} value={tp.label} maxLength={80} dir="auto" onChange={(e) => editTheatre(i, (x) => ({ ...x, topics: x.topics.map((y, m) => (m === k ? { ...y, label: e.target.value } : y)) }))} className={input} />
                      <button type="button" data-eei-action="remove-topic" aria-label={t('sets.delete')} onClick={() => editTheatre(i, (x) => ({ ...x, topics: x.topics.filter((_, m) => m !== k) }))} className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800">
                        <X className="size-4" aria-hidden />
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    data-eei-action="add-topic"
                    disabled={th.topics.length >= MAX_TOPICS}
                    onClick={() => editTheatre(i, (x) => ({ ...x, topics: [...x.topics, { key: `new-${Date.now().toString(36)}`, label: '', priority: false, categories: [], query: '' }] }))}
                    className={cn(btn, 'text-sky-700 hover:bg-sky-50 dark:text-sky-300 dark:hover:bg-sky-500/10')}
                  >
                    <Plus className="size-4" aria-hidden />
                    {t('eeiList.addTopic')}
                  </button>
                </>
              )}
            </section>
          ))}
          <div className="flex flex-wrap gap-2">
            <button type="button" data-eei-action="save" onClick={save} disabled={busy || !draft.theatres.length} className={primary}>
              {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
              {t('eeiList.save')}
            </button>
            <button type="button" data-eei-action="back" onClick={() => setMode('text')} disabled={busy} className={secondary}>
              {t('eeiList.back')}
            </button>
          </div>
        </>
      ) : null}

      {state === 'active' && list ? (
        <>
          <label className="flex items-center justify-between gap-2 text-sm font-semibold text-slate-700 dark:text-slate-200">
            {t('eeiList.priorityOnly')}
            <input type="checkbox" data-eei-action="priority-only" checked={view.priorityOnly} onChange={(e) => onView({ ...view, priorityOnly: e.target.checked })} className="size-5 accent-sky-600" />
          </label>
          {list.theatres.map((th, i) => {
            const off = view.off.includes(th.id);
            return (
              <section key={th.id} data-eei-theatre={th.id} className={cn('space-y-1.5 rounded-xl border border-slate-200 p-2.5 dark:border-slate-700', off && 'opacity-60')}>
                <div className="flex items-center gap-2">
                  <span className="size-3 shrink-0 rounded-full" style={{ background: theatreColor(i) }} aria-hidden />
                  <p className="min-w-0 flex-1 truncate text-sm font-semibold" dir="auto">
                    {th.kind === 'exceptional' ? t('eeiList.exceptional') : th.name}
                  </p>
                  <span className="font-mono text-[11px] tabular-nums text-slate-500">{counts.byTheatre.get(th.id) ?? 0}</span>
                  <button
                    type="button"
                    role="switch"
                    data-eei-action="toggle-theatre"
                    aria-checked={!off}
                    aria-label={t('sets.toggle')}
                    onClick={() => onView({ ...view, off: off ? view.off.filter((x) => x !== th.id) : [...view.off, th.id] })}
                    className={cn('relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors', !off ? 'bg-sky-600' : 'bg-slate-300 dark:bg-slate-700')}
                  >
                    <span className={cn('inline-block size-5 rounded-full bg-white shadow transition-transform', !off ? 'translate-x-[22px] rtl:-translate-x-[22px]' : 'translate-x-0.5 rtl:-translate-x-0.5')} />
                  </button>
                </div>
                {th.kind === 'exceptional' ? (
                  <p className="text-xs text-slate-500 dark:text-slate-400">{t('eeiList.exceptionalHint')}</p>
                ) : (
                  <div className="flex flex-wrap gap-1">
                    {th.topics.map((tp) => {
                      const id = `${th.id}:${tp.key}`;
                      const topicOff = view.topicsOff.includes(id);
                      return (
                        <button
                          key={tp.key}
                          type="button"
                          data-eei-topic={tp.key}
                          aria-pressed={!topicOff}
                          onClick={() => onView({ ...view, topicsOff: topicOff ? view.topicsOff.filter((x) => x !== id) : [...view.topicsOff, id] })}
                          className={cn(
                            'inline-flex min-h-8 max-w-full items-center gap-1 rounded-full border px-2.5 text-start text-xs font-medium',
                            topicOff ? 'border-slate-200 text-slate-400 line-through dark:border-slate-700' : 'border-slate-300 bg-slate-50 text-slate-800 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100',
                          )}
                        >
                          {tp.priority ? <Star className="size-3 shrink-0 fill-amber-400 text-amber-500" aria-hidden /> : null}
                          <span className="truncate" dir="auto">{tp.label}</span>
                          <span className="font-mono text-[11px] tabular-nums opacity-70">{counts.byTopic.get(id) ?? 0}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </section>
            );
          })}
          {degraded ? (
            <p data-eei-status="degraded" className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">{t('eeiList.degraded')}</p>
          ) : waiting > 0 ? (
            <p data-eei-status="waiting" className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
              <Loader2 className="size-3.5 animate-spin" aria-hidden />
              {t('eeiList.waiting', { count: waiting })}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <button type="button" data-eei-action="new" onClick={() => { setText(''); setMode('text'); }} className={secondary}>{t('eeiList.new')}</button>
            <button type="button" data-eei-action="edit" onClick={() => { setText(rawText); setDraft(list); setMode('preview'); }} className={secondary}>{t('eeiList.edit')}</button>
            {prev ? (
              <button type="button" data-eei-action="restore" onClick={() => run(onRestore)} disabled={busy} className={secondary}>{t('eeiList.restore')}</button>
            ) : null}
            <button
              type="button"
              data-eei-action="remove"
              onClick={() => {
                if (window.confirm(t('eeiList.removeConfirm'))) void run(async () => { await onClear(); setText(''); setMode(null); });
              }}
              disabled={busy}
              className={cn(btn, 'text-red-700 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-500/10')}
            >
              {t('eeiList.remove')}
            </button>
          </div>
        </>
      ) : null}
    </div>
  );
}
