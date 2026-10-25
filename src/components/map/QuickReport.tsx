import { useEffect, useId, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Sparkles, X, Zap } from 'lucide-react';
import { useI18n } from '@/i18n';
import { usePermissions } from '@/hooks/usePermissions';
import { useToast } from '@/components/common/Toast';
import { Button } from '@/components/common/Form';
import { fetchCategories } from '@/services/categoryService';
import { attachComposeMedia, composeEvent, type ComposeMedia } from '@/services/composeService';
import { createEvent } from '@/services/eventAdminService';
import { friendlyError } from '@/services/serviceError';
import { validateEvent } from '@/lib/eventWorkflow';
import { applyCompose, emptyEventInput, splitByCategory, telegramPost } from '@/lib/quickReport';
import type { EventCategory } from '@/types/category';
import type { EventInput, EventStatus } from '@/types/event';

/**
 * Map screen, admins and analysts: paste a link (Telegram post / article) or a text, the editor
 * agent fills everything (category per place, places, source, pictures), one event per kind of
 * place; check the result and publish it straight to the map.
 */
export function QuickReportButton() {
  const { t } = useI18n();
  const { can } = usePermissions();
  const [open, setOpen] = useState(false);
  if (!can('event.create')) return null;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="absolute bottom-6 end-3 z-[600] inline-flex h-9 items-center gap-1.5 rounded-full bg-sky-600 px-3.5 text-sm font-semibold text-white shadow-lg ring-1 ring-sky-700/30 hover:bg-sky-500"
      >
        <Zap className="size-4" aria-hidden />
        {t('quick.button')}
      </button>
      {open ? <QuickReportDialog onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function QuickReportDialog({ onClose }: { onClose: () => void }) {
  const { t, categoryLabel } = useI18n();
  const { can } = usePermissions();
  const toast = useToast();
  const titleId = useId();
  const area = useRef<HTMLTextAreaElement>(null);
  const [categories, setCategories] = useState<EventCategory[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState<'compose' | 'save' | null>(null);
  const [parts, setParts] = useState<EventInput[] | null>(null);
  const [media, setMedia] = useState<ComposeMedia[]>([]);
  const [post, setPost] = useState<string | null>(null);
  const [linked, setLinked] = useState(false);
  const canPublish = can('event.publish') || can('event.publish.draft');

  useEffect(() => {
    fetchCategories().then(setCategories).catch(() => undefined);
    window.setTimeout(() => area.current?.focus(), 0);
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !busy && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  const compose = async () => {
    const s = text.trim();
    if (s.length < 10 || busy) return;
    setBusy('compose');
    try {
      const cats = categories.length ? categories : await fetchCategories();
      if (!categories.length) setCategories(cats);
      const r = await composeEvent(s);
      const base = applyCompose(emptyEventInput(), r, s, cats);
      setParts(splitByCategory(base, cats, (c) => categoryLabel(c.slug, c.name), (count) => t('compose.andMore', { count })));
      setMedia(r.link?.media ?? []);
      setPost(telegramPost(r.link?.url));
      setLinked(!!r.link);
    } catch (err) {
      toast.error(t('compose.failed', { error: friendlyError(err, t) }));
    } finally {
      setBusy(null);
    }
  };

  const save = async (target: EventStatus) => {
    if (!parts || busy) return;
    const bad = parts.find((p) => Object.values(validateEvent(p, target)).some(Boolean));
    if (bad) {
      toast.error(t('quick.invalid'));
      return;
    }
    setBusy('save');
    try {
      for (const p of parts) {
        const ev = await createEvent(p, target, '');
        if (media.length) await attachComposeMedia(ev.id, media, post);
      }
      toast.success(t(target === 'published' ? 'quick.published' : 'quick.drafted', { count: parts.length }));
      onClose();
    } catch (err) {
      toast.error(friendlyError(err, t));
    } finally {
      setBusy(null);
    }
  };

  const catOf = (id: string | null) => categories.find((c) => c.id === id);

  return (
    <div className="fixed inset-0 z-[1900] flex items-end justify-center p-3 sm:items-center">
      <button type="button" tabIndex={-1} aria-hidden className="absolute inset-0 bg-slate-950/50" onClick={() => !busy && onClose()} />
      <div role="dialog" aria-modal="true" aria-labelledby={titleId} className="relative flex max-h-[calc(100dvh-1.5rem)] w-full max-w-lg flex-col rounded-2xl bg-white shadow-2xl dark:bg-slate-900">
        <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-5 py-3 dark:border-slate-800">
          <h2 id={titleId} className="flex items-center gap-2 text-base font-semibold text-slate-900 dark:text-white">
            <Zap className="size-4 text-sky-500" aria-hidden />
            {t('quick.title')}
          </h2>
          <button type="button" onClick={onClose} disabled={!!busy} aria-label={t('common.cancel')} className="grid size-8 place-items-center rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800">
            <X className="size-4" aria-hidden />
          </button>
        </div>

        <div className="ofm-scroll min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <textarea
            ref={area}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setParts(null);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void compose();
            }}
            rows={4}
            dir="auto"
            maxLength={10000}
            placeholder={t('quick.placeholder')}
            className="w-full rounded-lg border-0 bg-slate-50 p-3 text-sm text-slate-900 ring-1 ring-inset ring-slate-300 focus:ring-2 focus:ring-sky-500 dark:bg-slate-800 dark:text-white dark:ring-slate-700"
          />
          <Button className="mt-2 w-full" onClick={() => void compose()} loading={busy === 'compose'} disabled={text.trim().length < 10 || busy === 'save'}>
            <Sparkles className="size-4" aria-hidden />
            {busy === 'compose' ? t('quick.working') : t('quick.analyze')}
          </Button>

          {parts ? (
            <div className="mt-4">
              <p className="mb-2 text-xs font-semibold text-slate-700 dark:text-slate-200">
                {parts.length > 1 ? t('quick.split', { count: parts.length }) : t('quick.one')}
              </p>
              <ul className="space-y-2">
                {parts.map((p, i) => {
                  const c = catOf(p.categoryId);
                  return (
                    <li key={i} className="rounded-lg bg-slate-50 p-2.5 ring-1 ring-slate-200 dark:bg-slate-800/60 dark:ring-slate-700">
                      <p className="text-sm font-semibold text-slate-900 dark:text-white" dir="auto">{p.title || '—'}</p>
                      <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                        {c ? categoryLabel(c.slug, c.name) : t('quick.noCategory')}
                        {' · '}
                        {p.locations?.length ? t('quick.places', { count: p.locations.length }) : p.locationName || t('quick.noPlace')}
                      </p>
                    </li>
                  );
                })}
              </ul>
              {parts[0]?.description ? <p className="mt-2 text-xs text-slate-600 dark:text-slate-300" dir="auto">{parts[0].description}</p> : null}
              {parts[0]?.sourceName ? <p className="mt-1 text-xs text-slate-500" dir="auto">{t('quick.source')}: {parts[0].sourceName}</p> : null}
              {media.length ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  {media.map((m, i) => (
                    <div key={m.url} className="relative">
                      <img src={m.url} alt="" referrerPolicy="no-referrer" className="h-16 w-24 rounded-lg object-cover ring-1 ring-slate-200 dark:ring-slate-700" />
                      {m.kind === 'video_thumb' ? <span className="absolute inset-0 grid place-items-center text-lg text-white drop-shadow">▶</span> : null}
                      <button
                        type="button"
                        onClick={() => setMedia((list) => list.filter((_, j) => j !== i))}
                        aria-label={t('compose.removeMedia')}
                        className="absolute -end-1.5 -top-1.5 grid size-5 place-items-center rounded-full bg-white text-xs text-slate-600 shadow ring-1 ring-slate-200 hover:text-red-600 dark:bg-slate-900"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              ) : linked ? (
                <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">{t('compose.noMedia')}</p>
              ) : null}
            </div>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 px-5 py-3 dark:border-slate-800">
          <Link to="/admin/events/new" className="text-xs text-sky-700 hover:underline dark:text-sky-400">
            {t('quick.fullForm')}
          </Link>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => void save('draft')} disabled={!parts || !!busy}>
              {t('quick.draft')}
            </Button>
            {canPublish ? (
              <Button onClick={() => void save('published')} loading={busy === 'save'} disabled={!parts || busy === 'compose'}>
                {t('quick.publish')}
              </Button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
