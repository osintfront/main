import { useEffect, useState } from 'react';
import { loadEventMedia, toMediaView, type EventMediaView } from '@/services/eventMediaService';

/** Photos and videos of an event, loaded lazily (batched across cards). */
const RECENT_MS = 30 * 60_000; // keep checking fresh events for late photos/videos
const POLL_MS = 30_000;

export function EventMedia({ eventId, occurredAt }: { eventId: string; occurredAt: string }) {
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
  const tiles = view.images.length + view.stills.length;

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
      {tiles ? (
        <div className={tiles > 1 ? 'grid grid-cols-2 gap-1.5' : 'grid grid-cols-1'}>
          {[...view.images, ...view.stills].map((m) => (
            <a key={m.id} href={m.url} target="_blank" rel="noopener noreferrer" className="relative block overflow-hidden rounded-lg bg-slate-100 dark:bg-slate-800">
              <img
                src={m.url}
                alt=""
                loading="lazy"
                width={m.width ?? undefined}
                height={m.height ?? undefined}
                className="block h-auto max-h-60 w-full object-cover"
              />
              {m.kind === 'video_thumb' ? (
                <span className="absolute inset-0 grid place-items-center text-2xl text-white [text-shadow:0_1px_4px_#000]" aria-hidden>
                  ▶
                </span>
              ) : null}
            </a>
          ))}
        </div>
      ) : null}
    </div>
  );
}
