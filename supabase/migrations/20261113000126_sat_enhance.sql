-- ════════════════════════════════════════════════════════════════════
-- Osintfront · Migration 126 — satellite super-resolution ("Enhance ×4")
-- A local worker (satsr-worker/, runs on the owner's computer) takes queued
-- jobs, reads a 2.56 km Sentinel-2 box (B04,B03,B02,B08 at 10 m), upscales it
-- ×4 to 2.5 m (SEN2SR) and uploads before/after PNGs per product (true colour,
-- infrared, NDVI) to the private bucket satsr-results.
--  • Feature 'sat_enhance': new enhancements per Israel day. Pro 3, Max / Intel
--    15, staff unlimited. Enforced even when enforce_plans is off (like
--    can_geolocate()): it costs real compute.
--  • Results are shared: the cache key is (engine, 0.005° cell, scene date).
--    Only the request that creates a job is charged; cache hits are free.
--  • Quota is counted from rows: charged requests today whose job is not
--    'failed' — a failed job gives the use back by itself.
--  • The browser only talks to RPCs; the worker uses the service role.
-- ════════════════════════════════════════════════════════════════════

insert into public.plan_features (feature_key, plan_id, enabled, limit_value, note) values
  ('sat_enhance', 'guest', false, 0,  'satellite super-resolution: new enhancements per day'),
  ('sat_enhance', 'free',  false, 0,  'satellite super-resolution: new enhancements per day'),
  ('sat_enhance', 'pro',   true,  3,  'satellite super-resolution: new enhancements per day'),
  ('sat_enhance', 'max',   true,  15, 'satellite super-resolution: new enhancements per day'),
  ('sat_enhance', 'intel', true,  15, 'satellite super-resolution: new enhancements per day')
on conflict (feature_key, plan_id) do update
  set enabled = excluded.enabled, limit_value = excluded.limit_value, note = excluded.note;

insert into public.app_settings (key, value) values
  ('satsr_engine', '"sen2sr_lite_rgbn_x4"'::jsonb),
  ('satsr_engines', '["sen2sr_lite_rgbn_x4", "bicubic_x4"]'::jsonb),
  ('satsr_max_queue', '40'::jsonb),
  ('satsr_retention_days', '60'::jsonb)
on conflict (key) do nothing;

-- ── tables ──────────────────────────────────────────────────────────
create table if not exists public.satsr_jobs (
  id             uuid primary key default gen_random_uuid(),
  engine         text not null check (char_length(engine) <= 60),
  -- the 0.005° cell: centre = (cell_y / 200.0 lat, cell_x / 200.0 lng)
  cell_x         int not null check (cell_x between -36000 and 36000),
  cell_y         int not null check (cell_y between -12000 and 12000),
  requested_date date,                    -- null = newest clear picture
  scene_date     date,                    -- the picture's UTC day (set by the worker)
  scene_id       text check (char_length(scene_id) <= 200),
  status         text not null default 'queued' check (status in ('queued', 'running', 'done', 'failed')),
  error_code     text check (error_code in ('no_scene', 'source_error', 'engine_error', 'timeout', 'expired')),
  error          text check (char_length(error) <= 2000),
  attempts       smallint not null default 0,
  worker         text,
  claimed_at     timestamptz,
  finished_at    timestamptz,
  created_at     timestamptz not null default now(),
  created_by     uuid references public.profiles (id) on delete set null,
  -- result: EPSG:3857-aligned bounds of the PNGs (degrees), size in px
  south          double precision, west double precision, north double precision, east double precision,
  width          int, height int,
  -- {"tci": {"sr": "<job>/tci_sr.png", "lr": "<job>/tci_lr.png"}, "irp": {…}, "ndvi": {…}}
  products       jsonb,
  cloud_pct      real,
  meta           jsonb not null default '{}'::jsonb
);
create unique index if not exists satsr_jobs_done_uq on public.satsr_jobs (engine, cell_x, cell_y, scene_date) where status = 'done';
create unique index if not exists satsr_jobs_open_uq on public.satsr_jobs (engine, cell_x, cell_y, coalesce(requested_date, date '0001-01-01'))
  where status in ('queued', 'running');
create index if not exists satsr_jobs_queue_idx on public.satsr_jobs (created_at) where status in ('queued', 'running');
create index if not exists satsr_jobs_cell_idx on public.satsr_jobs (engine, cell_x, cell_y);

create table if not exists public.satsr_requests (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles (id) on delete cascade,
  job_id     uuid not null references public.satsr_jobs (id) on delete cascade,
  lat        double precision not null,
  lng        double precision not null,
  charged    boolean not null,
  created_at timestamptz not null default now(),
  unique (user_id, job_id)
);
create index if not exists satsr_requests_user_idx on public.satsr_requests (user_id, created_at desc);
create index if not exists satsr_requests_job_idx on public.satsr_requests (job_id);

create table if not exists public.satsr_workers (
  worker    text primary key,
  last_seen timestamptz not null default now(),
  info      jsonb not null default '{}'::jsonb
);

-- ── helpers ─────────────────────────────────────────────────────────
/** Active staff (any role but viewer) — never limited, see every job. */
create or replace function public.satsr_is_staff()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles pr
                  where pr.id = auth.uid() and pr.status = 'active' and pr.role <> 'viewer');
$$;

/** Did the caller request this job (charged or as a cache hit)? */
create or replace function public.satsr_job_mine(p_job uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.satsr_requests r where r.job_id = p_job and r.user_id = auth.uid());
$$;

/** Charged requests today (Israel day) whose job did not fail. */
create or replace function public.satsr_used(p_uid uuid)
returns int language sql stable security definer set search_path = '' as $$
  select count(*)::int
    from public.satsr_requests r
    join public.satsr_jobs j on j.id = r.job_id
   where r.user_id = p_uid and r.charged and j.status <> 'failed'
     and r.created_at >= ((now() at time zone 'Asia/Jerusalem')::date)::timestamp at time zone 'Asia/Jerusalem';
$$;

create or replace function public.satsr_worker_online()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.satsr_workers w where w.last_seen > now() - interval '3 minutes');
$$;

/** p_from turned out to be the same picture as p_into: move its requesters over (free), drop p_from. */
create or replace function public.satsr_merge(p_from uuid, p_into uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.satsr_requests r set job_id = p_into, charged = false
   where r.job_id = p_from
     and not exists (select 1 from public.satsr_requests r2 where r2.job_id = p_into and r2.user_id = r.user_id);
  delete from public.satsr_jobs where id = p_from;   -- cascades the requests that were already on p_into
end $$;

/** Every storage path named in a products object. */
create or replace function public.satsr_product_paths(p_products jsonb)
returns setof text language sql immutable set search_path = '' as $$
  select v.path
    from jsonb_each(case when jsonb_typeof(p_products) = 'object' then p_products else '{}'::jsonb end) e,
         lateral (select e.value ->> 'sr' as path union all select e.value ->> 'lr') v
   where jsonb_typeof(e.value) = 'object' and v.path is not null;
$$;

create or replace function public.satsr_setting(p_key text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select s.value from public.app_settings s where s.key = p_key;
$$;

-- ── RLS: read only, writes go through the functions ─────────────────
alter table public.satsr_jobs enable row level security;
alter table public.satsr_requests enable row level security;
alter table public.satsr_workers enable row level security;
revoke all on public.satsr_jobs, public.satsr_requests, public.satsr_workers from anon;
revoke insert, update, delete, truncate, references, trigger on public.satsr_jobs, public.satsr_requests, public.satsr_workers from authenticated;
grant select on public.satsr_requests, public.satsr_workers to authenticated;
-- Jobs: everything but who created it and which computer ran it (a cache hit must not reveal another user).
revoke select on public.satsr_jobs from authenticated;
grant select (id, engine, cell_x, cell_y, requested_date, scene_date, scene_id, status, error_code, error, attempts,
              claimed_at, finished_at, created_at, south, west, north, east, width, height, products, cloud_pct, meta)
  on public.satsr_jobs to authenticated;

drop policy if exists satsr_requests_read on public.satsr_requests;
create policy satsr_requests_read on public.satsr_requests for select to authenticated
  using (user_id = (select auth.uid()) or (select public.satsr_is_staff()));
drop policy if exists satsr_jobs_read on public.satsr_jobs;
create policy satsr_jobs_read on public.satsr_jobs for select to authenticated
  using ((select public.satsr_is_staff()) or public.satsr_job_mine(id));
drop policy if exists satsr_workers_read on public.satsr_workers;
create policy satsr_workers_read on public.satsr_workers for select to authenticated
  using ((select public.satsr_is_staff()));

-- ── browser: today's quota ──────────────────────────────────────────
/** {signed_in, enabled, staff, used, limit (null = unlimited), worker_online, queued}. */
create or replace function public.satsr_my_quota()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_enabled boolean; v_limit int;
begin
  if v_uid is null or not exists (select 1 from public.profiles where id = v_uid and status = 'active') then
    return jsonb_build_object('signed_in', false, 'enabled', false, 'staff', false, 'used', 0, 'limit', 0,
                              'worker_online', public.satsr_worker_online(),
                              'queued', (select count(*) from public.satsr_jobs where status = 'queued'));
  end if;
  if public.satsr_is_staff() then
    v_enabled := true; v_limit := null;
  else
    select f.enabled, f.limit_value into v_enabled, v_limit
      from public.plan_features f where f.feature_key = 'sat_enhance' and f.plan_id = public.my_plan();
    v_enabled := coalesce(v_enabled, false);
    if not v_enabled then v_limit := 0; end if;
  end if;
  return jsonb_build_object('signed_in', true, 'enabled', v_enabled, 'staff', public.satsr_is_staff(),
                            'used', public.satsr_used(v_uid), 'limit', v_limit,
                            'worker_online', public.satsr_worker_online(),
                            'queued', (select count(*) from public.satsr_jobs where status = 'queued'));
end $$;

-- ── browser: ask for an enhancement ─────────────────────────────────
/**
 * {ok, reason, request_id, job_id, status, cache_hit, used, limit, worker_online}
 * reason: signup_required | not_in_plan | quota_exceeded | busy | bad_input (same words as use_feature).
 */
create or replace function public.satsr_request(p_lat double precision, p_lng double precision,
                                                p_date date default null, p_engine text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_staff boolean;
  v_enabled boolean;
  v_limit int;
  v_used int := 0;
  v_engine text;
  v_cx int; v_cy int;
  v_job public.satsr_jobs%rowtype;
  v_req uuid;
  v_charged boolean;
  v_max int;
  v_try int := 0;
  v_today date := (now() at time zone 'Asia/Jerusalem')::date;
begin
  if v_uid is null or not exists (select 1 from public.profiles where id = v_uid and status = 'active') then
    return jsonb_build_object('ok', false, 'reason', 'signup_required', 'used', 0, 'limit', 0);
  end if;
  v_staff := public.satsr_is_staff();
  if not v_staff then
    select f.enabled, f.limit_value into v_enabled, v_limit
      from public.plan_features f where f.feature_key = 'sat_enhance' and f.plan_id = public.my_plan();
    if not coalesce(v_enabled, false) then
      return jsonb_build_object('ok', false, 'reason', 'not_in_plan', 'used', 0, 'limit', 0);
    end if;
  end if;

  if p_lat is null or p_lng is null or not (p_lat between -60 and 60) or not (p_lng between -180 and 180)
     or (p_date is not null and (p_date < date '2017-04-01' or p_date > v_today)) then
    return jsonb_build_object('ok', false, 'reason', 'bad_input', 'used', 0, 'limit', v_limit);
  end if;

  v_engine := coalesce(public.satsr_setting('satsr_engine') #>> '{}', 'sen2sr_lite_rgbn_x4');
  if v_staff and p_engine is not null
     and exists (select 1 from jsonb_array_elements_text(coalesce(public.satsr_setting('satsr_engines'), '[]'::jsonb)) e where e = p_engine) then
    v_engine := p_engine;
  end if;
  v_cy := floor(p_lat * 200 + 0.5)::int;
  v_cx := floor(p_lng * 200 + 0.5)::int;

  -- One request at a time per user: two quick clicks can't spend twice.
  perform pg_advisory_xact_lock(hashtextextended('satsr:' || v_uid::text, 0));

  loop
    v_try := v_try + 1;
    -- 1) An existing result or a job already on its way: free.
    if p_date is not null then
      select * into v_job from public.satsr_jobs j
       where j.engine = v_engine and j.cell_x = v_cx and j.cell_y = v_cy
         and j.status in ('queued', 'running', 'done')
         and (j.requested_date = p_date or j.scene_date = p_date)
       order by (j.status = 'done') desc, j.created_at desc limit 1;
    else
      select * into v_job from public.satsr_jobs j
       where j.engine = v_engine and j.cell_x = v_cx and j.cell_y = v_cy
         and ((j.status = 'done' and j.scene_date >= v_today - 5)
              or (j.status in ('queued', 'running') and j.requested_date is null))
       order by (j.status = 'done') desc, j.scene_date desc nulls last, j.created_at desc limit 1;
    end if;
    if found then
      insert into public.satsr_requests (user_id, job_id, lat, lng, charged)
      values (v_uid, v_job.id, p_lat, p_lng, false)
      on conflict (user_id, job_id) do nothing;
      select r.id, r.charged into v_req, v_charged from public.satsr_requests r where r.user_id = v_uid and r.job_id = v_job.id;
      return jsonb_build_object('ok', true, 'reason', null, 'request_id', v_req, 'job_id', v_job.id, 'status', v_job.status,
                                'cache_hit', not v_charged, 'used', public.satsr_used(v_uid), 'limit', v_limit,
                                'worker_online', public.satsr_worker_online());
    end if;

    -- 2) A new job: counts against the plan.
    if not v_staff then
      v_used := public.satsr_used(v_uid);
      if v_limit is not null and v_used >= v_limit then
        return jsonb_build_object('ok', false, 'reason', 'quota_exceeded', 'used', v_used, 'limit', v_limit);
      end if;
      v_max := coalesce((public.satsr_setting('satsr_max_queue') #>> '{}')::int, 40);
      if (select count(*) from public.satsr_jobs where status = 'queued') >= v_max then
        return jsonb_build_object('ok', false, 'reason', 'busy', 'used', v_used, 'limit', v_limit);
      end if;
    end if;
    begin
      insert into public.satsr_jobs (engine, cell_x, cell_y, requested_date, created_by)
      values (v_engine, v_cx, v_cy, p_date, v_uid) returning * into v_job;
    exception when unique_violation then
      -- Someone else queued the same cell a moment ago: use theirs.
      if v_try >= 3 then raise; end if;
      continue;
    end;
    insert into public.satsr_requests (user_id, job_id, lat, lng, charged)
    values (v_uid, v_job.id, p_lat, p_lng, true) returning id into v_req;
    return jsonb_build_object('ok', true, 'reason', null, 'request_id', v_req, 'job_id', v_job.id, 'status', v_job.status,
                              'cache_hit', false, 'used', case when v_staff then public.satsr_used(v_uid) else v_used + 1 end,
                              'limit', v_limit, 'worker_online', public.satsr_worker_online());
  end loop;
end $$;

-- ── browser: my recent enhancements ─────────────────────────────────
create or replace function public.satsr_my_jobs(p_limit int default 20)
returns table (request_id uuid, job_id uuid, status text, error_code text, engine text,
               lat double precision, lng double precision, requested_date date, scene_date date, cloud_pct real,
               south double precision, west double precision, north double precision, east double precision,
               width int, height int, products jsonb, cache_hit boolean, queue_pos int,
               created_at timestamptz, finished_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select r.id, j.id, j.status, j.error_code, j.engine, r.lat, r.lng, j.requested_date, j.scene_date, j.cloud_pct,
         j.south, j.west, j.north, j.east, j.width, j.height,
         case when j.status = 'done' then j.products end,
         not r.charged,
         case when j.status = 'queued'
              then (select count(*)::int from public.satsr_jobs q where q.status = 'queued' and q.created_at <= j.created_at)
              when j.status = 'running' then 0 end,
         r.created_at, j.finished_at
    from public.satsr_requests r
    join public.satsr_jobs j on j.id = r.job_id
   where r.user_id = auth.uid() and r.created_at > now() - interval '7 days'
   order by r.created_at desc
   limit least(greatest(coalesce(p_limit, 20), 1), 100);
$$;

-- ── worker side (service role only) ─────────────────────────────────
create or replace function public.satsr_heartbeat(p_worker text, p_info jsonb default '{}'::jsonb)
returns void language sql security definer set search_path = '' as $$
  insert into public.satsr_workers (worker, last_seen, info) values (left(p_worker, 100), now(), coalesce(p_info, '{}'::jsonb))
  on conflict (worker) do update set last_seen = now(), info = excluded.info;
$$;

create or replace function public.satsr_claim(p_worker text, p_info jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare j public.satsr_jobs%rowtype;
begin
  perform public.satsr_heartbeat(p_worker, p_info);
  -- Housekeeping: stuck jobs out of attempts, requests nobody processed for two days.
  update public.satsr_jobs set status = 'failed', error_code = 'timeout', finished_at = now(),
         error = coalesce(error, 'no result after 3 attempts')
   where attempts >= 3
     and (status = 'queued' or (status = 'running' and claimed_at < now() - interval '15 minutes'));
  update public.satsr_jobs set status = 'failed', error_code = 'expired', finished_at = now(),
         error = 'not processed within 48 hours'
   where status = 'queued' and created_at < now() - interval '48 hours';

  select * into j from public.satsr_jobs
   where (status = 'queued' or (status = 'running' and claimed_at < now() - interval '15 minutes'))
     and attempts < 3
   order by created_at
   limit 1 for update skip locked;
  if not found then return null; end if;
  update public.satsr_jobs set status = 'running', worker = left(p_worker, 100), claimed_at = now(), attempts = attempts + 1
   where id = j.id;
  return jsonb_build_object('job_id', j.id, 'engine', j.engine, 'cell_x', j.cell_x, 'cell_y', j.cell_y,
                            'lat', j.cell_y / 200.0, 'lng', j.cell_x / 200.0,
                            'requested_date', j.requested_date, 'attempt', j.attempts + 1);
end $$;

/** The worker found the picture: if that picture is already done, hand the requesters the existing result. */
create or replace function public.satsr_resolve(p_id uuid, p_scene_date date, p_scene_id text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare j public.satsr_jobs%rowtype; v_other uuid;
begin
  select * into j from public.satsr_jobs where id = p_id for update;
  if not found or j.status <> 'running' then
    return jsonb_build_object('merged', false, 'ok', false);
  end if;
  select o.id into v_other from public.satsr_jobs o
   where o.engine = j.engine and o.cell_x = j.cell_x and o.cell_y = j.cell_y
     and o.scene_date = p_scene_date and o.status = 'done' and o.id <> p_id
   limit 1;
  if v_other is not null then
    perform public.satsr_merge(p_id, v_other);
    return jsonb_build_object('merged', true, 'ok', true, 'into', v_other);
  end if;
  update public.satsr_jobs set scene_date = p_scene_date, scene_id = left(p_scene_id, 200) where id = p_id;
  return jsonb_build_object('merged', false, 'ok', true);
end $$;

/**
 * p_status: done | failed | queued (= try again). Only a running job is updated.
 * Returns {updated, merged, into, orphans}: orphans = uploaded files of a job that was merged
 * into an equal finished one at the last moment (the worker deletes them).
 */
create or replace function public.satsr_finish(p_id uuid, p_status text, p_result jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  j public.satsr_jobs%rowtype;
  v_products jsonb := case when jsonb_typeof(p_result -> 'products') = 'object' then p_result -> 'products' end;
  v_code text := p_result ->> 'error_code';
  v_other uuid;
  v_n int;
begin
  if p_status not in ('done', 'failed', 'queued') then
    raise exception 'bad status' using errcode = '22023';
  end if;
  select * into j from public.satsr_jobs where id = p_id for update;
  if not found or j.status <> 'running' then
    return jsonb_build_object('updated', false, 'merged', false);
  end if;
  if p_status = 'done' then
    if v_products is null or v_products = '{}'::jsonb
       or exists (select 1 from jsonb_each(v_products) e where jsonb_typeof(e.value) <> 'object'
                    or e.value ->> 'sr' is null or e.value ->> 'lr' is null)
       or exists (select 1 from public.satsr_product_paths(v_products) p where p not like p_id::text || '/%' or p like '%..%') then
      raise exception 'bad products' using errcode = '22023';
    end if;
  end if;
  if p_status = 'failed' and (v_code is null or v_code not in ('no_scene', 'source_error', 'engine_error', 'timeout', 'expired')) then
    v_code := 'engine_error';
  end if;
  begin
    update public.satsr_jobs set
      status      = p_status,
      finished_at = case when p_status = 'queued' then null else now() end,
      error_code  = case when p_status = 'failed' then v_code end,
      error       = case when p_status = 'done' then null else left(p_result ->> 'error', 2000) end,
      scene_date  = coalesce((p_result ->> 'scene_date')::date, scene_date),
      scene_id    = coalesce(left(p_result ->> 'scene_id', 200), scene_id),
      south       = case when p_status = 'done' then (p_result ->> 'south')::double precision end,
      west        = case when p_status = 'done' then (p_result ->> 'west')::double precision end,
      north       = case when p_status = 'done' then (p_result ->> 'north')::double precision end,
      east        = case when p_status = 'done' then (p_result ->> 'east')::double precision end,
      width       = case when p_status = 'done' then (p_result ->> 'width')::int end,
      height      = case when p_status = 'done' then (p_result ->> 'height')::int end,
      products    = case when p_status = 'done' then v_products end,
      cloud_pct   = coalesce((p_result ->> 'cloud_pct')::real, cloud_pct),
      meta        = coalesce(case when jsonb_typeof(p_result -> 'meta') = 'object' then p_result -> 'meta' end, meta)
    where id = p_id;
    get diagnostics v_n = row_count;
  exception when unique_violation then
    -- Another job finished the very same picture first: give its result to our requesters.
    select o.id into v_other from public.satsr_jobs o
     where o.engine = j.engine and o.cell_x = j.cell_x and o.cell_y = j.cell_y and o.status = 'done'
       and o.scene_date = coalesce((p_result ->> 'scene_date')::date, j.scene_date) and o.id <> p_id
     limit 1;
    if v_other is null then raise; end if;
    perform public.satsr_merge(p_id, v_other);
    return jsonb_build_object('updated', false, 'merged', true, 'into', v_other,
                              'orphans', coalesce((select jsonb_agg(p) from public.satsr_product_paths(v_products) p), '[]'::jsonb));
  end;
  return jsonb_build_object('updated', v_n > 0, 'merged', false);
end $$;

/** Delete results older than satsr_retention_days; returns the storage paths to remove. */
create or replace function public.satsr_expired(p_limit int default 50)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_days int := coalesce((public.satsr_setting('satsr_retention_days') #>> '{}')::int, 60); v_paths jsonb;
begin
  with gone as (
    delete from public.satsr_jobs
     where id in (select id from public.satsr_jobs
                   where status in ('done', 'failed') and coalesce(finished_at, created_at) < now() - make_interval(days => v_days)
                   order by coalesce(finished_at, created_at)
                   limit least(greatest(coalesce(p_limit, 50), 1), 500))
    returning products)
  select coalesce(jsonb_agg(p), '[]'::jsonb) into v_paths
    from gone, lateral public.satsr_product_paths(gone.products) p;
  return v_paths;
end $$;

-- ── result files: private bucket, read through policy ───────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('satsr-results', 'satsr-results', false, 8388608, array['image/png'])
on conflict (id) do nothing;

/** A finished job's file, for staff or for someone who requested that job. */
create or replace function public.satsr_object_allowed(p_name text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.satsr_jobs j
     where j.id = (case when split_part(p_name, '/', 1) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                        then split_part(p_name, '/', 1)::uuid end)
       and j.status = 'done'
       and exists (select 1 from public.satsr_product_paths(j.products) p where p = p_name)
       and (public.satsr_is_staff() or public.satsr_job_mine(j.id)));
$$;

drop policy if exists satsr_results_read on storage.objects;
create policy satsr_results_read on storage.objects for select to authenticated
  using (bucket_id = 'satsr-results' and (select public.satsr_object_allowed(name)));

-- ── grants ──────────────────────────────────────────────────────────
-- Supabase grants new functions to anon/authenticated by default: revoke from all, then grant what is meant.
revoke all on function public.satsr_is_staff(), public.satsr_job_mine(uuid), public.satsr_used(uuid),
  public.satsr_worker_online(), public.satsr_merge(uuid, uuid), public.satsr_product_paths(jsonb), public.satsr_setting(text),
  public.satsr_my_quota(), public.satsr_request(double precision, double precision, date, text), public.satsr_my_jobs(int),
  public.satsr_heartbeat(text, jsonb), public.satsr_claim(text, jsonb), public.satsr_resolve(uuid, date, text),
  public.satsr_finish(uuid, text, jsonb), public.satsr_expired(int), public.satsr_object_allowed(text)
  from public, anon, authenticated;
-- used inside RLS policies
grant execute on function public.satsr_is_staff(), public.satsr_job_mine(uuid), public.satsr_object_allowed(text) to authenticated;
-- browser
grant execute on function public.satsr_my_quota() to anon, authenticated;
grant execute on function public.satsr_request(double precision, double precision, date, text), public.satsr_my_jobs(int) to authenticated;
-- worker
grant execute on function public.satsr_heartbeat(text, jsonb), public.satsr_claim(text, jsonb), public.satsr_resolve(uuid, date, text),
  public.satsr_finish(uuid, text, jsonb), public.satsr_expired(int) to service_role;
