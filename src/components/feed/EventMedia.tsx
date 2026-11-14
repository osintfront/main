import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Download, Loader2, Lock } from 'lucide-react';
import { featureLimit, hasFeature, usePlanVersion } from '@/lib/plans';
import { openGate } from '@/components/plans/GateDialog';
import { useAuth } from '@/hooks/useAuth';
import type { MediaKind } from '@/types/event';
import { useI18n } from '@/i18n';
import { openLightbox } from '@/lib/lightbox';
import { overlayBoxes, readingFor, type OverlayBox } from '@/lib/mediaOverlay';
import { mountOverlay } from '@/lib/mediaOverlayDom';
import type { Segment } from '@/lib/mediaReading';
import { SubtitledVideo } from './SubtitledVideo';
import { useEventReading } from '@/hooks/useEventReading';
import { loadEventMedia, requestVideo, toMediaView, type EventMediaView } from '@/services/eventMediaService';
import { safeExternalUrl } from '@/utils/url';

/** Photos and videos of an event, loaded lazily (batched across cards). */
const RECENT_MS = 30 * 60_000; // keep checking fresh events for late photos/videos
const POLL_MS = 30_000;

type Still = EventMediaView['stills'][number];
const NO_SEGMENTS: Segment[] = [];

/** A video still with ▶. Play asks the server for the video (fetched once, max 50 MB). */
function VideoStill({ still, segments }: { still: Still; segments: Segment[] }) {
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
      <SubtitledVideo
        src={src}
        poster={still.url}
        autoPlay
        aspect={still.width && still.height ? `${still.width} / ${still.height}` : '16 / 9'}
        maxHeight={360}
        segments={segments}
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

type Image = EventMediaView['images'][number];

/** One picture; with saved boxes, the Original / Translated switch and the boxes over it. */
function Picture({ m, boxes, overlay, setOverlay }: { m: Image; boxes: OverlayBox[]; overlay: boolean; setOverlay: (on: boolean) => void }) {
  const { t } = useI18n();
  const host = useRef<HTMLButtonElement>(null);
  const img = useRef<HTMLImageElement>(null);
  const on = overlay && boxes.length > 0;
  const key = JSON.stringify(boxes); // a new array each render; remount only when the boxes change
  useEffect(() => {
    if (!on || !host.current || !img.current) return;
    return mountOverlay(host.current, img.current, JSON.parse(key) as OverlayBox[], { fit: 'cover', interactive: false });
  }, [on, key]);
  const labels = { original: t('mt.ov.original'), translated: t('mt.ov.translated'), hint: t('mt.ov.hint') };
  return (
    <>
      <button
        ref={host}
        type="button"
        onClick={() => openLightbox(m.url, '', boxes.length ? { boxes, on: overlay, labels, onChange: setOverlay } : undefined)}
        aria-label={t('media.enlarge')}
        className="relative block w-full cursor-zoom-in overflow-hidden rounded-lg bg-slate-100 dark:bg-slate-800"
      >
        <img
          ref={img}
          src={m.url}
          alt=""
          loading="lazy"
          width={m.width ?? undefined}
          height={m.height ?? undefined}
          className="block h-auto max-h-60 w-full object-cover"
        />
      </button>
      {boxes.length ? (
        <div role="group" aria-label={t('mt.ov.switch')} className="ofm-ov__switch absolute bottom-1.5 start-1.5">
          <button type="button" data-ov-mode="original" aria-pressed={!overlay} onClick={() => setOverlay(false)}>
            {labels.original}
          </button>
          <button type="button" data-ov-mode="translated" aria-pressed={overlay} onClick={() => setOverlay(true)}>
            {labels.translated}
          </button>
        </div>
      ) : null}
    </>
  );
}

export function EventMedia({ eventId, occurredAt, kinds }: { eventId: string; occurredAt: string; kinds?: MediaKind[] }) {
  const { t, lang } = useI18n();
  const { reading, overlay, setOverlay } = useEventReading(eventId);
  const { profile } = useAuth();
  usePlanVersion();
  const [view, setView] = useState<EventMediaView | null>(null);
  const allowed = hasFeature(undefined, 'media');
  const firstOnly = featureLimit('media') != null; // free: the first picture only
  const canDownload = hasFeature(undefined, 'media_download');
  const hasMedia = !!kinds?.some((k) => k === 'image' || k === 'video');

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
  const boxesFor = (id: string) => overlayBoxes(readingFor(reading, [id]), lang);
  const segmentsFor = (ids: (string | null)[]) => readingFor(reading, ids)?.speech?.segments ?? NO_SEGMENTS;

  return (
    <div className="mt-2 space-y-1.5" onClick={(e) => e.stopPropagation()}>
      {view.videos.map(({ video, poster, posterId }) => (
        <div key={video.id} data-media-video={video.id}>
          <SubtitledVideo
            src={video.url}
            poster={poster ?? undefined}
            preload="none"
            aspect={video.width && video.height ? `${video.width} / ${video.height}` : '16 / 9'}
            maxHeight={320}
            segments={segmentsFor([posterId, video.id])}
          />
        </div>
      ))}
      {view.stills.map((s) => (
        <VideoStill key={s.id} still={s} segments={segmentsFor([s.id])} />
      ))}
      {view.images.length ? (
        <div className={view.images.length > 1 ? 'grid grid-cols-2 gap-1.5' : 'grid grid-cols-1'}>
          {view.images.map((m) => (
            <div key={m.id} data-media-id={m.id} className="relative">
              <Picture m={m} boxes={boxesFor(m.id)} overlay={overlay} setOverlay={setOverlay} />
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
