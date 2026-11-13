-- Analysts and managers can remove a photo / video from an event (fix, Dani).
-- The row stays, hidden (ready = false, removed_at set): its fingerprints keep the duplicate check
-- (imageHash.alreadyHas) from attaching the same picture again, and the plan's media limit only counts ready
-- rows. The file is deleted from the event-media bucket by the browser right after (staff delete policy below).
-- A video still and its on-demand video go together. Every removal is written to audit_logs.

alter table public.event_media add column if not exists removed_at timestamptz;
alter table public.event_media add column if not exists removed_by uuid;

create or replace function public.remove_event_media(p_id uuid)
returns text[] language plpgsql security definer set search_path = '' as $$
declare v_event uuid; v_paths text[];
begin
  if auth.uid() is null or not public.has_permission('event.edit.any') then
    raise exception 'You do not have permission to remove media.' using errcode = '42501';
  end if;
  select m.event_id into v_event from public.event_media m where m.id = p_id;
  if v_event is null then raise exception 'Media not found.' using errcode = 'P0002'; end if;

  with hit as (
    update public.event_media m
       set ready = false, removed_at = now(), removed_by = auth.uid()
     where m.removed_at is null
       and (m.id = p_id
            or m.thumb_id = p_id                                                        -- the video of this still
            or m.id = (select x.thumb_id from public.event_media x where x.id = p_id)  -- the still of this video
            -- a video sent with the message and its poster share the message key
            or (m.kind in ('video', 'video_thumb') and m.event_id = v_event and m.source_msg_key is not null
                and exists (select 1 from public.event_media x where x.id = p_id and x.kind in ('video', 'video_thumb')
                              and x.source_msg_key = m.source_msg_key)))
    returning m.storage_path, m.kind)
  select coalesce(array_agg(storage_path) filter (where storage_path is not null), '{}') into v_paths from hit;

  insert into public.audit_logs (user_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), 'event.media_removed', 'event', v_event, jsonb_build_object('media_id', p_id, 'files', v_paths));
  return v_paths;
end $$;
revoke all on function public.remove_event_media(uuid) from public, anon;
grant execute on function public.remove_event_media(uuid) to authenticated;

-- Staff may delete files of the event-media bucket (the browser removes the file after the call above).
drop policy if exists "event-media: staff delete" on storage.objects;
create policy "event-media: staff delete" on storage.objects for delete to authenticated
  using (bucket_id = 'event-media' and (select public.has_permission('event.edit.any')));
