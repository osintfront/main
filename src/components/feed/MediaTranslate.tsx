import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Languages, Loader2, Lock } from 'lucide-react';
import { useI18n, type TranslationKey } from '@/i18n';
import { useAuth } from '@/hooks/useAuth';
import { usePermissions } from '@/hooks/usePermissions';
import { hasFeature, usePlanVersion } from '@/lib/plans';
import { openGate, openGateFor } from '@/components/plans/GateDialog';
import { buttonState, itemLabels, pairView, pick, type MediaReadingItem, type MediaTranslation } from '@/lib/mediaReading';
import { MediaTranslateError, fetchMediaTranslation, runMediaTranslation } from '@/services/mediaTranslateService';
import { setOverlayOn } from '@/lib/readingStore';
import type { PublicEvent } from '@/types/event';

/**
 * "Translate image/video" after Expand (event details window only): the button for the expansion's
 * button row and the result panel under the expansion. Pro / Max / Intel / staff; others see a lock.
 * Everything shown is plain text (React text nodes); each text keeps its own direction (dir="auto").
 */
const btn =
  'inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-xs font-semibold text-sky-700 hover:bg-sky-50 focus-visible:outline-2 focus-visible:outline-sky-500 disabled:opacity-60 dark:text-sky-400 dark:hover:bg-sky-500/10';

type Notice = 'quota' | 'budget' | 'busy' | 'failed' | 'noMedia' | null;

export function useMediaTranslate(event: PublicEvent, expandOpen: boolean): { button: ReactNode; panel: ReactNode } {
  const { t, lang } = useI18n();
  const { profile } = useAuth();
  const { can } = usePermissions();
  usePlanVersion();
  const hasMedia = !!event.mediaKinds?.some((k) => k === 'image' || k === 'video');
  const allowed = hasFeature(undefined, 'media_translate');
  const staff = can('event.edit.any');
  const [data, setData] = useState<MediaTranslation | null | undefined>(undefined);
  const [panel, setPanel] = useState(false);
  const [working, setWorking] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [hideMore, setHideMore] = useState(false);
  const current = useRef(event.id);

  // A new event: start again; a slow answer for the previous one is ignored.
  useEffect(() => {
    current.current = event.id;
    setData(undefined);
    setPanel(false);
    setWorking(false);
    setNotice(null);
    setHideMore(false);
  }, [event.id]);

  const run = useCallback(
    async (o: { redo?: boolean } = {}) => {
      const id = event.id;
      setNotice(null);
      setPanel(true);
      setWorking(true);
      setOverlayOn(id, true); // the event's pictures show the translation
      try {
        const r = await runMediaTranslation(id, { redo: o.redo });
        if (current.current !== id) return;
        setData(r.data);
        if (!r.ran) setHideMore(true);
      } catch (err) {
        if (current.current !== id) return;
        const code = err instanceof MediaTranslateError ? err.code : 'failed';
        // Used up today: say so in the panel (saved readings stay open); plan / sign-up → the gate.
        if (code !== 'quota_exceeded' && openGateFor(code, 'media_translate')) {
          setPanel(false);
          return;
        }
        setNotice(code === 'quota_exceeded' ? 'quota' : code === 'budget' || code === 'busy' ? code : code === 'no_media' ? 'noMedia' : 'failed');
      } finally {
        if (current.current === id) setWorking(false);
      }
    },
    [event.id],
  );

  // Load the saved reading once the expansion is open (a read, no AI).
  useEffect(() => {
    if (!expandOpen || !hasMedia || !allowed || data !== undefined) return;
    const id = event.id;
    void fetchMediaTranslation(id).then((d) => {
      if (current.current !== id) return;
      setData(d);
      // Someone already started it: show the working view and wait. Joining only polls, so opening the
      // window can never start (or charge for) a run.
      if (!d?.working) return;
      setPanel(true);
      setWorking(true);
      void runMediaTranslation(id, { join: true })
        .then((r) => current.current === id && setData(r.data))
        .catch(() => fetchMediaTranslation(id, true).then((f) => current.current === id && setData(f)))
        .finally(() => current.current === id && setWorking(false));
    });
  }, [expandOpen, hasMedia, allowed, data, event.id]);

  const state = buttonState({ hasMedia, expandOpen, allowed, data });
  const left = data && data.limit != null ? t('gate.left', { n: Math.max(data.limit - data.used, 0), limit: data.limit }) : null;
  const leftSpan = left ? <span className="text-[11px] text-slate-500 dark:text-slate-400">{left}</span> : null;

  let button: ReactNode = null;
  if (state === 'locked') {
    button = (
      <button type="button" data-mt-button className={btn} onClick={() => openGate(profile ? 'upgrade' : 'signup', 'media_translate')}>
        <Lock className="size-3.5" aria-hidden />
        {t('mt.button')}
      </button>
    );
  } else if (state === 'loading') {
    button = (
      <button type="button" data-mt-button className={btn} disabled>
        <Loader2 className="size-3.5 animate-spin" aria-hidden />
        {t('mt.button')}
      </button>
    );
  } else if (state === 'translate') {
    button = (
      <>
        <button type="button" data-mt-button className={btn} disabled={working} onClick={() => void run()}>
          {working ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Languages className="size-3.5" aria-hidden />}
          {t('mt.button')}
        </button>
        {leftSpan}
      </>
    );
  } else if (state === 'show' || state === 'show_more') {
    button = (
      <>
        <button type="button" data-mt-button className={btn} aria-expanded={panel} onClick={() => {
            if (!panel) setOverlayOn(event.id, true);
            setPanel((p) => !p);
          }}>
          <Languages className="size-3.5" aria-hidden />
          {panel ? t('mt.hide') : t('mt.show')}
        </button>
        {state === 'show_more' && !hideMore ? (
          <>
            <button type="button" data-mt-more className={btn} disabled={working} onClick={() => void run()}>
              {working ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : null}
              {t('mt.more', { n: data!.todo })}
            </button>
            {leftSpan}
          </>
        ) : null}
      </>
    );
  }

  const showPanel = expandOpen && hasMedia && allowed && (panel || working || !!notice);
  const panelNode = showPanel ? (
    <section data-mt-panel role="region" aria-label={t('mt.title')} className="mt-2 rounded-lg border border-slate-200 p-2.5 text-[13px] dark:border-slate-700">
      <h4 className="mb-1.5 text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">{t('mt.title')}</h4>
      {working ? (
        <p aria-live="polite" data-mt-working className="flex items-center gap-1.5 text-slate-600 dark:text-slate-300">
          <Loader2 className="size-3.5 animate-spin" aria-hidden />
          {t('mt.working')}
        </p>
      ) : null}
      {notice ? (
        <p data-mt-notice={notice} className="flex flex-wrap items-center gap-2 text-amber-800 dark:text-amber-300">
          {notice === 'quota' ? t('mt.quota', { limit: data?.limit ?? '' }) : t(`mt.${notice}` as TranslationKey)}
          {notice === 'failed' ? (
            <button type="button" data-mt-retry className={btn} onClick={() => void run()}>
              {t('mt.retry')}
            </button>
          ) : null}
        </p>
      ) : null}
      {!working && data?.items.length ? (
        <div className="space-y-3">
          {data.items.map((item, i) => (
            <MediaItemView key={item.mediaId} item={item} label={itemLabels(data.items)[i]} lang={lang} t={t} />
          ))}
          <p className="flex flex-wrap items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400">
            {t('mt.aiLine')}
            {staff ? (
              <button
                type="button"
                data-mt-redo
                className={btn}
                onClick={() => {
                  if (window.confirm(t('mt.redoConfirm'))) void run({ redo: true });
                }}
              >
                {t('mt.redo')}
              </button>
            ) : null}
          </p>
          {staff && data.speechNote ? (
            <p data-mt-staff-note className="text-[11px] text-amber-700 dark:text-amber-300">
              {t('mt.staffNote', { note: data.speechNote })}
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  ) : null;

  return { button, panel: panelNode };
}

function MediaItemView({
  item,
  label,
  lang,
  t,
}: {
  item: MediaReadingItem;
  label: { key: 'mt.image' | 'mt.video'; n: number };
  lang: string;
  t: ReturnType<typeof useI18n>['t'];
}) {
  const description = pick(item.descriptionHe, item.descriptionEn, lang);
  const sp = item.speech;
  const langName = (code: string) => {
    const key = `mt.lang.${code}` as TranslationKey;
    const v = t(key);
    return v === key ? code.toUpperCase() : v;
  };
  return (
    <article data-mt-item={item.kind} className="space-y-1.5 border-t border-slate-100 pt-2 first:border-t-0 first:pt-0 dark:border-slate-800">
      <div className="flex items-center gap-2">
        {item.thumb ? <img src={item.thumb} alt="" className="size-12 shrink-0 rounded object-cover" loading="lazy" /> : null}
        <strong className="font-semibold">{t(label.key, { n: label.n })}</strong>
      </div>
      {description ? (
        <p>
          <span className="font-semibold">{t('mt.shows')}: </span>
          <span dir="auto">{description}</span>
        </p>
      ) : null}
      <div>
        <p className="font-semibold">{item.kind === 'image' ? t('mt.texts') : t('mt.textsVideo')}</p>
        {item.texts.length ? (
          <ul className="mt-1 space-y-1">
            {item.texts.map((p) => {
              const v = pairView(p, lang);
              return (
                <li key={p.orig} data-mt-pair className="grid grid-cols-1 gap-x-3 sm:grid-cols-2">
                  <bdi dir="auto" className="break-words">{v.orig}</bdi>
                  {v.translation ? (
                    <span dir="auto" className="break-words text-slate-700 dark:text-slate-200">
                      {v.translation}
                      {v.where ? <span className="ms-1 text-[11px] text-slate-500 dark:text-slate-400">({v.where})</span> : null}
                    </span>
                  ) : v.where ? (
                    <span className="text-[11px] text-slate-500 dark:text-slate-400">({v.where})</span>
                  ) : null}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-slate-500 dark:text-slate-400">{t('mt.noTexts')}</p>
        )}
      </div>
      {item.kind === 'video' && sp ? (
        sp.state === 'ok' ? (
          <div data-mt-speech>
            <p className="font-semibold">{t('mt.said')}</p>
            <p>
              <span className="font-semibold">{t('mt.summary')}: </span>
              <span dir="auto">{pick(sp.summaryHe, sp.summaryEn, lang)}</span>
            </p>
            <details>
              <summary className="cursor-pointer text-sky-700 dark:text-sky-400">{t('mt.full')}</summary>
              <p dir="auto" className="whitespace-pre-line">{pick(sp.he, sp.en, lang)}</p>
            </details>
            <details>
              <summary className="cursor-pointer text-sky-700 dark:text-sky-400">{t('mt.original', { lang: langName(sp.lang) })}</summary>
              <p dir="auto" className="whitespace-pre-line">{sp.orig}</p>
            </details>
            {sp.cut ? <p className="text-[11px] text-slate-500 dark:text-slate-400">{t('mt.cut')}</p> : null}
          </div>
        ) : (
          <p data-mt-speech-state={sp.state} className="text-slate-500 dark:text-slate-400">{t(`mt.speech.${sp.state}` as TranslationKey)}</p>
        )
      ) : null}
    </article>
  );
}
