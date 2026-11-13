import { useEffect, useState, type MouseEvent } from 'react';
import { Link } from 'react-router-dom';
import { Download, Loader2, Lock, Trash2 } from 'lucide-react';
import { featureLimit, hasFeature, usePlanVersion } from '@/lib/plans';
import { openGate } from '@/components/plans/GateDialog';
import { useAuth } from '@/hooks/useAuth';
import { usePermissions } from '@/hooks/usePermissions';
import { useToast } from '@/components/common/Toast';
import type { MediaKind } from '@/types/event';
import { useI18n } from '@/i18n';
import { openLightbox } from '@/lib/lightbox';
import { loadEventMedia, removeEventMedia, requestVideo, toMediaView, type EventMediaView } from '@/services/eventMediaService';
import { safeExternalUrl } from '@/utils/url';

/** Photos and videos of an event, loaded lazily (batched across cards). */
const RECENT_MS = 30 * 60_000; // keep checking fresh events for late photos/videos
const POLL_MS = 30_000;

type Still = EventMediaView['stills'][number];

/** A video still with ▶. Play asks the server for the video (fetched once, max 50 MB). */
function VideoStill({ still }: { still: Still }) {
  const { t } = useI18n();
  const [state, setState] = useState<'idle' | 'loading' | 'playing' | 'too_big' | 'unavailable' | 'error'>(
    still.videoState === 'too_big' ? 'too_big' : still.videoState === 'unavailable' ? 'unavailable' : 'idle',
  );
  const [src, setSrc] = useState<string | null>(still.onDemand?.url ?? null);
  const [mb, setMb] = useState<number | null>(null);
  const link = safeExternalUrl(still.sourceUrl);

  const play = async () => {
    if (src) return setState('playing');
    if (!still.sourceUrl) return setState('unavailable');
    setState('loading');
    try {
      const r = await requestVideo(still.id);
      if (r.state === 'ready') {
        setSrc(r.url);
        setState('playing');
      } else if (r.state === 'too_big') {
        setMb(r.bytes ? Math.round(r.bytes / 1024 / 1024) : null);
        setState('too_big');
      } else setState('unavailable');
    } catch {
      setState('error');
    }
  };

  if (state === 'playing' && src) {
    return (
      <video
        src={src}
        poster={still.url}
        controls
        autoPlay
        playsInline
        className="w-full rounded-lg bg-black"
        style={{ aspectRatio: still.width && still.height ? `${still.width} / ${still.height}` : '16 / 9', maxHeight: 360 }}
      />
    );
  }

  const note =
    state === 'too_big' ? (mb ? t('media.tooBig', { mb }) : t('media.tooBigNoSize')) : state === 'unavailable' ? t('media.unavailable') : state === 'error' ? t('media.videoError') : null;

  return (
    <div>
      <button
        type="button"
        onClick={() => void play()}
        disabled={state === 'loading' || state === 'too_big'}
        aria-label={t('media.play')}
        className="relative block w-full overflow-hidden rounded-lg bg-slate-900 disabled:cursor-default"
      >
        <img src={still.url} alt="" loading="lazy" width={still.width ?? undefined} height={still.height ?? undefined} className="block h-auto max-h-60 w-full object-cover opacity-90" />
        <span className="absolute inset-0 grid place-items-center">
          <span className="grid size-12 place-items-center rounded-full bg-black/60 text-xl text-white ring-2 ring-white/80">
            {state === 'loading' ? <Loader2 className="size-6 animate-spin" aria-hidden /> : '▶'}
          </span>
        </span>
        {state === 'loading' ? (
          <span className="absolute inset-x-0 bottom-0 bg-black/60 px-2 py-1 text-center text-xs text-white">{t('media.loadingVideo')}</span>
        ) : null}
      </button>
      {note || link ? (
        <p className="mt-1 flex flex-wrap items-center gap-x-2 text-[11px] text-slate-500 dark:text-slate-400">
          {note ? <span className="font-medium text-amber-700 dark:text-amber-400">{note}</span> : null}
          {link ? (
            <a href={link} target="_blank" rel="noopener noreferrer nofollow" className="font-semibold text-sky-700 hover:underline dark:text-sky-400">
              {t('media.watchAtSource')}
            </a>
          ) : null}
        </p>
      ) : null}
    </div>
  );
}

/** Staff only: remove this photo / video from the event. First tap arms it, the second removes. */
function RemoveMedia({ eventId, mediaId, onRemoved }: { eventId: string; mediaId: string; onRemoved: () => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const timer = window.setTimeout(() => setArmed(false), 4000);
    return () => window.clearTimeout(timer);
  }, [armed]);
  const click = async (e: MouseEvent) => {
    e.stopPropagation();
    if (!armed) return setArmed(true);
    setBusy(true);
    try {
      await removeEventMedia(eventId, mediaId);
      toast.success(t('media.removed'));
      onRemoved();
    } catch {
      toast.error(t('media.removeFailed'));
    } finally {
      setBusy(false);
      setArmed(false);
    }
  };
  return (
    <button
      type="button"
      onClick={(e) => void click(e)}
      disabled={busy}
      data-remove-media={mediaId}
      aria-label={armed ? t('media.removeConfirm') : t('media.remove')}
      title={armed ? t('media.removeConfirm') : t('media.remove')}
      className={`absolute start-1.5 top-1.5 z-10 inline-flex h-8 items-center gap-1 rounded-full px-2 text-xs font-semibold text-white ${armed ? 'bg-red-600 hover:bg-red-700' : 'bg-black/55 hover:bg-black/75'}`}
    >
      {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Trash2 className="size-4" aria-hidden />}
      {armed ? t('media.removeConfirm') : null}
    </button>
  );
}

export function EventMedia({ eventId, occurredAt, kinds }: { eventId: string; occurredAt: string; kinds?: MediaKind[] }) {
  const { t } = useI18n();
  const { profile } = useAuth();
  usePlanVersion();
  const [view, setView] = useState<EventMediaView | null>(null);
  const allowed = hasFeature(undefined, 'media');
  const firstOnly = featureLimit('media') != null; // free: the first picture only
  const canDownload = hasFeature(undefined, 'media_download');
  const hasMedia = !!kinds?.some((k) => k === 'image' || k === 'video');
  // Analysts and managers can take a wrong or unsuitable picture off the event.
  const canRemove = usePermissions().can('event.edit.any');
  const [reload, setReload] = useState(0);
  const removed = () => setReload((n) => n + 1);

  useEffect(() => {
    let alive = true;
    let timer: number | undefined;
    const load = (force: boolean) =>
      loadEventMedia(eventId, force).then((items) => {
        if (!alive) return;
        setView(items.length ? toMediaView(items) : null);
        if (Date.now() - new Date(occurredAt).getTime() < RECENT_MS) timer = window.setTimeout(() => void load(true), POLL_MS);
      });
    void load(reload > 0);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [eventId, occurredAt, reload]);

  // No pictures in the plan (guests): a blurred box that asks to sign up.
  if (!allowed) {
    if (!hasMedia) return null;
    return (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          openGate(profile ? 'upgrade' : 'signup', 'media');
        }}
        className="relative mt-2 grid h-32 w-full place-items-center overflow-hidden rounded-lg bg-gradient-to-br from-slate-300 to-slate-500 text-white dark:from-slate-700 dark:to-slate-900"
      >
        <span className="absolute inset-0 backdrop-blur-md" aria-hidden />
        <span className="relative inline-flex items-center gap-1.5 rounded-full bg-black/50 px-3 py-1.5 text-xs font-semibold">
          <Lock className="size-3.5" aria-hidden />
          {t('lock.media')}
        </span>
      </button>
    );
  }
  if (!view) return null;
  const more = firstOnly && !!kinds?.includes('video');

  return (
    <div className="mt-2 space-y-1.5" onClick={(e) => e.stopPropagation()}>
      {view.videos.map(({ video, poster }) => (
        <div key={video.id} className="relative">
          {canRemove ? <RemoveMedia eventId={eventId} mediaId={video.id} onRemoved={removed} /> : null}
          <video
          src={video.url}
          poster={poster ?? undefined}
          controls
          preload="none"
          playsInline
          className="w-full rounded-lg bg-black"
          style={{ aspectRatio: video.width && video.height ? `${video.width} / ${video.height}` : '16 / 9', maxHeight: 320 }}
          />
        </div>
      ))}
      {view.stills.map((s) => (
        <div key={s.id} className="relative">
          {canRemove ? <RemoveMedia eventId={eventId} mediaId={s.id} onRemoved={removed} /> : null}
          <VideoStill still={s} />
        </div>
      ))}
      {view.images.length ? (
        <div className={view.images.length > 1 ? 'grid grid-cols-2 gap-1.5' : 'grid grid-cols-1'}>
          {view.images.map((m) => (
            <div key={m.id} className="relative">
              {canRemove ? <RemoveMedia eventId={eventId} mediaId={m.id} onRemoved={removed} /> : null}
              <button
                type="button"
                onClick={() => openLightbox(m.url)}
                aria-label={t('media.enlarge')}
                className="relative block w-full cursor-zoom-in overflow-hidden rounded-lg bg-slate-100 dark:bg-slate-800"
              >
                <img
                  src={m.url}
                  alt=""
                  loading="lazy"
                  width={m.width ?? undefined}
                  height={m.height ?? undefined}
                  className="block h-auto max-h-60 w-full object-cover"
                />
              </button>
              {canDownload ? (
                <a
                  href={m.url}
                  download
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={t('media.download')}
                  className="absolute end-1.5 top-1.5 grid size-8 place-items-center rounded-full bg-black/55 text-white hover:bg-black/75"
                >
                  <Download className="size-4" aria-hidden />
                </a>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
      {firstOnly ? (
        <button
          type="button"
          onClick={() => openGate('upgrade', 'media')}
          className="inline-flex items-center gap-1 text-[11px] font-semibold text-sky-700 hover:underline dark:text-sky-400"
        >
          <Lock className="size-3" aria-hidden />
          {t(more ? 'lock.moreMediaVideo' : 'lock.moreMedia')}
        </button>
      ) : null}
      <p className="text-[10px] leading-snug text-slate-400 dark:text-slate-500">
        {t('media.copyright')}{' '}
        <Link to="/contact" className="underline hover:text-slate-600 dark:hover:text-slate-300">
          {t('media.copyrightContact')}
        </Link>
      </p>
    </div>
  );
}
