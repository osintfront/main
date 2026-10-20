import { supabase } from '@/integrations/supabase/client';

/**
 * Photos and videos attached to public events (table `event_media`, public
 * bucket `event-media`). RLS only returns media of published events whose
 * upload has finished. Old videos are removed server-side when storage fills
 * up (oldest first); their thumbnail stays and is shown instead.
 */
export type EventMediaKind = 'image' | 'video_thumb' | 'video';

export interface EventMediaItem {
  id: string;
  eventId: string;
  kind: EventMediaKind;
  url: string;
  width: number | null;
  height: number | null;
  sourceMsgKey: string | null;
}

/** What to render: images, plus each video with its thumbnail as poster. */
export interface EventMediaView {
  images: EventMediaItem[];
  videos: { video: EventMediaItem; poster: string | null }[];
  /** Thumbnails whose video was removed — shown as stills with a play mark. */
  stills: EventMediaItem[];
}

const cache = new Map<string, { items: EventMediaItem[]; at: number }>();
// Media may arrive a little after the event (photos) or minutes later (videos).
const CACHE_MS = 30_000;
const waiting = new Map<string, ((items: EventMediaItem[]) => void)[]>();
let queued = new Set<string>();
let timer: number | undefined;

interface Row {
  id: string;
  event_id: string;
  kind: EventMediaKind;
  public_url: string;
  width: number | null;
  height: number | null;
  source_msg_key: string | null;
}

async function flush() {
  const ids = [...queued];
  queued = new Set();
  timer = undefined;
  if (!ids.length) return;
  let rows: Row[] = [];
  if (supabase) {
    const { data } = await supabase
      .from('event_media')
      .select('id, event_id, kind, public_url, width, height, source_msg_key')
      .in('event_id', ids)
      .order('created_at');
    rows = (data as Row[] | null) ?? [];
  }
  for (const id of ids) {
    const items = rows
      .filter((r) => r.event_id === id)
      .map((r) => ({
        id: r.id,
        eventId: r.event_id,
        kind: r.kind,
        url: r.public_url,
        width: r.width,
        height: r.height,
        sourceMsgKey: r.source_msg_key,
      }));
    cache.set(id, { items, at: Date.now() });
    for (const cb of waiting.get(id) ?? []) cb(items);
    waiting.delete(id);
  }
}

/** Load media for one event. Calls made in the same tick are batched into one query. */
export function loadEventMedia(eventId: string, force = false): Promise<EventMediaItem[]> {
  const hit = cache.get(eventId);
  if (hit && !force && Date.now() - hit.at < CACHE_MS) return Promise.resolve(hit.items);
  return new Promise((resolve) => {
    waiting.set(eventId, [...(waiting.get(eventId) ?? []), resolve]);
    queued.add(eventId);
    if (timer === undefined) timer = window.setTimeout(() => void flush(), 30);
  });
}

/** Forget cached media (e.g. after a live update) so the next load refetches. */
export function invalidateEventMedia(eventId?: string) {
  if (eventId) cache.delete(eventId);
  else cache.clear();
}

export function toMediaView(items: EventMediaItem[]): EventMediaView {
  const videoItems = items.filter((m) => m.kind === 'video');
  const withVideo = new Set(videoItems.map((v) => v.sourceMsgKey));
  const thumbFor = (key: string | null) => items.find((m) => m.kind === 'video_thumb' && m.sourceMsgKey === key)?.url ?? null;
  return {
    images: items.filter((m) => m.kind === 'image'),
    videos: videoItems.map((video) => ({ video, poster: thumbFor(video.sourceMsgKey) })),
    stills: items.filter((m) => m.kind === 'video_thumb' && !withVideo.has(m.sourceMsgKey)),
  };
}

