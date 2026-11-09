-- ════════════════════════════════════════════════════════════════════
-- Osintfront · Migration 99 — terrain geolocation (Max / Intel)
-- A local worker (geoloc-worker/, runs on the owner's computer) takes queued
-- jobs, matches the photo's skyline to elevation data and writes back the
-- camera point, the target point and a proof board.
--  • Feature 'geolocation': Max and Intel only (staff always). Enforced even
--    when enforce_plans is off — it's a paid-only tool by decision.
--  • Jobs are queued automatically for new photos / video thumbnails of events
--    that have a place (app_settings.geoloc_auto), or by hand by a Max user.
--  • Camera positions are where a person stood filming. They stay hidden from
--    subscribers until staff release them; the target point is shown at once.
-- ════════════════════════════════════════════════════════════════════

insert into public.plan_features (feature_key, plan_id, enabled, limit_value, note) values
  ('geolocation', 'guest', false, null, 'terrain geolocation of event media'),
  ('geolocation', 'free',  false, null, 'terrain geolocation of event media'),
  ('geolocation', 'pro',   false, null, 'terrain geolocation of event media'),
  ('geolocation', 'max',   true,  20,   'terrain geolocation; limit = manual requests per day'),
  ('geolocation', 'intel', true,  50,   'terrain geolocation; limit = manual requests per day')
on conflict (feature_key, plan_id) do update
  set enabled = excluded.enabled, limit_value = excluded.limit_value, note = excluded.note;

insert into public.app_settings (key, value) values ('geoloc_auto', 'true'::jsonb)
on conflict (key) do nothing;

create table if not exists public.geoloc_jobs (
  id               uuid primary key default gen_random_uuid(),
  event_id         uuid not null references public.events (id) on delete cascade,
  media_id         uuid references public.event_media (id) on delete set null,
  status           text not null default 'queued'
                   check (status in ('queued', 'running', 'done', 'needs_review', 'failed', 'skipped')),
  trigger          text not null default 'auto' check (trigger in ('auto', 'manual')),
  requested_by     uuid references public.profiles (id) on delete set null,
  attempts         smallint not null default 0,
  worker           text,
  claimed_at       timestamptz,
  finished_at      timestamptz,
  created_at       timestamptz not null default now(),
  error            text check (char_length(error) <= 2000),
  -- results
  target_lat       double precision check (target_lat between -90 and 90),
  target_lng       double precision check (target_lng between -180 and 180),
  target_label     text check (char_length(target_label) <= 300),
  camera_lat       double precision check (camera_lat between -90 and 90),
  camera_lng       double precision check (camera_lng between -180 and 180),
  camera_heading   double precision,
  hfov             double precision,
  fit_rms_px       double precision,
  holdout_rms_px   double precision,
  confidence       text check (confidence in ('high', 'medium', 'low')),
  result           jsonb not null default '{}'::jsonb,   -- solver details, notes, model used
  proof_target     text,   -- storage path in geoloc-proofs: board without the camera
  proof_full       text,   -- storage path: full board with the camera
  camera_released  boolean not null default false,
  released_by      uuid references public.profiles (id) on delete set null,
  released_at      timestamptz
);
create unique index if not exists geoloc_jobs_event_media_uq on public.geoloc_jobs (event_id, media_id) where media_id is not null;
create index if not exists geoloc_jobs_queue_idx on public.geoloc_jobs (created_at) where status in ('queued', 'running');
create index if not exists geoloc_jobs_event_idx on public.geoloc_jobs (event_id);

alter table public.geoloc_jobs enable row level security;
-- No direct table access for anyone but staff; subscribers go through the functions below.
drop policy if exists geoloc_jobs_staff_read on public.geoloc_jobs;
create policy geoloc_jobs_staff_read on public.geoloc_jobs for select to authenticated
  using ((select public.has_permission('event.edit.any')));
revoke all on public.geoloc_jobs from anon;

-- ── who may use it ──────────────────────────────────────────────────
create or replace function public.can_geolocate()
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((
    select case
      when pr.role <> 'viewer' then true
      else coalesce((select f.enabled from public.plan_features f
                      where f.feature_key = 'geolocation'
                        and f.plan_id = case when pr.plan <> 'free' and pr.plan_expires_at is not null
                                                  and pr.plan_expires_at < now() then 'free' else pr.plan end), false)
    end
    from public.profiles pr where pr.id = auth.uid()), false);
$$;
revoke all on function public.can_geolocate() from public;
grant execute on function public.can_geolocate() to anon, authenticated;

-- ── auto-queue new photos / video thumbnails of placed events ───────
create or replace function public.geoloc_enqueue_media()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.kind not in ('image', 'video_thumb') then return new; end if;
  if not coalesce((select s.value = 'true'::jsonb from public.app_settings s where s.key = 'geoloc_auto'), false) then
    return new;
  end if;
  if not exists (select 1 from public.events e where e.id = new.event_id and e.deleted_at is null
                   and (e.latitude is not null or (jsonb_typeof(e.locations) = 'array' and jsonb_array_length(e.locations) > 0))) then
    return new;
  end if;
  insert into public.geoloc_jobs (event_id, media_id, trigger) values (new.event_id, new.id, 'auto')
  on conflict do nothing;
  return new;
end $$;
drop trigger if exists event_media_geoloc_enqueue on public.event_media;
create trigger event_media_geoloc_enqueue after insert on public.event_media
  for each row execute function public.geoloc_enqueue_media();

-- ── manual request by a Max user (or staff) ─────────────────────────
create or replace function public.request_geolocation(p_event uuid, p_media uuid default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_limit int; v_used int; pr public.profiles%rowtype;
begin
  if not public.can_geolocate() then
    raise exception 'plan: geolocation is available on the Max plan' using errcode = '42501';
  end if;
  select * into pr from public.profiles where id = auth.uid();
  if not exists (select 1 from public.events where id = p_event and deleted_at is null) then
    raise exception 'Event not found.' using errcode = 'P0002';
  end if;
  if p_media is null then
    select m.id into p_media from public.event_media m
     where m.event_id = p_event and m.kind in ('image', 'video_thumb') order by m.created_at limit 1;
  elsif not exists (select 1 from public.event_media where id = p_media and event_id = p_event) then
    raise exception 'Media not found on this event.' using errcode = 'P0002';
  end if;
  if p_media is null then
    raise exception 'This event has no photo or video to geolocate.' using errcode = '22023';
  end if;
  -- Already done or in progress → return that job instead of a new one.
  select id into v_id from public.geoloc_jobs where event_id = p_event and media_id = p_media
   order by created_at desc limit 1;
  if v_id is not null then
    update public.geoloc_jobs set status = 'queued', trigger = 'manual', requested_by = auth.uid(), attempts = 0, error = null
     where id = v_id and status in ('failed', 'skipped');
    return v_id;
  end if;
  if pr.role = 'viewer' then
    select f.limit_value into v_limit from public.plan_features f where f.feature_key = 'geolocation' and f.plan_id = pr.plan;
    select count(*) into v_used from public.geoloc_jobs
     where requested_by = auth.uid() and trigger = 'manual' and created_at > now() - interval '1 day';
    if v_limit is not null and v_used >= v_limit then
      raise exception 'plan: daily geolocation limit reached' using errcode = '42501';
    end if;
  end if;
  insert into public.geoloc_jobs (event_id, media_id, trigger, requested_by)
  values (p_event, p_media, 'manual', auth.uid()) returning id into v_id;
  return v_id;
end $$;
revoke all on function public.request_geolocation(uuid, uuid) from public, anon;
grant execute on function public.request_geolocation(uuid, uuid) to authenticated;

-- ── results for the event page ──────────────────────────────────────
create or replace function public.geoloc_for_event(p_event uuid)
returns table (id uuid, status text, confidence text, target_lat double precision, target_lng double precision,
               target_label text, camera_lat double precision, camera_lng double precision,
               camera_heading double precision, hfov double precision, fit_rms_px double precision,
               holdout_rms_px double precision, notes jsonb, proof_target text, proof_full text,
               camera_released boolean, finished_at timestamptz)
language sql stable security definer set search_path = '' as $$
  with me as (select public.can_geolocate() as ok, public.has_permission('event.edit.any') as staff)
  select j.id, j.status, j.confidence, j.target_lat, j.target_lng, j.target_label,
         case when me.staff or j.camera_released then j.camera_lat end,
         case when me.staff or j.camera_released then j.camera_lng end,
         case when me.staff or j.camera_released then j.camera_heading end,
         j.hfov, j.fit_rms_px, j.holdout_rms_px, coalesce(j.result -> 'notes', '[]'::jsonb),
         j.proof_target,
         case when me.staff or j.camera_released then j.proof_full end,
         j.camera_released, j.finished_at
  from public.geoloc_jobs j, me
  where j.event_id = p_event and me.ok
    -- subscribers see finished, reasonably confident results; staff see everything
    and (me.staff or (j.status = 'done' and j.confidence in ('high', 'medium')))
  order by j.finished_at desc nulls last, j.created_at desc;
$$;
revoke all on function public.geoloc_for_event(uuid) from public, anon;
grant execute on function public.geoloc_for_event(uuid) to authenticated;

-- ── staff: release a camera position / approve a reviewed result ────
create or replace function public.geoloc_review(p_id uuid, p_release_camera boolean default null, p_status text default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.has_permission('event.edit.any') then
    raise exception 'You do not have permission.' using errcode = '42501';
  end if;
  if p_status is not null and p_status not in ('done', 'needs_review', 'failed', 'skipped', 'queued') then
    raise exception 'Bad status.' using errcode = '22023';
  end if;
  update public.geoloc_jobs
     set camera_released = coalesce(p_release_camera, camera_released),
         released_by = case when p_release_camera then auth.uid() else released_by end,
         released_at = case when p_release_camera then now() else released_at end,
         status = coalesce(p_status, status),
         attempts = case when p_status = 'queued' then 0 else attempts end
   where id = p_id;
  if not found then raise exception 'Job not found.' using errcode = 'P0002'; end if;
end $$;
revoke all on function public.geoloc_review(uuid, boolean, text) from public, anon;
grant execute on function public.geoloc_review(uuid, boolean, text) to authenticated;

-- ── worker side (service role only) ─────────────────────────────────
create or replace function public.geoloc_claim(p_worker text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare j public.geoloc_jobs%rowtype; e public.events%rowtype; v_media jsonb; v_video jsonb;
begin
  select * into j from public.geoloc_jobs
   where (status = 'queued' or (status = 'running' and claimed_at < now() - interval '45 minutes'))
     and attempts < 3
   order by (trigger = 'manual') desc, created_at
   limit 1 for update skip locked;
  if not found then return null; end if;
  update public.geoloc_jobs set status = 'running', worker = left(p_worker, 100), claimed_at = now(), attempts = attempts + 1
   where id = j.id;
  select * into e from public.events where id = j.event_id;
  select to_jsonb(m) - 'phash' - 'sha256' into v_media from public.event_media m where m.id = j.media_id;
  select to_jsonb(m) into v_video from public.event_media m
   where m.thumb_id = j.media_id and m.kind = 'video' and m.ready limit 1;
  return jsonb_build_object(
    'job_id', j.id, 'trigger', j.trigger, 'attempt', j.attempts + 1,
    'event', jsonb_build_object('id', e.id, 'title', e.title, 'description', e.description,
                                'original_report_text', left(e.original_report_text, 3000),
                                'latitude', e.latitude, 'longitude', e.longitude, 'location_name', e.location_name,
                                'city', e.city, 'region', e.region, 'country', e.country,
                                'locations', e.locations, 'occurred_at', e.occurred_at),
    'media', v_media, 'video', v_video);
end $$;
revoke all on function public.geoloc_claim(text) from public, anon, authenticated;
grant execute on function public.geoloc_claim(text) to service_role;

create or replace function public.geoloc_finish(p_id uuid, p_status text, p_result jsonb)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_status not in ('done', 'needs_review', 'failed', 'skipped', 'queued') then
    raise exception 'bad status';
  end if;
  update public.geoloc_jobs set
    status = p_status,
    finished_at = case when p_status = 'queued' then null else now() end,
    error = left(p_result ->> 'error', 2000),
    target_lat = (p_result ->> 'target_lat')::double precision,
    target_lng = (p_result ->> 'target_lng')::double precision,
    target_label = left(p_result ->> 'target_label', 300),
    camera_lat = (p_result ->> 'camera_lat')::double precision,
    camera_lng = (p_result ->> 'camera_lng')::double precision,
    camera_heading = (p_result ->> 'camera_heading')::double precision,
    hfov = (p_result ->> 'hfov')::double precision,
    fit_rms_px = (p_result ->> 'fit_rms_px')::double precision,
    holdout_rms_px = (p_result ->> 'holdout_rms_px')::double precision,
    confidence = p_result ->> 'confidence',
    proof_target = p_result ->> 'proof_target',
    proof_full = p_result ->> 'proof_full',
    result = coalesce(p_result -> 'details', '{}'::jsonb)
  where id = p_id;
end $$;
revoke all on function public.geoloc_finish(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.geoloc_finish(uuid, text, jsonb) to service_role;

-- ── proof boards: private bucket, read through policy ───────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('geoloc-proofs', 'geoloc-proofs', false, 8388608, array['image/png'])
on conflict (id) do nothing;

create or replace function public.geoloc_proof_allowed(p_name text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.geoloc_jobs j
     where (j.proof_target = p_name and public.can_geolocate()
            and (public.has_permission('event.edit.any') or (j.status = 'done' and j.confidence in ('high', 'medium'))))
        or (j.proof_full = p_name and (public.has_permission('event.edit.any')
            or (j.camera_released and public.can_geolocate()))));
$$;
revoke all on function public.geoloc_proof_allowed(text) from public, anon;
grant execute on function public.geoloc_proof_allowed(text) to authenticated;

drop policy if exists geoloc_proofs_read on storage.objects;
create policy geoloc_proofs_read on storage.objects for select to authenticated
  using (bucket_id = 'geoloc-proofs' and (select public.geoloc_proof_allowed(name)));
