import { useState, type FormEvent, type ReactNode } from 'react';
import { ChevronDown, ChevronUp, Loader2, Sparkles, X } from 'lucide-react';
import { useI18n } from '@/i18n';
import { AskError, askMap, type AskAnswer } from '@/services/askService';

interface AskMapProps {
  result: AskAnswer | null;
  onResult: (r: AskAnswer | null) => void;
  /** A citation [n] in the answer was pressed. */
  onCite: (id: string) => void;
}

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
          onClick={() => onCite(id)}
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

/** "Ask the map": a free-text question → answer + the matching events on the map. */
export function AskMap({ result, onResult, onCite }: AskMapProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const question = q.trim();
    if (question.length < 3 || busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await askMap(question);
      setCollapsed(false);
      onResult(r);
    } catch (err) {
      const code = err instanceof AskError ? err.code : 'failed';
      setError(t(code === 'rate_limited' ? 'ask.rateLimited' : code === 'sign_in' ? 'ask.signIn' : 'ask.failed'));
    } finally {
      setBusy(false);
    }
  };

  const close = () => {
    setOpen(false);
    setError(null);
    onResult(null);
  };

  if (!open && !result) {
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

  return (
    <div className="pointer-events-auto w-[min(560px,100%)] overflow-hidden rounded-2xl bg-white/97 shadow-xl ring-1 ring-slate-900/10 backdrop-blur dark:bg-slate-900/97 dark:ring-white/10">
      <form onSubmit={submit} className="flex items-center gap-1.5 p-2">
        <Sparkles className="ms-1 size-4 shrink-0 text-sky-600 dark:text-sky-400" aria-hidden />
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          maxLength={500}
          dir="auto"
          placeholder={t('ask.placeholder')}
          aria-label={t('ask.open')}
          className="h-9 min-w-0 flex-1 rounded-lg bg-transparent px-2 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/40 dark:text-white"
        />
        <button
          type="submit"
          disabled={busy || q.trim().length < 3}
          className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg bg-sky-600 px-3 text-sm font-semibold text-white hover:bg-sky-500 disabled:opacity-50"
        >
          {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
          {busy ? t('ask.working') : t('ask.go')}
        </button>
        <button
          type="button"
          onClick={close}
          aria-label={t('common.close')}
          className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
        >
          <X className="size-4" aria-hidden />
        </button>
      </form>
      {error ? <p className="border-t border-slate-200 px-3 py-2 text-sm text-red-700 dark:border-slate-800 dark:text-red-400">{error}</p> : null}
      {!result && !error ? <p className="border-t border-slate-200 px-3 py-2 text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">{t('ask.examples')}</p> : null}
      {result ? (
        <div className="border-t border-slate-200 dark:border-slate-800">
          <div className="flex items-center gap-2 px-3 py-1.5 text-xs text-slate-500 dark:text-slate-400">
            <span className="min-w-0 flex-1 truncate" dir="auto">
              {t('ask.results', { count: result.events.length })} · {result.question}
            </span>
            <button
              type="button"
              onClick={() => setCollapsed((v) => !v)}
              className="inline-flex items-center gap-0.5 font-semibold text-sky-700 hover:underline dark:text-sky-400"
            >
              {collapsed ? <ChevronDown className="size-3.5" aria-hidden /> : <ChevronUp className="size-3.5" aria-hidden />}
              {collapsed ? t('ask.showAnswer') : t('ask.hideAnswer')}
            </button>
          </div>
          {!collapsed ? (
            <div className="ofm-scroll max-h-[38vh] space-y-1 overflow-y-auto px-3 pb-3 text-sm leading-relaxed text-slate-800 dark:text-slate-100" dir="auto">
              {result.answer
                .split('\n')
                .filter((l) => l.trim())
                .map((l, i) => (
                  <AnswerLine key={i} line={l} ids={result.ids} onCite={onCite} />
                ))}
              <p className="pt-1 text-[11px] text-slate-400">{t('ask.disclaimer')}</p>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
