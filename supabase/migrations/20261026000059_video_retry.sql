-- ════════════════════════════════════════════════════════════════════
-- Osintfront · Migration 59 — video on demand: retry instead of "unavailable" forever
-- One failed fetch (Telegram busy, a blocked request) used to mark a video
-- "unavailable" for good. Now play tries again: after 2 min, then after 15 min;
-- only the third failure is final. The reason of the last failure is kept.
-- ════════════════════════════════════════════════════════════════════
alter table public.event_media add column if not exists video_tries smallint not null default 0;
alter table public.event_media add column if not exists video_why text;

-- Videos already marked unavailable get their retries back.
update public.event_media set video_tries = 1
 where kind = 'video_thumb' and video_state = 'unavailable';
