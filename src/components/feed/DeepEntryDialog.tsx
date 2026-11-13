import { useEffect, useRef, useState } from 'react';
import { Loader2, X } from 'lucide-react';
import { useI18n, type TranslationKey } from '@/i18n';
import { usePermissions } from '@/hooks/usePermissions';
import { hasFeature } from '@/lib/plans';
import { openGateFor } from '@/components/plans/GateDialog';
import { SECTION_KEYS, type DeepEntry, type EventTerm } from '@/lib/deepTerms';
import {
  DeepError, fetchDeepQuota, fetchEntry, refreshEntry, removeEntry, updateEntry, writeEntry, type DeepQuota,
} from '@/services/deepService';
import { fetchPublicEventsByIds } from '@/services/eventService';
import { loadEventMedia } from '@/services/eventMediaService';
import type { PublicEvent } from '@/types/event';
import { safeExternalUrl } from '@/utils/url';
import { formatDateTime } from '@/utils/time';
import { localizedTitle } from '@/lib/localizedTitle';
import { cn } from '@/utils/cn';

export interface DeepTarget { eventId: string; term?: EventTerm; text?: string; entryId?: string }

type View = 'loading' | 'entry' | 'unwritten' | 'writing' | 'message' | 'edit';
const MESSAGES: Record<string, TranslationKey> = {
  quota_exceeded: 'deep.quota', budget: 'deep.budget', busy: 'deep.busy', no_entry: 'deep.none', failed: 'deep.failed',
  alias_taken: 'deep.failed', forbidden: 'deep.failed', signup_required: 'deep.failed', not_in_plan: 'deep.failed',
};

/** The deep-analysis window for one term: the saved entry, or "not written yet" with a button to write it. */
export function DeepEntryDialog({ target, onClose, onOpenEvent, onChanged }: {
  target: DeepTarget;
  onClose: () => void;
  onOpenEvent?: (id: string) => void;
  onChanged?: () => void;
}) {
  const { t, lang, locale } = useI18n();
  const { can } = usePermissions();
  const staff = can('event.edit.any');
  const [view, setView] = useState<View>('loading');
  const [entry, setEntry] = useState<DeepEntry | null>(null);
  const [quota, setQuota] = useState<DeepQuota | null>(null);
  const [message, setMessage] = useState('');
  const [events, setEvents] = useState<PublicEvent[]>([]);
  const [thumbs, setThumbs] = useState<{ id: string; url: string }[]>([]);
  const closeRef = useRef<HTMLButtonElement>(null);
  const alive = useRef(true);
  const label = target.term?.name || target.text || '';

  const fail = (e: unknown) => {
    const code = e instanceof DeepError ? e.code : 'failed';
    if (code === 'not_in_plan' || code === 'signup_required') {
      onClose();
      openGateFor(code, 'deep_analysis');
      return;
    }
    setMessage(t(MESSAGES[code] ?? 'deep.failed', { limit: quota?.limit ?? '', alias: (e as { alias?: string })?.alias ?? '' }));
    setView('message');
  };

  const show = async (id: string, force = false) => {
    setView('loading');
    try {
      const e = await fetchEntry(id, force);
      if (!alive.current) return;
      if (!e) return fail(new DeepError('not_in_plan'));
      setEntry(e);
      setView('entry');
    } catch (err) {
      fail(err);
    }
  };

  useEffect(() => {
    alive.current = true;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', onKey, true);
    const id = target.entryId ?? target.term?.entry ?? null;
    if (id) void show(id);
    else if (target.text) void write();
    else {
      void fetchDeepQuota().then((q) => {
        if (!alive.current) return;
        setQuota(q);
        setView('unwritten');
      });
    }
    return () => {
      alive.current = false;
      document.removeEventListener('keydown', onKey, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // "In our events": newest first, with up to 6 thumbnails when the plan shows media.
  useEffect(() => {
    if (!entry?.events.length) return setEvents([]);
    let off = false;
    void fetchPublicEventsByIds(entry.events).then(async (list) => {
      if (off) return;
      const sorted = [...list].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt)).slice(0, 12);
      setEvents(sorted);
      if (!hasFeature(undefined, 'media')) return;
      const out: { id: string; url: string }[] = [];
      for (const ev of sorted.filter((e) => e.mediaKinds?.length)) {
        if (out.length >= 6) break;
        const m = await loadEventMedia(ev.id).catch(() => []);
        const img = m.find((x) => x.kind === 'image' || x.kind === 'video_thumb');
        if (img) out.push({ id: ev.id, url: img.url });
      }
      if (!off) setThumbs(out);
    });
    return () => {
      off = true;
    };
  }, [entry]);

  async function write() {
    setView('writing');
    try {
      const id = await writeEntry(
        target.text ? { eventId: target.eventId, text: target.text, lang: /[\u0590-\u05FF]/.test(target.text) ? 'he' : 'en' } : { eventId: target.eventId, key: target.term?.key },
      );
      onChanged?.();
      if (alive.current) await show(id, true);
    } catch (err) {
      if (alive.current) fail(err);
    }
  }

  const he = lang === 'he';
  const pick = (a: string, b: string) => (he ? a || b : b || a);
  const name = entry ? pick(entry.nameHe, entry.nameEn) : label;
  const others = entry ? [he ? entry.nameEn : entry.nameHe, entry.nameOrig].filter((n) => n && n !== name) : [];

  return (
    <div className="fixed inset-0 z-[3100] flex items-end justify-center sm:items-center sm:p-6" role="presentation" data-deep-dialog>
      <div className="absolute inset-0 bg-slate-950/60" onClick={onClose} aria-hidden />
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="deep-title"
        className="relative flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl ring-1 ring-slate-900/10 sm:max-h-[85vh] sm:max-w-2xl sm:rounded-2xl dark:bg-slate-900 dark:ring-white/10"
      >
        <header className="flex items-start gap-3 border-b border-slate-200 px-5 py-3 dark:border-slate-800">
          <div className="min-w-0 flex-1">
            <h2 id="deep-title" className="text-lg font-bold text-slate-900 dark:text-white" dir="auto">{name || t('deep.title')}</h2>
            {others.length ? <p className="text-xs text-slate-500 dark:text-slate-400" dir="auto">{others.join(' · ')}</p> : null}
            {entry ? (
              <span className="mt-1 inline-block rounded-full bg-sky-100 px-2 py-0.5 text-[11px] font-semibold text-sky-800 dark:bg-sky-500/15 dark:text-sky-300">
                {t(`deep.kind.${entry.kind}`)}
              </span>
            ) : null}
          </div>
          <button ref={closeRef} type="button" onClick={onClose} aria-label={t('common.close')} className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800">
            <X className="size-5" aria-hidden />
          </button>
        </header>
        <div className="ofm-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4 text-[14px] leading-relaxed text-slate-800 dark:text-slate-200">
          {view === 'loading' ? (
            <p className="flex items-center gap-2 text-slate-500"><Loader2 className="size-4 animate-spin" aria-hidden />{t('deep.loading')}</p>
          ) : view === 'writing' ? (
            <p className="flex items-center gap-2 text-slate-600 dark:text-slate-300" data-deep-state="writing"><Loader2 className="size-4 animate-spin" aria-hidden />{t('deep.writing')}</p>
          ) : view === 'message' ? (
            <p className="text-slate-700 dark:text-slate-200" data-deep-state="message">{message}</p>
          ) : view === 'unwritten' ? (
            <div data-deep-state="unwritten" className="space-y-2">
              <p className="font-semibold">{t('deep.noEntry')}</p>
              <div className="flex flex-wrap items-center gap-2">
                <button type="button" onClick={() => void write()} className="rounded-lg bg-sky-600 px-3 py-2 text-sm font-semibold text-white hover:bg-sky-700" data-deep-action="write">
                  {t('deep.write')}
                </button>
                {quota && !quota.staff && quota.limit != null ? (
                  <span className="text-xs text-slate-500 dark:text-slate-400">{t('deep.left', { n: Math.max(quota.limit - quota.used, 0), limit: quota.limit })}</span>
                ) : null}
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400">{t('deep.takesTime')}</p>
            </div>
          ) : view === 'edit' && entry ? (
            <EntryForm entry={entry} onCancel={() => setView('entry')} onSaved={async () => { onChanged?.(); await show(entry.id, true); }} />
          ) : entry ? (
            <div data-deep-state="entry">
              <div className="sm:flex sm:items-start sm:gap-4">
                {entry.image ? (
                  <figure className="mb-3 shrink-0 sm:w-48">
                    <img src={entry.image.url} alt="" className="max-h-56 w-full rounded-lg object-cover" loading="lazy" referrerPolicy="no-referrer" />
                    <figcaption className="mt-1 text-[10px] text-slate-500 dark:text-slate-400" data-deep-credit>
                      <a href={safeExternalUrl(entry.image.page) ?? undefined} target="_blank" rel="noopener noreferrer" className="hover:underline">
                        {t('deep.imageCredit', { credit: entry.image.credit, license: entry.image.license })}
                      </a>
                    </figcaption>
                  </figure>
                ) : null}
                <div className="min-w-0 flex-1 space-y-3">
                  <p dir="auto" className="whitespace-pre-line">{pick(entry.summaryHe, entry.summaryEn)}</p>
                  {entry.sections.map((s) => (
                    <section key={s.key} data-deep-section={s.key}>
                      <h3 className="text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">{t(`deep.section.${s.key}` as TranslationKey)}</h3>
                      <p dir="auto" className="whitespace-pre-line">{pick(s.he, s.en)}</p>
                    </section>
                  ))}
                </div>
              </div>
              {events.length ? (
                <section className="mt-4">
                  <h3 className="mb-1 text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">{t('deep.ourEvents')}</h3>
                  {thumbs.length ? (
                    <div className="mb-2 flex gap-1.5 overflow-x-auto">
                      {thumbs.map((m) => (
                        <button key={m.id} type="button" onClick={() => onOpenEvent?.(m.id)} className="shrink-0">
                          <img src={m.url} alt="" className="size-16 rounded-md object-cover" loading="lazy" />
                        </button>
                      ))}
                    </div>
                  ) : null}
                  <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                    {events.map((ev) => (
                      <li key={ev.id}>
                        <button type="button" data-deep-event={ev.id} onClick={() => onOpenEvent?.(ev.id)} className="flex w-full items-baseline gap-2 py-1.5 text-start text-[13px] hover:bg-slate-50 dark:hover:bg-slate-800/60">
                          <bdi className="shrink-0 text-xs text-slate-500">{formatDateTime(ev.occurredAt, locale)}</bdi>
                          <span dir="auto" className="min-w-0 truncate">{localizedTitle(ev, lang)}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}
              {entry.sources.length ? (
                <section className="mt-4">
                  <h3 className="mb-1 text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">{t('deep.sources')}</h3>
                  <ol className="list-decimal space-y-0.5 ps-5 text-[13px]">
                    {entry.sources.map((s) => {
                      const href = safeExternalUrl(s.url);
                      return (
                        <li key={s.url}>
                          {href ? <a href={href} target="_blank" rel="noopener noreferrer" className="text-sky-700 hover:underline dark:text-sky-400" dir="auto">{s.title}</a> : <span dir="auto">{s.title}</span>}
                        </li>
                      );
                    })}
                  </ol>
                </section>
              ) : null}
              <p className="mt-4 text-[11px] text-slate-500 dark:text-slate-400">
                {t('deep.aiLine', { date: formatDateTime(entry.updatedAt, locale), version: entry.version })}
              </p>
              {staff ? <StaffRow entry={entry} onEdit={() => setView('edit')} onRefreshed={() => show(entry.id, true)} onRemoved={() => { onChanged?.(); onClose(); }} onError={fail} /> : null}
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}

function StaffRow({ entry, onEdit, onRefreshed, onRemoved, onError }: { entry: DeepEntry; onEdit: () => void; onRefreshed: () => void; onRemoved: () => void; onError: (e: unknown) => void }) {
  const { t } = useI18n();
  const [busy, setBusy] = useState<'refresh' | 'remove' | null>(null);
  const btn = 'rounded-md border border-slate-300 px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800';
  return (
    <div className="mt-3 flex flex-wrap gap-2 border-t border-dashed border-sky-300 pt-3 dark:border-sky-500/40" data-deep-staff>
      <button type="button" className={btn} onClick={onEdit} data-deep-action="edit">{t('deep.edit')}</button>
      <button
        type="button"
        className={btn}
        disabled={busy !== null}
        data-deep-action="refresh"
        onClick={async () => {
          if (!window.confirm(t('deep.refreshConfirm'))) return;
          setBusy('refresh');
          try {
            await refreshEntry(entry.id);
            onRefreshed();
          } catch (e) {
            onError(e);
          } finally {
            setBusy(null);
          }
        }}
      >
        {busy === 'refresh' ? <Loader2 className="inline size-3 animate-spin" aria-hidden /> : null} {t('deep.refresh')}
      </button>
      <button
        type="button"
        className={cn(btn, 'text-red-700 dark:text-red-400')}
        disabled={busy !== null}
        data-deep-action="remove"
        onClick={async () => {
          if (!window.confirm(t('deep.removeConfirm'))) return;
          setBusy('remove');
          try {
            await removeEntry(entry.id);
            onRemoved();
          } catch (e) {
            onError(e);
          } finally {
            setBusy(null);
          }
        }}
      >
        {t('deep.remove')}
      </button>
    </div>
  );
}

function EntryForm({ entry, onCancel, onSaved }: { entry: DeepEntry; onCancel: () => void; onSaved: () => void }) {
  const { t } = useI18n();
  const [f, setF] = useState({
    name_he: entry.nameHe, name_en: entry.nameEn, name_orig: entry.nameOrig, kind: entry.kind,
    aliases: entry.aliases.join(', '), summary_he: entry.summaryHe, summary_en: entry.summaryEn,
    sources: entry.sources.map((s) => `${s.title} | ${s.url}`).join('\n'),
    sections: Object.fromEntries(SECTION_KEYS.map((k) => {
      const s = entry.sections.find((x) => x.key === k);
      return [k, { he: s?.he ?? '', en: s?.en ?? '' }];
    })) as Record<string, { he: string; en: string }>,
    remove_image: false,
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const field = 'mt-0.5 w-full rounded-md border border-slate-300 bg-white px-2 py-1 text-sm dark:border-slate-700 dark:bg-slate-900';
  const set = (k: string, v: unknown) => setF((x) => ({ ...x, [k]: v }));
  const text = (k: 'name_he' | 'name_en' | 'name_orig' | 'summary_he' | 'summary_en' | 'aliases' | 'sources', labelKey: TranslationKey, rows = 1) => (
    <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300">
      {t(labelKey)}
      {rows > 1 ? (
        <textarea className={field} rows={rows} value={f[k]} onChange={(e) => set(k, e.target.value)} dir="auto" data-deep-field={k} />
      ) : (
        <input className={field} value={f[k]} onChange={(e) => set(k, e.target.value)} dir="auto" data-deep-field={k} />
      )}
    </label>
  );
  const save = async () => {
    setBusy(true);
    setErr('');
    try {
      await updateEntry(entry.id, {
        name_he: f.name_he, name_en: f.name_en, name_orig: f.name_orig, kind: f.kind, summary_he: f.summary_he, summary_en: f.summary_en,
        aliases: f.aliases.split(',').map((a) => a.trim()).filter(Boolean),
        sections: SECTION_KEYS.map((k) => ({ key: k, he: f.sections[k].he, en: f.sections[k].en })),
        sources: f.sources.split('\n').map((l) => l.split('|')).filter((p) => p.length >= 2).map((p) => ({ title: p[0].trim(), url: p.slice(1).join('|').trim() })),
        ...(f.remove_image ? { remove_image: true } : {}),
      });
      onSaved();
    } catch (e) {
      setErr(e instanceof DeepError && e.code === 'alias_taken' ? t('deep.aliasTaken', { alias: '' }) : t('deep.failed'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="space-y-2" data-deep-form onSubmit={(e) => { e.preventDefault(); void save(); }}>
      {text('name_he', 'deep.f.nameHe')}
      {text('name_en', 'deep.f.nameEn')}
      {text('name_orig', 'deep.f.nameOrig')}
      <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300">
        {t('deep.f.kind')}
        <select className={field} value={f.kind} onChange={(e) => set('kind', e.target.value)}>
          {['person', 'weapon', 'org', 'place', 'term'].map((k) => <option key={k} value={k}>{t(`deep.kind.${k}` as TranslationKey)}</option>)}
        </select>
      </label>
      {text('aliases', 'deep.f.aliases')}
      {text('summary_he', 'deep.f.summaryHe', 3)}
      {text('summary_en', 'deep.f.summaryEn', 3)}
      {SECTION_KEYS.map((k) => (
        <div key={k} className="grid gap-2 sm:grid-cols-2">
          {(['he', 'en'] as const).map((l) => (
            <label key={l} className="block text-xs font-semibold text-slate-600 dark:text-slate-300">
              {t(l === 'he' ? 'deep.f.sectionHe' : 'deep.f.sectionEn', { name: t(`deep.section.${k}` as TranslationKey) })}
              <textarea className={field} rows={2} dir="auto" value={f.sections[k][l]} onChange={(e) => set('sections', { ...f.sections, [k]: { ...f.sections[k], [l]: e.target.value } })} />
            </label>
          ))}
        </div>
      ))}
      {text('sources', 'deep.f.sources', 3)}
      {entry.image ? (
        <label className="flex items-center gap-2 text-xs font-semibold text-slate-600 dark:text-slate-300">
          <input type="checkbox" checked={f.remove_image} onChange={(e) => set('remove_image', e.target.checked)} />
          {t('deep.removeImage')}
        </label>
      ) : null}
      {err ? <p className="text-xs text-red-600 dark:text-red-400">{err}</p> : null}
      <div className="flex gap-2">
        <button type="submit" disabled={busy} className="rounded-lg bg-sky-600 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-60" data-deep-action="save">{t('deep.save')}</button>
        <button type="button" onClick={onCancel} className="rounded-lg px-3 py-1.5 text-sm font-semibold text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800">{t('deep.cancel')}</button>
      </div>
    </form>
  );
}
