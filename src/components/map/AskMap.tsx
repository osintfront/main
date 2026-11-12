import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Check, ChevronDown, ChevronUp, Copy, ListChecks, Loader2, Share2, Sparkles, SquarePen, X } from 'lucide-react';
import { useI18n } from '@/i18n';
import { authConfig } from '@/config/auth';
import { AREAS } from '@/lib/eventFilters';
import { MAX_TURNS, answerShareText, buildContext, summaryQuestion, whatsappUrl } from '@/lib/askChat';
import { AskError, askMap, type AskAnswer } from '@/services/askService';
import { cn } from '@/utils/cn';

interface AskMapProps {
  /** The conversation: one turn per question, oldest first. */
  turns: AskAnswer[];
  /** The turn whose events are on the map and in the feed. */
  selected: number;
  onTurns: (turns: AskAnswer[]) => void;
  onSelect: (index: number) => void;
  /** A citation [n] in an answer was pressed. */
  onCite: (id: string) => void;
}

const SITE_LINE = 'osintfront.com';

/** One line of the answer with its [n] citations as buttons. */
function AnswerLine({ line, ids, onCite }: { line: string; ids: string[]; onCite: (id: string) => void }) {
  const parts: ReactNode[] = [];
  let last = 0;
  for (const m of line.matchAll(/\[(\d+)\]/g)) {
    const id = ids[Number(m[1]) - 1];
    if (m.index! > last) parts.push(line.slice(last, m.index));
    parts.push(
      id ? (
        <button
          key={`${m.index}`}
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onCite(id);
          }}
          className="mx-0.5 inline-flex h-5 min-w-5 items-center justify-center rounded bg-sky-100 px-1 align-baseline text-[11px] font-bold text-sky-800 hover:bg-sky-200 dark:bg-sky-500/20 dark:text-sky-200"
        >
          {m[1]}
        </button>
      ) : (
        ''
      ),
    );
    last = m.index! + m[0].length;
  }
  if (last < line.length) parts.push(line.slice(last));
  return <p className={line.trim().startsWith('•') ? 'ps-1' : 'font-semibold'}>{parts}</p>;
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Older browsers / blocked clipboard API: copy through a hidden text box.
    try {
      const box = document.createElement('textarea');
      box.value = text;
      box.setAttribute('readonly', '');
      box.style.position = 'fixed';
      box.style.opacity = '0';
      document.body.appendChild(box);
      box.select();
      const ok = document.execCommand('copy');
      box.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

const actionBtn =
  'inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800';

/** "Ask the map": a short conversation — each question gets an answer and its events on the map. */
export function AskMap({ turns, selected, onTurns, onSelect, onCite }: AskMapProps) {
  const { t, lang } = useI18n();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [area, setArea] = useState('');
  const [extra, setExtra] = useState('');
  /** Feedback under a turn after Copy: which turn, and whether it worked. */
  const [copied, setCopied] = useState<{ turn: number; ok: boolean } | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const citeRef = useRef(onCite);
  citeRef.current = onCite;

  const full = turns.length >= MAX_TURNS;

  // A new answer: bring its first line to the top of the thread, so it is read from the start.
  useEffect(() => {
    const list = listRef.current;
    const last = list?.querySelector<HTMLElement>(`[data-ask-turn="${turns.length - 1}"]`);
    if (list && last) list.scrollTo({ top: last.offsetTop - 8, behavior: 'smooth' });
  }, [turns.length]);

  useEffect(() => {
    if (!copied) return;
    const id = window.setTimeout(() => setCopied(null), 2000);
    return () => window.clearTimeout(id);
  }, [copied]);

  const send = async (question: string) => {
    // busyRef: two quick presses must not send two questions (state updates too late for that).
    if (question.length < 3 || busyRef.current || full) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      const r = await askMap(question, buildContext(turns));
      setCollapsed(false);
      setQ('');
      setSummaryOpen(false);
      setArea('');
      setExtra('');
      onTurns([...turns, r]);
    } catch (err) {
      const code = err instanceof AskError ? err.code : 'failed';
      setError(t(code === 'upgrade' ? 'ai.upgrade' : code === 'quota' ? 'ai.quota' : code === 'budget' ? 'ai.budget' : code === 'rate_limited' ? 'ask.rateLimited' : code === 'sign_in' ? 'ask.signIn' : 'ask.failed'));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void send(q.trim());
  };

  const areaLabel = (id: string) => {
    const a = AREAS.find((x) => x.id === id);
    return a ? (lang === 'he' ? a.he : a.en) : '';
  };
  const summaryReady = !!area || extra.trim().length >= 3;
  const submitSummary = (e: FormEvent) => {
    e.preventDefault();
    if (!summaryReady) return;
    void send(summaryQuestion(areaLabel(area), extra, lang === 'he' ? 'he' : 'en'));
  };

  const shareText = (turn: AskAnswer) => answerShareText(turn, authConfig.siteUrl, { sources: t('ask.sources'), site: SITE_LINE });
  const copy = async (i: number) => setCopied({ turn: i, ok: await copyText(shareText(turns[i])) });
  const share = async (i: number) => {
    const text = shareText(turns[i]);
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({ text });
      } catch (err) {
        // The person closed the share sheet: nothing to do. Anything else: fall back to WhatsApp.
        if ((err as { name?: string })?.name !== 'AbortError') window.open(whatsappUrl(text), '_blank', 'noopener');
      }
    } else window.open(whatsappUrl(text), '_blank', 'noopener');
  };

  const newChat = () => {
    setError(null);
    setQ('');
    setSummaryOpen(false);
    onTurns([]);
  };
  const close = () => {
    setOpen(false);
    newChat();
  };

  if (!open && !turns.length) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="pointer-events-auto inline-flex items-center gap-1.5 rounded-full bg-white/95 px-3.5 py-1.5 text-sm font-semibold text-slate-800 shadow-lg ring-1 ring-slate-900/10 backdrop-blur hover:bg-white dark:bg-slate-900/95 dark:text-white dark:ring-white/10"
      >
        <Sparkles className="size-4 text-sky-600 dark:text-sky-400" aria-hidden />
        {t('ask.open')}
      </button>
    );
  }

  const current = turns[selected];

  return (
    <div data-ask-panel className="pointer-events-auto w-[min(560px,100%)] overflow-hidden rounded-2xl bg-white/97 shadow-xl ring-1 ring-slate-900/10 backdrop-blur dark:bg-slate-900/97 dark:ring-white/10">
      {turns.length ? (
        <div className="flex items-center gap-2 border-b border-slate-200 px-3 py-1.5 text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">
          <Sparkles className="size-4 shrink-0 text-sky-600 dark:text-sky-400" aria-hidden />
          <span className="min-w-0 flex-1 truncate" dir="auto">
            {t('ask.results', { count: current?.events.length ?? 0 })}
          </span>
          <span data-ask-count className="tabular-nums" dir="ltr">
            {t('ask.turns', { used: turns.length, max: MAX_TURNS })}
          </span>
          <button type="button" data-ask-action="new" onClick={newChat} title={t('ask.newChat')} aria-label={t('ask.newChat')} className="inline-flex size-7 items-center justify-center rounded-md hover:bg-slate-100 dark:hover:bg-slate-800">
            <SquarePen className="size-3.5" aria-hidden />
          </button>
          <button type="button" onClick={() => setCollapsed((v) => !v)} className="inline-flex items-center gap-0.5 font-semibold text-sky-700 hover:underline dark:text-sky-400">
            {collapsed ? <ChevronDown className="size-3.5" aria-hidden /> : <ChevronUp className="size-3.5" aria-hidden />}
            <span className="max-sm:sr-only">{collapsed ? t('ask.showAnswer') : t('ask.hideAnswer')}</span>
          </button>
          <button type="button" onClick={close} aria-label={t('common.close')} className="inline-flex size-7 items-center justify-center rounded-md hover:bg-slate-100 dark:hover:bg-slate-800">
            <X className="size-4" aria-hidden />
          </button>
        </div>
      ) : null}

      {turns.length && !collapsed ? (
        // While the summary form is open the thread shrinks, so the form's button stays on a phone screen.
        <div ref={listRef} className={cn('ofm-scroll relative space-y-2 overflow-y-auto px-2 py-2 text-sm leading-relaxed text-slate-800 dark:text-slate-100', summaryOpen ? 'max-h-[14vh]' : 'max-h-[46vh]')}>
          {turns.map((turn, i) => (
            <div
              key={i}
              data-ask-turn={i}
              data-ask-mode={turn.mode}
              data-selected={i === selected ? '' : undefined}
              onClick={() => (i === selected ? undefined : onSelect(i))}
              className={cn(
                'rounded-lg border-s-2 px-2 py-1.5',
                i === selected ? 'border-sky-500 bg-sky-50/60 dark:bg-sky-500/10' : 'cursor-pointer border-transparent opacity-80 hover:bg-slate-50 hover:opacity-100 dark:hover:bg-slate-800/60',
              )}
            >
              <p className="text-xs font-semibold text-slate-500 dark:text-slate-400" dir="auto">
                {turn.question}
              </p>
              <div className="mt-1 space-y-1" dir="auto">
                {turn.answer
                  .split('\n')
                  .filter((l) => l.trim())
                  .map((l, k) => (
                    <AnswerLine
                      key={k}
                      line={l}
                      ids={turn.ids}
                      onCite={(id) => {
                        // An older turn: show its events first, then open the cited one.
                        if (i !== selected) {
                          onSelect(i);
                          window.setTimeout(() => citeRef.current(id), 60);
                        } else onCite(id);
                      }}
                    />
                  ))}
              </div>
              <div className="mt-1 flex items-center gap-1">
                <button
                  type="button"
                  data-ask-action="copy"
                  onClick={(e) => {
                    e.stopPropagation();
                    void copy(i);
                  }}
                  className={actionBtn}
                >
                  {copied?.turn === i && copied.ok ? <Check className="size-3.5 text-emerald-600" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
                  {copied?.turn === i ? t(copied.ok ? 'ask.copied' : 'ask.copyFailed') : t('ask.copy')}
                </button>
                <button
                  type="button"
                  data-ask-action="share"
                  onClick={(e) => {
                    e.stopPropagation();
                    void share(i);
                  }}
                  className={actionBtn}
                >
                  <Share2 className="size-3.5" aria-hidden />
                  {t('ask.share')}
                </button>
              </div>
            </div>
          ))}
          <p className="px-2 text-[11px] text-slate-400">{t('ask.disclaimer')}</p>
        </div>
      ) : null}

      {error ? (
        <p data-ask-error className={cn('px-3 py-2 text-sm text-red-700 dark:text-red-400', turns.length && 'border-t border-slate-200 dark:border-slate-800')}>
          {error}
        </p>
      ) : null}

      {full ? (
        <div className="flex items-center gap-2 border-t border-slate-200 p-2 dark:border-slate-800">
          <p data-ask-limit className="min-w-0 flex-1 px-1 text-xs text-slate-600 dark:text-slate-300">
            {t('ask.limit', { max: MAX_TURNS })}
          </p>
          <button type="button" onClick={newChat} className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg bg-sky-600 px-3 text-sm font-semibold text-white hover:bg-sky-500">
            <SquarePen className="size-4" aria-hidden />
            {t('ask.newChat')}
          </button>
        </div>
      ) : (
        <>
          <form onSubmit={submit} className={cn('flex items-center gap-1.5 p-2', turns.length && 'border-t border-slate-200 dark:border-slate-800')}>
            {turns.length ? null : <Sparkles className="ms-1 size-4 shrink-0 text-sky-600 dark:text-sky-400" aria-hidden />}
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              maxLength={500}
              dir="auto"
              placeholder={t(turns.length ? 'ask.followUp' : 'ask.placeholder')}
              aria-label={t('ask.open')}
              className="h-9 min-w-0 flex-1 rounded-lg bg-transparent px-2 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/40 dark:text-white"
            />
            <button
              type="button"
              data-ask-action="summary"
              onClick={() => setSummaryOpen((v) => !v)}
              aria-expanded={summaryOpen}
              title={t('ask.summary')}
              className={cn(
                'inline-flex h-9 shrink-0 items-center gap-1 rounded-lg px-2 text-sm font-semibold',
                summaryOpen ? 'bg-sky-100 text-sky-800 dark:bg-sky-500/20 dark:text-sky-200' : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800',
              )}
            >
              <ListChecks className="size-4" aria-hidden />
              <span className="max-sm:sr-only">{t('ask.summary')}</span>
            </button>
            <button
              type="submit"
              data-ask-action="send"
              disabled={busy || q.trim().length < 3}
              className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg bg-sky-600 px-3 text-sm font-semibold text-white hover:bg-sky-500 disabled:opacity-50"
            >
              {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
              {busy ? t('ask.working') : t('ask.go')}
            </button>
            {turns.length ? null : (
              <button type="button" onClick={close} aria-label={t('common.close')} className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800">
                <X className="size-4" aria-hidden />
              </button>
            )}
          </form>

          {summaryOpen ? (
            <form data-ask-summary onSubmit={submitSummary} className="space-y-2 border-t border-slate-200 p-2 dark:border-slate-800">
              <p className="px-1 text-xs font-semibold text-slate-600 dark:text-slate-300">{t('ask.summaryArea')}</p>
              <div className="ofm-scroll flex max-h-[22vh] flex-wrap gap-1 overflow-y-auto p-0.5">
                {AREAS.map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    data-ask-area={a.id}
                    aria-pressed={area === a.id}
                    onClick={() => setArea(area === a.id ? '' : a.id)}
                    className={cn(
                      'h-7 rounded-full px-2.5 text-xs font-semibold ring-1',
                      area === a.id ? 'bg-sky-600 text-white ring-sky-600' : 'bg-white text-slate-700 ring-slate-300 hover:bg-slate-50 dark:bg-slate-900 dark:text-slate-200 dark:ring-slate-700',
                    )}
                  >
                    {lang === 'he' ? a.he : a.en}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-1.5">
                <input
                  value={extra}
                  onChange={(e) => setExtra(e.target.value)}
                  maxLength={300}
                  dir="auto"
                  placeholder={t('ask.summaryExtra')}
                  aria-label={t('ask.summaryExtra')}
                  className="h-9 min-w-0 flex-1 rounded-lg bg-slate-100 px-2 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/40 dark:bg-slate-800 dark:text-white"
                />
                <button type="submit" data-ask-action="summary-send" disabled={busy || !summaryReady} className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg bg-sky-600 px-3 text-sm font-semibold text-white hover:bg-sky-500 disabled:opacity-50">
                  {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
                  {t('ask.summaryGo')}
                </button>
              </div>
            </form>
          ) : null}

          {!turns.length && !error && !summaryOpen ? (
            <p className="border-t border-slate-200 px-3 py-2 text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">{t('ask.examples')}</p>
          ) : null}
        </>
      )}
    </div>
  );
}
