import { useEffect, useRef, useState } from 'react';
import { Bell, BellOff, Smartphone, Volume2 } from 'lucide-react';
import { DEFAULT_CATEGORIES, getCategoryIcon } from '@/data/categoryRegistry';
import {
  setAllCategoriesAudible,
  setSoundScope,
  setCategoryAudible,
  setSoundMuted,
  useAudioReady,
  useSoundSetting,
} from '@/hooks/useSoundSetting';
import { useI18n } from '@/i18n';
import { playChime, unlockAudio } from '@/lib/notifySound';
import { cn } from '@/utils/cn';
import { disablePush, enablePush, usePushState } from '@/lib/push';

const SLUGS = DEFAULT_CATEGORIES.map((c) => c.slug);

/**
 * Bell button + menu: master sound switch and a checkbox per event type.
 * Preferences are per browser (localStorage).
 */
export function SoundMenu({ onOpen }: { onOpen?: () => void } = {}) {
  const { t, categoryLabel } = useI18n();
  const sound = useSoundSetting();
  const audioReady = useAudioReady();
  const needsClick = !sound.muted && !audioReady;
  const [open, setOpen] = useState(false);
  const push = usePushState();
  const rootRef = useRef<HTMLDivElement>(null);

  // Close on outside click / Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent | TouchEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('touchstart', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const preview = () => window.setTimeout(() => playChime('event', { force: true }), 60);
  const allOn = sound.mutedCategories.size === 0;
  const someOn = SLUGS.some((s) => !sound.mutedCategories.has(s));

  const buttonLabel = needsClick ? t('nav.soundEnable') : t('sound.menu');

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => {
          unlockAudio(); // a click is what browsers need to allow sound
          if (needsClick) preview();
          setOpen((o) => {
            if (!o) onOpen?.(); // e.g. close the filter panel: both don't fit on a phone
            return !o;
          });
        }}
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={buttonLabel}
        title={buttonLabel}
        className="relative inline-flex size-9 items-center justify-center rounded-lg text-slate-600 hover:bg-slate-900/5 hover:text-slate-900 focus-visible:outline-2 focus-visible:outline-sky-500 dark:text-slate-300 dark:hover:bg-white/10 dark:hover:text-white"
      >
        {sound.muted ? <BellOff className="size-4" aria-hidden /> : <Bell className="size-4" aria-hidden />}
        {needsClick ? (
          <span className="absolute end-1.5 top-1.5 size-2 rounded-full bg-amber-500 ring-2 ring-white dark:ring-slate-950" aria-hidden />
        ) : null}
      </button>

      {open ? (
        <div
          role="dialog"
          aria-label={t('sound.menu')}
          className="ofm-scroll fixed inset-x-3 top-16 z-[1100] max-h-[calc(100dvh-9.5rem)] overflow-y-auto overscroll-contain rounded-xl bg-white shadow-2xl ring-1 ring-slate-900/10 sm:absolute sm:inset-x-auto sm:end-0 sm:top-11 sm:w-72 sm:max-h-[min(80vh,640px)] dark:bg-slate-900 dark:ring-white/10"
        >
          <div className="flex items-center gap-3 border-b border-slate-200 px-4 py-3 dark:border-slate-800">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-slate-900 dark:text-white">{t('sound.title')}</p>
              <p className="text-xs text-slate-500 dark:text-slate-400">{t('sound.subtitle')}</p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={!sound.muted}
              aria-label={t('sound.master')}
              onClick={() => {
                const turningOn = sound.muted;
                setSoundMuted(!sound.muted);
                if (turningOn) preview();
              }}
              className={cn(
                'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500',
                sound.muted ? 'bg-slate-300 dark:bg-slate-700' : 'bg-sky-600',
              )}
            >
              <span
                className={cn(
                  'inline-block size-5 rounded-full bg-white shadow transition-transform',
                  sound.muted ? 'translate-x-0.5 rtl:-translate-x-0.5' : 'translate-x-[1.375rem] rtl:-translate-x-[1.375rem]',
                )}
              />
            </button>
          </div>

          {/* Push: sound + alert on this device, also when the site is closed or installed as an app. */}
          <div className="border-b border-slate-200 px-4 py-3 dark:border-slate-800">
            <div className="flex items-center gap-3">
              <Smartphone className="size-4 shrink-0 text-sky-600 dark:text-sky-400" aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-slate-900 dark:text-white">{t('push.title')}</p>
                <p className="text-xs text-slate-500 dark:text-slate-400">{t('push.subtitle')}</p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={push === 'on'}
                aria-label={t('push.title')}
                disabled={push === 'busy' || push === 'unsupported' || push === 'needs-install' || push === 'denied'}
                onClick={() => void (push === 'on' ? disablePush() : enablePush())}
                className={cn(
                  'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500 disabled:opacity-50',
                  push === 'on' ? 'bg-sky-600' : 'bg-slate-300 dark:bg-slate-700',
                )}
              >
                <span className={cn('inline-block size-5 rounded-full bg-white shadow transition-transform', push === 'on' ? 'translate-x-[1.375rem] rtl:-translate-x-[1.375rem]' : 'translate-x-0.5 rtl:-translate-x-0.5')} />
              </button>
            </div>
            {push === 'needs-install' || push === 'unsupported' || push === 'denied' ? (
              <p className="mt-2 rounded-lg bg-amber-50 px-2.5 py-1.5 text-xs text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">{t(`push.${push}` as 'push.denied')}</p>
            ) : null}
          </div>

          {needsClick ? (
            <p className="bg-amber-50 px-4 py-2 text-xs text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">{t('sound.needsClick')}</p>
          ) : null}

          <fieldset disabled={sound.muted} className={cn('border-b border-slate-100 px-4 py-2.5 dark:border-slate-800', sound.muted && 'opacity-50')}>
            <legend className="sr-only">{t('sound.scope')}</legend>
            <p className="pb-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">{t('sound.scope')}</p>
            {(['filtered', 'all'] as const).map((id) => (
              <label key={id} className="flex cursor-pointer items-start gap-2.5 rounded-lg py-1 text-sm text-slate-700 dark:text-slate-200">
                <input
                  type="radio"
                  name="sound-scope"
                  className="mt-0.5 size-4 accent-sky-600"
                  checked={sound.scope === id}
                  onChange={() => setSoundScope(id)}
                />
                <span>{t(id === 'filtered' ? 'sound.scopeFiltered' : 'sound.scopeAll')}</span>
              </label>
            ))}
            <p className="pt-1 text-[11px] leading-snug text-slate-500 dark:text-slate-400">{t('sound.scopeHint')}</p>
          </fieldset>

          <fieldset disabled={sound.muted} className={cn('px-2 py-2', sound.muted && 'opacity-50')}>
            <legend className="sr-only">{t('sound.categories')}</legend>
            <div className="flex items-center justify-between px-2 pb-1.5">
              <span className="text-[11px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">{t('sound.categories')}</span>
              <button
                type="button"
                onClick={() => setAllCategoriesAudible(SLUGS, !allOn)}
                className="text-xs font-semibold text-sky-700 hover:underline disabled:no-underline dark:text-sky-400"
              >
                {allOn ? t('sound.none') : t('sound.all')}
              </button>
            </div>
            <ul className="ofm-scroll max-h-[min(55vh,22rem)] overflow-y-auto">
              {DEFAULT_CATEGORIES.map((c) => {
                const Icon = getCategoryIcon(c.icon);
                const on = !sound.mutedCategories.has(c.slug);
                return (
                  <li key={c.slug}>
                    <label className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-800">
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={(e) => setCategoryAudible(c.slug, e.target.checked)}
                        className="size-4 shrink-0 accent-sky-600"
                      />
                      <span
                        className="inline-flex size-5 shrink-0 items-center justify-center rounded-full text-white"
                        style={{ backgroundColor: c.color }}
                        aria-hidden
                      >
                        <Icon className="size-3" />
                      </span>
                      <span className="min-w-0 flex-1 truncate">{categoryLabel(c.slug, c.name)}</span>
                    </label>
                  </li>
                );
              })}
            </ul>
          </fieldset>

          <div className="flex items-center justify-between border-t border-slate-200 px-4 py-2.5 dark:border-slate-800">
            <span className="text-[11px] text-slate-500 dark:text-slate-400">
              {someOn || sound.muted ? t('sound.savedHere') : t('sound.allOff')}
            </span>
            <button
              type="button"
              onClick={() => {
                unlockAudio();
                window.setTimeout(() => playChime('event', { force: true }), 60);
              }}
              className="inline-flex items-center gap-1 text-xs font-semibold text-slate-700 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white"
            >
              <Volume2 className="size-3.5" aria-hidden />
              {t('sound.test')}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
