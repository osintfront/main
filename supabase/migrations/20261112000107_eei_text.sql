-- Free-text EEI (צי"ח) (12 Nov 2026): a Pro / Max user pastes a daily list of theatres and topics;
-- the AI (Haiku) reads every event of the last 24 h in each theatre and marks which topics it is about.
--  · eei_theatres: one row per distinct theatre (fingerprint = areas + topics), SHARED by every user
--    whose list has the same theatre — so the same daily list costs the same for 1 user or 50.
--    Service role only.
--  · eei_tags: the tagger's answer per theatre and event (topics = [] → checked, no topic fits).
--    Service role only; users read their own marks through eei_my_tags().
--  · eei_lists: one row per user — the pasted text, the cleaned list, yesterday's list (restore),
--    and the per-day counters of splits and saves. The owner may read his row; writes go through
--    the event-agent function.
--  · eei_allowed / eei_count / eei_spent_today / eei_claim / eei_pending: helpers for the server
--    functions (service role only).
--  · eei_my_tags(): the caller's marks (+ "budget used up" flag) — the only thing the browser calls.
--  · eei_tick(): the scheduler body (cron in 20261112000108, approved separately).
--  · app_settings eei_daily_budget_usd = 2; plan_features eei_text: Pro / Max / Intel, 5 splits a day.

-- ── Tables ───────────────────────────────────────────────────────────────────────
create table if not exists public.eei_theatres (
  hash          text primary key,
  spec          jsonb not null,               -- { name, areas[], countries[], boxes[], topics: [{ key, label }] }
  created_at    timestamptz not null default now(),
  last_used_at  timestamptz not null default now(),
  busy_until    timestamptz,                  -- lease: one tagging run at a time
  busy_token    uuid,                         -- whose lease it is (renewed per batch, released only by its owner)
  last_tagged_at timestamptz,                 -- the tick serves the least recently tagged theatre first
  tagged_day    date,
  tagged_count  integer not null default 0,   -- events checked on tagged_day (daily cap: 1,200)
  fail_count    integer not null default 0,
  paused_until  timestamptz                   -- 5 failures in a row → paused 1 hour
);

create table if not exists public.eei_tags (
  theatre_hash  text not null references public.eei_theatres (hash) on delete cascade,
  event_id      uuid not null references public.events (id) on delete cascade,
  topics        text[] not null default '{}',
  tagged_at     timestamptz not null default now(),
  primary key (theatre_hash, event_id)
);
create index if not exists eei_tags_tagged_at on public.eei_tags (tagged_at);

create table if not exists public.eei_lists (
  user_id        uuid primary key references auth.users (id) on delete cascade,
  raw_text       text check (raw_text is null or char_length(raw_text) <= 4000),
  list           jsonb,
  prev_raw_text  text,
  prev_list      jsonb,
  updated_at     timestamptz not null default now(),
  parse_day      date,
  parse_count    integer not null default 0,
  save_day       date,
  save_count     integer not null default 0
);

alter table public.eei_theatres enable row level security;
alter table public.eei_tags enable row level security;
alter table public.eei_lists enable row level security;
revoke all on public.eei_theatres, public.eei_tags from anon, authenticated;
revoke all on public.eei_lists from anon, authenticated;
grant select on public.eei_lists to authenticated;
drop policy if exists eei_lists_own_select on public.eei_lists;
create policy eei_lists_own_select on public.eei_lists for select to authenticated using (user_id = auth.uid());

-- ── Settings and plan rows ──────────────────────────────────────────────────────
insert into public.app_settings (key, value) values ('eei_daily_budget_usd', '2'::jsonb)
on conflict (key) do nothing;

insert into public.plan_features (feature_key, plan_id, enabled, limit_value, note) values
  ('eei_text', 'guest', false, 0, 'free-text EEI: text splits per day'),
  ('eei_text', 'free',  false, 0, 'free-text EEI: text splits per day'),
  ('eei_text', 'pro',   true,  5, 'free-text EEI: text splits per day'),
  ('eei_text', 'max',   true,  5, 'free-text EEI: text splits per day'),
  ('eei_text', 'intel', true,  5, 'free-text EEI: text splits per day')
on conflict (feature_key, plan_id) do update
  set enabled = excluded.enabled, limit_value = excluded.limit_value, note = excluded.note;

-- ── Helpers for the server functions (service role only) ────────────────────────
/** May this user use the feature: staff and "plans not enforced" → yes, no limit; else his plan's row. */
create or replace function public.eei_allowed(p_uid uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare pr record; v_plan text; f record;
begin
  select id, role, status, plan, plan_expires_at into pr from public.profiles where id = p_uid;
  if pr.id is not null and pr.status = 'active' and pr.role <> 'viewer' then
    return jsonb_build_object('enabled', true, 'limit', null);
  end if;
  if not public.plans_enforced() then return jsonb_build_object('enabled', true, 'limit', null); end if;
  v_plan := case
    when pr.id is null or pr.status <> 'active' then 'guest'
    when pr.plan <> 'free' and pr.plan_expires_at is not null and pr.plan_expires_at < now() then 'free'
    else pr.plan::text end;
  select enabled, limit_value into f from public.plan_features where feature_key = 'eei_text' and plan_id = v_plan;
  return jsonb_build_object('enabled', coalesce(f.enabled, false), 'limit', f.limit_value);
end $$;

/** Count one split ('parse', 5 a day) or save ('save', 10 a day). false = limit reached (not counted). */
create or replace function public.eei_count(p_uid uuid, p_kind text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_day date := (now() at time zone 'Asia/Jerusalem')::date; r record;
begin
  if p_kind not in ('parse', 'save') then raise exception 'bad kind %', p_kind; end if;
  insert into public.eei_lists (user_id) values (p_uid) on conflict (user_id) do nothing;
  select * into r from public.eei_lists where user_id = p_uid for update;
  if p_kind = 'parse' then
    if r.parse_day is distinct from v_day then
      update public.eei_lists set parse_day = v_day, parse_count = 1 where user_id = p_uid; return true;
    end if;
    if r.parse_count >= 5 then return false; end if;
    update public.eei_lists set parse_count = parse_count + 1 where user_id = p_uid; return true;
  end if;
  if r.save_day is distinct from v_day then
    update public.eei_lists set save_day = v_day, save_count = 1 where user_id = p_uid; return true;
  end if;
  if r.save_count >= 10 then return false; end if;
  update public.eei_lists set save_count = save_count + 1 where user_id = p_uid; return true;
end $$;

/** Today's EEI AI spend (Israel day). */
create or replace function public.eei_spent_today()
returns numeric language sql stable security definer set search_path = '' as $$
  select coalesce(sum(cost_usd), 0) from public.ai_usage
  where purpose in ('eei_parse', 'eei_tag')
    and at >= ((now() at time zone 'Asia/Jerusalem')::date)::timestamp at time zone 'Asia/Jerusalem';
$$;

/** Take the theatre's 2-minute lease: its token — or null when another run holds it or it is paused. */
create or replace function public.eei_claim(p_hash text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v uuid := gen_random_uuid(); n int;
begin
  update public.eei_theatres set busy_until = now() + interval '2 minutes', busy_token = v
  where hash = p_hash and coalesce(busy_until, '-infinity') < now() and coalesce(paused_until, '-infinity') < now();
  get diagnostics n = row_count;
  return case when n > 0 then v end;
end $$;

/** Extend the lease for another 2 minutes — only while it is still ours. */
create or replace function public.eei_renew(p_hash text, p_token uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  update public.eei_theatres set busy_until = now() + interval '2 minutes'
  where hash = p_hash and busy_token = p_token and busy_until > now();
  get diagnostics n = row_count;
  return n > 0;
end $$;

/** Give the lease back — only our own. */
create or replace function public.eei_release(p_hash text, p_token uuid)
returns void language sql security definer set search_path = '' as $$
  update public.eei_theatres set busy_until = null, busy_token = null where hash = p_hash and busy_token = p_token;
$$;

/** Published events of the last 24 h in the theatre (country text or pin inside a box) not yet checked for it. */
create or replace function public.eei_pending(p_hash text, p_limit int)
returns table (id uuid, category_slug text, country text, location_name text, title text, description text)
language sql stable security definer set search_path = '' as $$
  with t as (select spec from public.eei_theatres where hash = p_hash)
  select e.id, c.slug, e.country, e.location_name, e.title, e.description
  from public.events e
  cross join t
  left join public.event_categories c on c.id = e.category_id
  where e.status = 'published' and e.deleted_at is null
    and e.occurred_at >= now() - interval '24 hours'
    and not exists (select 1 from public.eei_tags g where g.theatre_hash = p_hash and g.event_id = e.id)
    and (
      (jsonb_array_length(coalesce(t.spec->'countries', '[]')) = 0 and jsonb_array_length(coalesce(t.spec->'boxes', '[]')) = 0)
      or exists (select 1 from jsonb_array_elements_text(t.spec->'countries') n
                 where char_length(n) >= 2 and lower(coalesce(e.country, '')) like '%' || n || '%')
      or exists (select 1 from jsonb_array_elements(t.spec->'boxes') b
                 where e.latitude between (b->>0)::float8 and (b->>2)::float8
                   and e.longitude between (b->>1)::float8 and (b->>3)::float8)
    )
  order by e.occurred_at desc
  limit greatest(least(p_limit, 2000), 0);
$$;

revoke all on function public.eei_allowed(uuid), public.eei_count(uuid, text), public.eei_spent_today(),
  public.eei_claim(text), public.eei_renew(text, uuid), public.eei_release(text, uuid), public.eei_pending(text, int)
  from public, anon, authenticated;

-- ── The browser's call ──────────────────────────────────────────────────────────
/** The caller's marks: { degraded, tags: [{ h: theatre hash, e: event id, t: topic keys, at }] }. */
create or replace function public.eei_my_tags(p_after timestamptz default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_hashes text[]; v_budget numeric; v_tags jsonb;
begin
  if v_uid is null or not public.my_feature('eei_text') then
    return jsonb_build_object('degraded', false, 'tags', '[]'::jsonb);
  end if;
  select coalesce(array_agg(distinct th->>'hash'), '{}') into v_hashes
  from public.eei_lists l, jsonb_array_elements(coalesce(l.list->'theatres', '[]')) th
  where l.user_id = v_uid and th->>'hash' is not null;
  update public.eei_theatres set last_used_at = now() where hash = any (v_hashes);
  select coalesce(jsonb_agg(jsonb_build_object('h', g.theatre_hash, 'e', g.event_id, 't', to_jsonb(g.topics), 'at', g.tagged_at)), '[]'::jsonb)
  into v_tags
  from (
    select g.* from public.eei_tags g
    join public.events e on e.id = g.event_id
    where g.theatre_hash = any (v_hashes)
      and g.tagged_at > now() - interval '25 hours'
      and e.occurred_at >= now() - interval '24 hours'
      -- 3 minutes of overlap: a run that commits late (older tagged_at) is not skipped; the browser's merge is idempotent.
      and (p_after is null or g.tagged_at > p_after - interval '3 minutes')
    order by g.tagged_at
    limit 5000
  ) g;
  select nullif(value #>> '{}', '')::numeric into v_budget from public.app_settings where key = 'eei_daily_budget_usd';
  return jsonb_build_object('degraded', v_budget is not null and public.eei_spent_today() >= v_budget, 'tags', v_tags);
end $$;
revoke all on function public.eei_my_tags(timestamptz) from public, anon;
grant execute on function public.eei_my_tags(timestamptz) to authenticated;

-- ── Scheduler body ──────────────────────────────────────────────────────────────
create or replace function public.eei_tick() returns void
language plpgsql security definer set search_path = '' as $$
declare v_secret text;
begin
  -- Once a day (01:00–01:04 UTC): old marks and theatres nobody used for 8 days.
  if extract(hour from now()) = 1 and extract(minute from now()) < 5 then
    delete from public.eei_tags where tagged_at < now() - interval '8 days';
    delete from public.eei_theatres t where t.last_used_at < now() - interval '8 days'
      and not exists (select 1 from public.eei_lists l, jsonb_array_elements(coalesce(l.list->'theatres', '[]')) th
                      where th->>'hash' = t.hash);
  end if;
  if not exists (select 1 from public.eei_theatres where last_used_at > now() - interval '24 hours') then return; end if;
  select value into v_secret from public.intel_config where key = 'cron_secret';
  perform net.http_post(
    url := 'https://kbfggmvrfevstzneqfzf.supabase.co/functions/v1/eei-runner',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_secret),
    body := '{"action":"tick"}'::jsonb,
    timeout_milliseconds := 5000);
end $$;
revoke all on function public.eei_tick() from public, anon, authenticated;
