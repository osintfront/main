// Video on demand: a reader pressed play on a video thumbnail. Fetch the video of that
// public Telegram post (max 50 MB) into the "event-media" bucket, once, and return its URL.
// Storage is kept under 90% by deleting the oldest videos first (FIFO).
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.45.4";

export const VIDEO_MAX = 50 * 1024 * 1024;
const STORAGE_LIMIT = Number(Deno.env.get("MEDIA_STORAGE_LIMIT_BYTES") ?? 1024 ** 3); // free tier: 1 GB
const HIGH_WATER = 0.9;
const LOW_WATER = 0.8;
const UA = "Mozilla/5.0 (compatible; OsintfrontBot/1.0; +https://osintfront.com)";

export type VideoAnswer =
  | { state: "ready"; url: string; width: number | null; height: number | null }
  | { state: "loading" }
  | { state: "too_big"; bytes: number | null }
  | { state: "unavailable"; link: string | null };

async function storageUsed(db: SupabaseClient): Promise<number> {
  const { data, error } = await db.rpc("media_storage_usage");
  if (error) throw error;
  return Number(data ?? 0);
}

async function removeVideos(db: SupabaseClient, rows: { id: string; storage_path: string; thumb_id?: string | null }[]) {
  if (!rows.length) return;
  await db.storage.from("event-media").remove(rows.map((r) => r.storage_path));
  await db.from("event_media").delete().in("id", rows.map((r) => r.id));
  const thumbs = rows.map((r) => r.thumb_id).filter(Boolean) as string[];
  // The thumbnail stays; pressing play again fetches the video again.
  if (thumbs.length) await db.from("event_media").update({ video_state: null, video_state_at: null }).in("id", thumbs);
}

/** FIFO: delete the oldest videos until `incoming` more bytes fit under 80% (only when past 90%). */
export async function makeRoom(db: SupabaseClient, incoming: number) {
  let used = await storageUsed(db);
  if (used + incoming <= STORAGE_LIMIT * HIGH_WATER) return used;
  while (used + incoming > STORAGE_LIMIT * LOW_WATER) {
    const { data: oldest } = await db.from("event_media").select("id,storage_path,bytes,thumb_id")
      .eq("kind", "video").eq("ready", true).order("created_at").limit(10);
    if (!oldest?.length) break;
    for (const r of oldest) {
      await removeVideos(db, [r]);
      used -= Number(r.bytes ?? 0);
      if (used + incoming <= STORAGE_LIMIT * LOW_WATER) break;
    }
    used = await storageUsed(db);
  }
  return used;
}

/** The video file URLs of a public post, in order (from its embed page). */
async function postVideoUrls(postUrl: string): Promise<string[]> {
  const res = await fetch(`${postUrl}?embed=1&mode=tme`, { headers: { "User-Agent": UA, "Accept-Language": "en" } });
  if (!res.ok) return [];
  const html = await res.text();
  return [...html.matchAll(/<video[^>]+src="(https:\/\/[^"]+)"/g)].map((m) => m[1].replace(/&amp;/g, "&"));
}

export async function videoForThumb(db: SupabaseClient, thumbId: string): Promise<VideoAnswer | null> {
  const { data: thumb } = await db.from("event_media")
    .select("id,event_id,kind,source_url,source_index,video_state,video_state_at,video_bytes,width,height")
    .eq("id", thumbId).maybeSingle();
  if (!thumb || thumb.kind !== "video_thumb") return null;
  const { data: ev } = await db.from("events").select("status,deleted_at").eq("id", thumb.event_id).maybeSingle();
  if (!ev || ev.deleted_at || !["published", "archived"].includes(ev.status)) return null;

  const { data: have } = await db.from("event_media").select("public_url,width,height")
    .eq("thumb_id", thumb.id).eq("kind", "video").eq("ready", true).maybeSingle();
  if (have) return { state: "ready", url: have.public_url, width: have.width, height: have.height };
  if (thumb.video_state === "too_big") return { state: "too_big", bytes: thumb.video_bytes };
  if (thumb.video_state === "unavailable") return { state: "unavailable", link: thumb.source_url };
  if (!thumb.source_url) return { state: "unavailable", link: null };
  // Someone else is fetching it right now.
  if (thumb.video_state === "loading" && Date.now() - Date.parse(thumb.video_state_at ?? "") < 120_000) return { state: "loading" };

  const mark = (video_state: string | null, extra: Record<string, unknown> = {}) =>
    db.from("event_media").update({ video_state, video_state_at: new Date().toISOString(), ...extra }).eq("id", thumb.id);
  await mark("loading");
  try {
    const urls = await postVideoUrls(thumb.source_url);
    const src = urls[Number(thumb.source_index ?? 0)] ?? urls[0];
    // No file on the web preview (Telegram leaves big videos out): watch it on Telegram.
    if (!src) {
      await mark("unavailable");
      return { state: "unavailable", link: thumb.source_url };
    }
    const res = await fetch(src, { headers: { "User-Agent": UA } });
    if (!res.ok || !res.body) {
      await mark("unavailable");
      return { state: "unavailable", link: thumb.source_url };
    }
    const declared = Number(res.headers.get("content-length") ?? 0);
    if (declared > VIDEO_MAX) {
      await res.body.cancel();
      await mark("too_big", { video_bytes: declared });
      return { state: "too_big", bytes: declared };
    }
    // Read with a hard cap (the length header can be missing).
    const chunks: Uint8Array[] = [];
    let size = 0;
    const reader = res.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > VIDEO_MAX) {
        await reader.cancel();
        await mark("too_big", { video_bytes: size });
        return { state: "too_big", bytes: size };
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let at = 0;
    for (const c of chunks) {
      bytes.set(c, at);
      at += c.length;
    }
    const mime = (res.headers.get("content-type") ?? "video/mp4").split(";")[0];
    await makeRoom(db, size);
    const d = new Date();
    const path = `${d.getUTCFullYear()}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${thumb.event_id}/ondemand-${thumb.id}.mp4`;
    const up = await db.storage.from("event-media").upload(path, bytes, { contentType: /^video\//.test(mime) ? mime : "video/mp4", upsert: true });
    if (up.error) throw new Error(up.error.message);
    const url = db.storage.from("event-media").getPublicUrl(path).data.publicUrl;
    const { error } = await db.from("event_media").insert({
      event_id: thumb.event_id, kind: "video", storage_path: path, public_url: url, bytes: size, mime: "video/mp4",
      ready: true, thumb_id: thumb.id, width: thumb.width, height: thumb.height, source_msg_key: "on-demand",
    });
    if (error) throw new Error(error.message);
    await mark("ready", { video_bytes: size });
    return { state: "ready", url, width: thumb.width, height: thumb.height };
  } catch (e) {
    await mark(null);
    throw e;
  }
}
