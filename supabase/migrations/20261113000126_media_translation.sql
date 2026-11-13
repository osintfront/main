-- Osintfront · Migration 126 — media translation ("Translate image/video" after Expand).
-- media_readings: one saved reading per media item (picture / video) — description, foreign text with
--   translations, translated speech. Read by every reader whose plan has the feature, through
--   media_translation() only.
-- media_jobs: one row per event being read — the 4-minute worker lease, the last failure, spend.
-- Settings: media_daily_budget_usd (readers only; staff outside it) and media_audio_enabled (speech
--   through Gemini, off until the speech route is live).
-- Plan key media_translate: Pro 3, Max 10, Intel 10 a day; guest and free off.
-- Foreign keys are in migration 127 (run by hand); this file works without them.
-- Spec: docs/superpowers/specs/2026-11-13-media-translation-design.md

create table if not exists public.media_readings (
  media_id       uuid primary key,
  event_id       uuid not null,
  kind           text not null check (kind in ('image', 'video')),
  description_he text not null default '',
  description_en text not null default '',
  texts          jsonb not null default '[]',
  speech         jsonb,
  model          text,
  version        int not null default 1,
  created_by     uuid,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists media_readings_event on public.media_readings (event_id);

create table if not exists public.media_jobs (
  event_id    uuid primary key,
  busy_until  timestamptz,
  busy_token  uuid,
  started_by  uuid,
  staff       boolean not null default false,
  fail_reason text check (fail_reason in ('failed')),
  retry_after timestamptz,
  cost_usd    numeric(12, 6) not null default 0,
  runs        int not null default 0
);

alter table public.media_readings enable row level security;
alter table public.media_jobs enable row level security;
revoke all on public.media_readings, public.media_jobs from anon, authenticated;

insert into public.app_settings (key, value) values
  ('media_daily_budget_usd', '3'::jsonb),
  ('media_audio_enabled', 'false'::jsonb)
on conflict (key) do nothing;

insert into public.plan_features (feature_key, plan_id, enabled, limit_value, note) values
  ('media_translate', 'guest', false, 0,  'media translation: runs per day'),
  ('media_translate', 'free',  false, 0,  'media translation: runs per day'),
  ('media_translate', 'pro',   true,  3,  'media translation: runs per day'),
  ('media_translate', 'max',   true,  10, 'media translation: runs per day'),
  ('media_translate', 'intel', true,  10, 'media translation: runs per day')
on conflict (feature_key, plan_id) do update
  set enabled = excluded.enabled, limit_value = excluded.limit_value, note = excluded.note;

-- ── Service-role helpers (event-agent) ─────────────────────────────────────────────

/** The event's media items, in order: pictures, video stills (as videos), and lone videos with no still. */
create or replace function public.media_items(p_event uuid)
returns table (media_id uuid, kind text, thumb text, created_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select m.id,
         case when m.kind = 'image' then 'image' else 'video' end,
         case when m.kind in ('image', 'video_thumb') then m.public_url else null end,
         m.created_at
  from public.event_media m
  where m.event_id = p_event and m.ready
    and (m.kind in ('image', 'video_thumb')
         or (m.kind = 'video' and m.thumb_id is null
             and not exists (select 1 from public.event_media t
                             where t.event_id = p_event and t.kind = 'video_thumb' and t.ready
                               and m.source_msg_key is not null and t.source_msg_key = m.source_msg_key)))
  order by m.created_at, m.id;
$$;

/** May this user translate media? { enabled, staff, limit }. Staff = active non-viewer. */
create or replace function public.media_allowed(p_uid uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare pr record; v_plan text; f record;
begin
  select id, role, status, plan, plan_expires_at into pr from public.profiles where id = p_uid;
  if pr.id is not null and pr.status = 'active' and pr.role <> 'viewer' then
    return jsonb_build_object('enabled', true, 'staff', true, 'limit', null);
  end if;
  if not public.plans_enforced() then return jsonb_build_object('enabled', true, 'staff', false, 'limit', null); end if;
  v_plan := case
    when pr.id is null or pr.status <> 'active' then 'guest'
    when pr.plan <> 'free' and pr.plan_expires_at is not null and pr.plan_expires_at < now() then 'free'
    else pr.plan::text end;
  select enabled, limit_value into f from public.plan_features where feature_key = 'media_translate' and plan_id = v_plan;
  return jsonb_build_object('enabled', coalesce(f.enabled, false), 'staff', false, 'limit', f.limit_value);
end $$;

/** Take the 4-minute worker lease for an event. Returns the token, or null while someone else holds it. */
create or replace function public.media_claim(p_event uuid, p_uid uuid, p_staff boolean)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_token uuid := gen_random_uuid(); v_got uuid;
begin
  insert into public.media_jobs (event_id, busy_until, busy_token, started_by, staff, runs)
  values (p_event, now() + interval '4 minutes', v_token, p_uid, coalesce(p_staff, false), 1)
  on conflict (event_id) do update
    set busy_until = now() + interval '4 minutes', busy_token = excluded.busy_token, started_by = excluded.started_by,
        staff = excluded.staff, fail_reason = null, retry_after = null, runs = public.media_jobs.runs + 1
    where coalesce(public.media_jobs.busy_until, '-infinity') < now()
  returning busy_token into v_got;
  return v_got;
end $$;

/** End our lease (only while the token is ours). 'failed' → no new run for 10 minutes. */
create or replace function public.media_done(p_event uuid, p_token uuid, p_fail text, p_cost numeric)
returns boolean language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  update public.media_jobs
     set busy_until = null, busy_token = null, fail_reason = p_fail,
         retry_after = case when p_fail = 'failed' then now() + interval '10 minutes' else null end,
         cost_usd = cost_usd + coalesce(p_cost, 0)
   where event_id = p_event and busy_token = p_token;
  get diagnostics n = row_count;
  return n > 0;
end $$;

/** Today's (Israel day) readers' spend on media translation; staff spend is logged apart. */
create or replace function public.media_spent_today()
returns numeric language sql stable security definer set search_path = '' as $$
  select coalesce(sum(cost_usd), 0) from public.ai_usage
  where purpose = 'media_translate'
    and at >= ((now() at time zone 'Asia/Jerusalem')::date)::timestamp at time zone 'Asia/Jerusalem';
$$;

/** Runs in progress: { all, readers }. */
create or replace function public.media_in_flight()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('all', count(*), 'readers', count(*) filter (where not staff))
  from public.media_jobs where busy_until > now();
$$;

revoke all on function public.media_items(uuid), public.media_allowed(uuid), public.media_claim(uuid, uuid, boolean),
  public.media_done(uuid, uuid, text, numeric), public.media_spent_today(), public.media_in_flight() from public, anon, authenticated;

-- ── The browser's only read ─────────────────────────────────────────────────────────

/** The saved translation of an event's media, for readers whose plan has the feature; else null. */
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
  where r.media_id is null or (v_audio and r.kind = 'video' and r.speech->>'state' = 'off');

  select busy_until, retry_after into v_job from public.media_jobs where event_id = p_event;
  return jsonb_build_object(
    'items', v_items,
    'todo', v_todo,
    'working', coalesce(v_job.busy_until > now(), false),
    'failed', coalesce(v_job.retry_after > now(), false),
    'staff', v_staff,
    'used', v_used,
    'limit', case when v_staff then null else public.my_feature_limit('media_translate') end,
    'budget_left', v_left);
end $$;
revoke all on function public.media_translation(uuid) from public;
grant execute on function public.media_translation(uuid) to anon, authenticated;
