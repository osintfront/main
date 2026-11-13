import { useState, type ClipboardEvent } from 'react';
import { ChevronDown, ChevronUp, FileText, Languages, Loader2, Lock } from 'lucide-react';
import { useI18n } from '@/i18n';
import type { PublicEvent } from '@/types/event';
import { LinkifiedText } from '@/components/common/LinkifiedText';
import { cachedExpansion, expandEvent, fetchSourceText, type ExpandedByLang } from '@/services/eventTextService';
import { cn } from '@/utils/cn';
import { useAuth } from '@/hooks/useAuth';
import { refreshFeatureUsage, useFeatureUsage } from '@/lib/featureUse';
import { hasFeature, myPlan, usePlanVersion } from '@/lib/plans';
import { openGate, openGateFor } from '@/components/plans/GateDialog';
import { previewText } from '@/utils/text';
import { localizedTitle } from '@/lib/localizedTitle';
import type { EventTerm } from '@/lib/deepTerms';
import { TermText } from './TermText';

const SITE = 'https://osintfront.com';

/**
 * "Share on WhatsApp": headline (+ summary or expansion) and the event's share link /e/<id>.
 * The link draws its own preview (api/share.ts): the event's first photo, or — for a guest's
 * share (?g=1) — a blurred card that asks to sign up. mark = the site's line + a free sign-up link
 * (guest and Free shares).
 */
export function whatsappShareUrl(event: PublicEvent, lang: string, expanded: ExpandedByLang | null, opts: { mark?: string; guest?: boolean } = {}): string {
  const { title, summary } = eventTexts(event, lang);
  const x = expanded ? (lang === 'en' ? expanded.en ?? expanded.he : expanded.he) : null;
  const body = opts.guest ? '' : x?.details ? x.details : summary;
  const link = `${SITE}/e/${event.id}${opts.guest ? '?g=1' : ''}`;
  const text = [`*${title}*`, body, link, opts.mark].filter(Boolean).join('\n\n');
  return `https://wa.me/?text=${encodeURIComponent(text.slice(0, 3500))}`;
}

function WhatsAppIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-3.5" fill="currentColor" aria-hidden>
      <path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Zm0 18.2c-1.5 0-3-.4-4.3-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2Zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.2-.4.2-.4.7-1.3.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5c-.2 0-.4.1-.6.3-.2.2-.8.8-.8 2s.8 2.3.9 2.5c.1.2 1.6 2.5 4 3.5 1.5.6 2.1.7 2.8.6.5-.1 1.5-.6 1.7-1.2.2-.6.2-1.1.2-1.2-.1-.1-.2-.2-.5-.3Z" />
    </svg>
  );
}

/** Headline + short summary in the site language (falls back to the stored text). */
export function eventTexts(event: PublicEvent, lang: string) {
  const tr = event.translations[lang] ?? {};
  const title = localizedTitle(event, lang);
  const summary = tr.summary || tr.description || (lang === 'he' ? event.description : '') || event.translations.he?.summary || event.description;
  return { title, summary: previewText(summary ?? '') };
}

/**
 * The summary of an event with two reader buttons:
 *  "Expand" — the full report + religious meaning + other implications (written once by the agent);
 *  "Source text" — the original report, with a button back to the translated summary.
 */
export function EventText({ event, compact = false, terms, usedTerms, onTerm }: {
  event: PublicEvent;
  compact?: boolean;
  /** Deep analysis (details window only): term links in the summary and the expansion. */
  terms?: EventTerm[];
  /** Keys already linked above (the headline): each term links once in the window. */
  usedTerms?: Set<string>;
  onTerm?: (t: EventTerm) => void;
}) {
  const { t, lang } = useI18n();
  const { profile } = useAuth();
  usePlanVersion();
  const usage = useFeatureUsage().expand_daily;
  const canCopy = hasFeature(undefined, 'copy_text');
  const hasSummary = hasFeature(undefined, 'event_summary');
  const { summary } = eventTexts(event, lang);
  const [view, setView] = useState<'summary' | 'source'>('summary');
  const [source, setSource] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<ExpandedByLang | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<'expand' | 'source' | null>(null);
  const [failed, setFailed] = useState<false | 'failed' | 'quota' | 'budget'>(false);

  const showSource = async () => {
    if (view === 'source') return setView('summary');
    if (!hasFeature(undefined, 'source_link')) return void openGate(profile ? 'upgrade' : 'signup', 'source_link');
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
    // Re-opening in the same card is free; every new expand is counted by the server.
    if (expanded) return setOpen(true);
    if (!profile) return void openGate('signup', 'expand_daily');
    setBusy('expand');
    try {
      setExpanded(await expandEvent(event.id));
      setOpen(true);
    } catch (err) {
      const m = (err as Error)?.message;
      if (openGateFor(m, 'expand_daily')) return;
      setFailed(m === 'budget' ? m : 'failed');
    } finally {
      setBusy(null);
      void refreshFeatureUsage(true);
    }
  };

  // Share: open to everyone. Guest and Free shares carry the site's line and a sign-up link;
  // a guest's link previews as a blurred card (no photo, no summary).
  const share = () => {
    const plan = myPlan();
    const guest = plan === 'guest';
    const mark = guest || plan === 'free' ? t('share.mark') : undefined;
    window.open(whatsappShareUrl(event, lang, expanded ?? cachedExpansion(event), { mark, guest }), '_blank', 'noopener');
  };
  // No copying the text on plans without it.
  const onCopy = (e: ClipboardEvent) => {
    if (canCopy) return;
    e.preventDefault();
    openGate(profile ? 'upgrade' : 'signup', 'copy_text');
  };

  // One fresh set per render: summary first, then the expansion (a term links once).
  const used = new Set(usedTerms ?? []);
  const linked = (s: string) => (terms && onTerm ? <TermText text={s} terms={terms} used={used} onTerm={onTerm} /> : s);
  const raw = expanded ? (lang === 'en' ? expanded.en ?? expanded.he : expanded.he) : null;
  // "None" answers are not shown.
  const real = (v: string) => (/^\s*(אין|none|n\/a|no)\.?\s*$/i.test(v ?? '') ? '' : v);
  const x = raw ? { details: raw.details, religious: real(raw.religious), implications: real(raw.implications) } : null;
  const btn =
    'inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-xs font-semibold text-sky-700 hover:bg-sky-50 focus-visible:outline-2 focus-visible:outline-sky-500 disabled:opacity-60 dark:text-sky-400 dark:hover:bg-sky-500/10';

  return (
    <div className={cn('mt-1', !canCopy && 'select-none')} onCopy={onCopy} onCut={onCopy}>
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
          {linked(summary)}
        </p>
      ) : !hasSummary ? (
        <button
          type="button"
          onClick={() => openGate(profile ? 'upgrade' : 'signup', 'event_summary')}
          className="inline-flex items-center gap-1.5 rounded-md bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
        >
          <Lock className="size-3.5" aria-hidden />
          {t('lock.summary')}
        </button>
      ) : null}

      {open && x && view === 'summary' ? (
        <div className="mt-2 space-y-2 border-s-2 border-sky-200 ps-3 text-[13px] leading-relaxed text-slate-700 dark:border-sky-500/40 dark:text-slate-200" dir="auto">
          {x.details ? <p className="whitespace-pre-line">{linked(x.details)}</p> : null}
          {x.religious ? (
            <p className="whitespace-pre-line">
              <strong className="font-semibold">{t('text.religious')}: </strong>
              {linked(x.religious)}
            </p>
          ) : null}
          {x.implications ? (
            <p className="whitespace-pre-line">
              <strong className="font-semibold">{t('text.implications')}: </strong>
              {linked(x.implications)}
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
        {view === 'summary' && profile?.role === 'viewer' && usage?.limit != null ? (
          <span className="text-[11px] text-slate-500 dark:text-slate-400">{t('gate.left', { n: Math.max(usage.limit - usage.used, 0), limit: usage.limit })}</span>
        ) : null}
        <button type="button" onClick={() => void showSource()} disabled={busy !== null} className={btn}>
          {busy === 'source' ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : view === 'source' ? <Languages className="size-3.5" aria-hidden /> : <FileText className="size-3.5" aria-hidden />}
          {view === 'source' ? t('text.backToSummary') : t('text.source')}
        </button>
        <button
          type="button"
          onClick={share}
          className={btn + ' text-emerald-700 hover:bg-emerald-50 dark:text-emerald-400 dark:hover:bg-emerald-500/10'}
          aria-label={t('text.shareWhatsapp')}
          title={t('text.shareWhatsapp')}
        >
          <WhatsAppIcon />
          {t('text.share')}
        </button>
        {failed ? <span className="text-xs text-red-600 dark:text-red-400">{t(failed === 'quota' ? 'ai.quota' : failed === 'budget' ? 'ai.budget' : 'text.expandFailed')}</span> : null}
      </div>
    </div>
  );
}
