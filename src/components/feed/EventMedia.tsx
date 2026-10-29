import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { useI18n } from '@/i18n';
import { openLightbox } from '@/lib/lightbox';
import { loadEventMedia, requestVideo, toMediaView, type EventMediaView } from '@/services/eventMediaService';
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

export function EventMedia({ eventId, occurredAt }: { eventId: string; occurredAt: string }) {
  const { t } = useI18n();
  const [view, setView] = useState<EventMediaView | null>(null);

  useEffect(() => {
    let alive = true;
    let timer: number | undefined;
    const load = (force: boolean) =>
      loadEventMedia(eventId, force).then((items) => {
        if (!alive) return;
        setView(items.length ? toMediaView(items) : null);
        if (Date.now() - new Date(occurredAt).getTime() < RECENT_MS) timer = window.setTimeout(() => void load(true), POLL_MS);
      });
    void load(false);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [eventId, occurredAt]);

  if (!view) return null;

  return (
    <div className="mt-2 space-y-1.5" onClick={(e) => e.stopPropagation()}>
      {view.videos.map(({ video, poster }) => (
        <video
          key={video.id}
          src={video.url}
          poster={poster ?? undefined}
          controls
          preload="none"
          playsInline
          className="w-full rounded-lg bg-black"
          style={{ aspectRatio: video.width && video.height ? `${video.width} / ${video.height}` : '16 / 9', maxHeight: 320 }}
        />
      ))}
      {view.stills.map((s) => (
        <VideoStill key={s.id} still={s} />
      ))}
      {view.images.length ? (
        <div className={view.images.length > 1 ? 'grid grid-cols-2 gap-1.5' : 'grid grid-cols-1'}>
          {view.images.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => openLightbox(m.url)}
              aria-label={t('media.enlarge')}
              className="relative block cursor-zoom-in overflow-hidden rounded-lg bg-slate-100 dark:bg-slate-800"
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
          ))}
        </div>
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
