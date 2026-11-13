-- Osintfront · Migration 128 — media translation: why video speech was not read, and a retry cap.
-- media_jobs.speech_note: the last run's reason(s), at most 300 characters, never speech text;
--   shown to staff only through media_translation().
-- media_translation(): returns speech_note (staff) and counts a video whose speech is 'off' as new
--   media only while its saved route-failure count (speech.tries) is under 2 (owner's decision:
--   one more paid try after a failure, then no more).
-- Spec: docs/superpowers/specs/2026-11-14-media-overlay-design.md

alter table public.media_jobs add column if not exists speech_note text;

create or replace function public.media_translation(p_event uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid(); v_staff boolean; v_used int := 0; v_budget numeric; v_left boolean;
  v_audio boolean; v_items jsonb; v_todo int; v_job record;
begin
  if not public.my_feature('media_translate') then return null; end if;
  if not exists (select 1 from public.events e where e.id = p_event and e.status in ('published', 'archived') and e.deleted_at is null) then
    return null;
  end if;
  select (p.status = 'active' and p.role <> 'viewer') into v_staff from public.profiles p where p.id = v_uid;
  v_staff := coalesce(v_staff, false);
  if v_uid is not null then
    select coalesce(sum(count), 0) into v_used from public.feature_usage
    where user_id = v_uid and feature_key = 'media_translate' and day = (now() at time zone 'Asia/Jerusalem')::date;
  end if;
  select coalesce((select value = 'true'::jsonb from public.app_settings where key = 'media_audio_enabled'), false) into v_audio;
  select nullif(value::text, 'null')::numeric into v_budget from public.app_settings where key = 'media_daily_budget_usd';
  v_left := v_staff or v_budget is null
    or public.media_spent_today() + ((public.media_in_flight()->>'readers')::int * 0.1) < v_budget;

  select coalesce(jsonb_agg(jsonb_build_object(
           'media_id', i.media_id, 'kind', r.kind, 'thumb', i.thumb,
           'description_he', r.description_he, 'description_en', r.description_en,
           'texts', r.texts, 'speech', r.speech) order by i.created_at, i.media_id), '[]'::jsonb)
    into v_items
  from public.media_items(p_event) i
  join public.media_readings r on r.media_id = i.media_id;

  select count(*) into v_todo
  from public.media_items(p_event) i
  left join public.media_readings r on r.media_id = i.media_id
  where r.media_id is null
     or (v_audio and r.kind = 'video' and r.speech->>'state' = 'off'
         and (case when r.speech->>'tries' ~ '^[0-9]+$' then (r.speech->>'tries')::int else 0 end) < 2);

  select busy_until, retry_after, speech_note into v_job from public.media_jobs where event_id = p_event;
  return jsonb_build_object(
    'items', v_items,
    'todo', v_todo,
    'working', coalesce(v_job.busy_until > now(), false),
    'failed', coalesce(v_job.retry_after > now(), false),
    'staff', v_staff,
    'used', v_used,
    'limit', case when v_staff then null else public.my_feature_limit('media_translate') end,
    'budget_left', v_left,
    'speech_note', case when v_staff then v_job.speech_note end);
end $$;
revoke all on function public.media_translation(uuid) from public;
grant execute on function public.media_translation(uuid) to anon, authenticated;
