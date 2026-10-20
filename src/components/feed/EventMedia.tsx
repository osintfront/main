// Show WhatsApp images and videos attached to an event (table public.event_media, bucket "event-media").
// Drop <EventMedia eventId={event.id} supabase={supabase} /> into the event popup / side panel.
// Old videos are removed automatically (FIFO) when storage fills up; the thumbnail then stays as an image.
import { useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";

type Media = { id: string; public_url: string; width: number | null; height: number | null; kind: "image" | "video_thumb" | "video"; source_msg_key: string | null };

export function EventMedia({ eventId, supabase }: { eventId: string; supabase: SupabaseClient }) {
  const [media, setMedia] = useState<Media[]>([]);

  useEffect(() => {
    let alive = true;
    supabase
      .from("event_media")
      .select("id, public_url, width, height, kind, source_msg_key")
      .eq("event_id", eventId)
      .order("created_at")
      .then(({ data }) => alive && setMedia((data as Media[]) ?? []));
    return () => { alive = false; };
  }, [eventId, supabase]);

  // a video replaces its own thumbnail (same WhatsApp message); the thumbnail becomes the poster
  const videos = media.filter((m) => m.kind === "video");
  const posterFor = (v: Media) => media.find((m) => m.kind === "video_thumb" && m.source_msg_key === v.source_msg_key)?.public_url;
  const shown = media.filter((m) => !(m.kind === "video_thumb" && videos.some((v) => v.source_msg_key === m.source_msg_key)));
  if (!shown.length) return null;

  return (
    <div style={{ display: "grid", gridTemplateColumns: shown.length > 1 ? "1fr 1fr" : "1fr", gap: 6, marginTop: 8 }}>
      {shown.map((m) =>
        m.kind === "video" ? (
          <video
            key={m.id}
            src={m.public_url}
            poster={posterFor(m)}
            controls
            preload="metadata"
            playsInline
            style={{ width: "100%", borderRadius: 6, background: "#000", gridColumn: "1 / -1" }}
          />
        ) : (
          <a key={m.id} href={m.public_url} target="_blank" rel="noopener noreferrer" style={{ position: "relative", display: "block" }}>
            <img
              src={m.public_url}
              alt=""
              loading="lazy"
              width={m.width ?? undefined}
              height={m.height ?? undefined}
              style={{ width: "100%", height: "auto", borderRadius: 6, display: "block" }}
            />
            {m.kind === "video_thumb" && (
              <span style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", color: "#fff", fontSize: 28, textShadow: "0 1px 4px #000" }}>▶</span>
            )}
          </a>
        )
      )}
    </div>
  );
}
