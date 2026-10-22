-- ════════════════════════════════════════════════════════════════════
-- Osintfront · Migration 30 — videos on demand
-- Videos are not downloaded in bulk. A video thumbnail keeps the link to its post
-- (source_url, and which video of the post: source_index). When a reader presses
-- play, event-agent {action:"video"} fetches the video (max 50 MB) into the
-- event-media bucket and the event shows it from there. Oldest videos are deleted
-- first (FIFO) when storage passes 90%.
-- video_state on the thumbnail: null (not tried) / loading / ready / too_big / unavailable.
-- ════════════════════════════════════════════════════════════════════
alter table public.event_media add column if not exists source_url text;
alter table public.event_media add column if not exists source_index integer;
alter table public.event_media add column if not exists video_state text
  check (video_state in ('loading', 'ready', 'too_big', 'unavailable'));
alter table public.event_media add column if not exists video_state_at timestamptz;
alter table public.event_media add column if not exists video_bytes bigint;
-- The on-demand video row points at its thumbnail.
alter table public.event_media add column if not exists thumb_id uuid references public.event_media(id) on delete set null;
create index if not exists event_media_thumb_idx on public.event_media (thumb_id) where thumb_id is not null;

-- Public posts already stored: their post link comes from the message key ("channel/123").
update public.event_media
   set source_url = 'https://t.me/' || source_msg_key
 where source_url is null and source_msg_key ~ '^[A-Za-z][A-Za-z0-9_]{3,}/[0-9]+$';

-- ── Moving one of an event's extra places (a report with several pins) ──────────
-- p_index = position in events.locations. The place name is learned for next time.
create or replace function public.move_event_place(p_id uuid, p_index integer, p_lat double precision, p_lng double precision)
returns void language plpgsql security definer set search_path = '' as $$
declare v_locs jsonb; v_item jsonb; v_key text; v_country text; v_name text;
begin
  if auth.uid() is null or not (public.has_permission('event.edit.any') or public.has_permission('event.edit.own')) then
    raise exception 'You do not have permission to move events.' using errcode = '42501';
  end if;
  if p_lat is null or p_lng is null or p_lat not between -90 and 90 or p_lng not between -180 and 180 then
    raise exception 'Bad coordinates.' using errcode = '22023';
  end if;
  select locations, country into v_locs, v_country from public.events where id = p_id and deleted_at is null;
  if not found then raise exception 'Event not found.' using errcode = 'P0002'; end if;
  if jsonb_typeof(v_locs) <> 'array' or p_index < 0 or p_index >= jsonb_array_length(v_locs) then
    raise exception 'Place not found.' using errcode = 'P0002';
  end if;
  v_item := (v_locs -> p_index) || jsonb_build_object('lat', p_lat, 'lng', p_lng, 'precision', 'exact', 'manual', true);
  update public.events set locations = jsonb_set(v_locs, array[p_index::text], v_item) where id = p_id;

  v_name := coalesce(nullif(v_item ->> 'name', ''), v_item ->> 'name_en');
  foreach v_key in array array[v_item ->> 'name', v_item ->> 'name_en'] loop
    continue when v_key is null or btrim(v_key) = '' or not public.is_specific_place(v_key);
    insert into public.learned_places as lp (name_norm, name, location_name, country, latitude, longitude, learned_from, learned_by)
    values (public.normalize_place(v_key), left(v_key, 200), left(coalesce(v_name, ''), 200), left(coalesce(v_country, ''), 100),
            p_lat, p_lng, p_id, auth.uid())
    on conflict (name_norm) do update
      set latitude = excluded.latitude, longitude = excluded.longitude, location_name = excluded.location_name,
          country = excluded.country, times_corrected = lp.times_corrected + 1, learned_from = excluded.learned_from,
          learned_by = excluded.learned_by, updated_at = now();
  end loop;
end;
$$;
revoke execute on function public.move_event_place(uuid, integer, double precision, double precision) from public, anon;
grant execute on function public.move_event_place(uuid, integer, double precision, double precision) to authenticated;
