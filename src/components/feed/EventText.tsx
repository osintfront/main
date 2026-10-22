import { useState } from 'react';
import { ChevronDown, ChevronUp, FileText, Languages, Loader2 } from 'lucide-react';
import { useI18n } from '@/i18n';
import type { PublicEvent } from '@/types/event';
import { LinkifiedText } from '@/components/common/LinkifiedText';
import { cachedExpansion, expandEvent, fetchSourceText, type ExpandedByLang } from '@/services/eventTextService';
import { cn } from '@/utils/cn';
import { previewText } from '@/utils/text';

/** Headline + short summary in the site language (falls back to the stored text). */
export function eventTexts(event: PublicEvent, lang: string) {
  const tr = event.translations[lang] ?? {};
  const title = tr.title || event.title;
  const summary = tr.summary || tr.description || (lang === 'he' ? event.description : '') || event.translations.he?.summary || event.description;
  return { title, summary: previewText(summary ?? '') };
}

/**
 * The summary of an event with two reader buttons:
 *  "Expand" — the full report + religious meaning + other implications (written once by the agent);
 *  "Source text" — the original report, with a button back to the translated summary.
 */
export function EventText({ event, compact = false }: { event: PublicEvent; compact?: boolean }) {
  const { t, lang } = useI18n();
  const { summary } = eventTexts(event, lang);
  const [view, setView] = useState<'summary' | 'source'>('summary');
  const [source, setSource] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<ExpandedByLang | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<'expand' | 'source' | null>(null);
  const [failed, setFailed] = useState(false);

  const showSource = async () => {
    if (view === 'source') return setView('summary');
    if (source === null) {
      setBusy('source');
      try {
        setSource((await fetchSourceText(event.id)) || event.description);
      } catch {
        setSource(event.description);
      } finally {
        setBusy(null);
      }
    }
    setView('source');
  };

  const toggleExpand = async () => {
    if (open) return setOpen(false);
    setFailed(false);
    const cached = expanded ?? cachedExpansion(event);
    if (cached) {
      setExpanded(cached);
      return setOpen(true);
    }
    setBusy('expand');
    try {
      setExpanded(await expandEvent(event.id));
      setOpen(true);
    } catch {
      setFailed(true);
    } finally {
      setBusy(null);
    }
  };

  const raw = expanded ? (lang === 'en' ? expanded.en ?? expanded.he : expanded.he) : null;
  // "None" answers are not shown.
  const real = (v: string) => (/^\s*(אין|none|n\/a|no)\.?\s*$/i.test(v ?? '') ? '' : v);
  const x = raw ? { details: raw.details, religious: real(raw.religious), implications: real(raw.implications) } : null;
  const btn =
    'inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-xs font-semibold text-sky-700 hover:bg-sky-50 focus-visible:outline-2 focus-visible:outline-sky-500 disabled:opacity-60 dark:text-sky-400 dark:hover:bg-sky-500/10';

  return (
    <div className="mt-1">
      {view === 'source' ? (
        <p
          className={cn(
            'whitespace-pre-line break-words rounded-lg bg-slate-50 p-2 text-[13px] leading-relaxed text-slate-700 dark:bg-slate-800/60 dark:text-slate-200',
            compact && 'max-h-60 overflow-y-auto',
          )}
          dir="auto"
        >
          <LinkifiedText text={source ?? ''} mapsLabel={t('details.openInMaps')} />
        </p>
      ) : summary ? (
        <p className={cn('text-slate-600 dark:text-slate-300', compact ? 'text-[13px] leading-relaxed' : 'text-[15px] leading-relaxed text-slate-800 dark:text-slate-200')} dir="auto">
          {summary}
        </p>
      ) : null}

      {open && x && view === 'summary' ? (
        <div className="mt-2 space-y-2 border-s-2 border-sky-200 ps-3 text-[13px] leading-relaxed text-slate-700 dark:border-sky-500/40 dark:text-slate-200" dir="auto">
          {x.details ? <p className="whitespace-pre-line">{x.details}</p> : null}
          {x.religious ? (
            <p className="whitespace-pre-line">
              <strong className="font-semibold">{t('text.religious')}: </strong>
              {x.religious}
            </p>
          ) : null}
          {x.implications ? (
            <p className="whitespace-pre-line">
              <strong className="font-semibold">{t('text.implications')}: </strong>
              {x.implications}
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="mt-1 flex flex-wrap items-center gap-1">
        {view === 'summary' ? (
          <button type="button" onClick={() => void toggleExpand()} disabled={busy !== null} className={btn} aria-expanded={open}>
            {busy === 'expand' ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : open ? <ChevronUp className="size-3.5" aria-hidden /> : <ChevronDown className="size-3.5" aria-hidden />}
            {busy === 'expand' ? t('text.expanding') : open ? t('text.collapse') : t('text.expand')}
          </button>
        ) : null}
        <button type="button" onClick={() => void showSource()} disabled={busy !== null} className={btn}>
          {busy === 'source' ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : view === 'source' ? <Languages className="size-3.5" aria-hidden /> : <FileText className="size-3.5" aria-hidden />}
          {view === 'source' ? t('text.backToSummary') : t('text.source')}
        </button>
        {failed ? <span className="text-xs text-red-600 dark:text-red-400">{t('text.expandFailed')}</span> : null}
      </div>
    </div>
  );
}
