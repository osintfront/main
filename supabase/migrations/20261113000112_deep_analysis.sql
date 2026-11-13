-- Osintfront · Migration 112 — deep analysis (term windows).
-- Terms in the event details window (people, weapons, organisations, places, military terms) open
-- a saved entry. The editor marks terms for every event (event_terms); an entry is written by Opus
-- on the first click (deep_entries, found by normalised names in deep_aliases); deep_jobs holds
-- the one-writer-per-name lease and the last failure. Shared tables are service-role only; the
-- browser reads through event_terms_for / deep_entry / deep_my_quota.
-- Budget: app_settings deep_daily_budget_usd = 5 for subscribers' new entries (staff are outside
-- it, logged under purpose deep_entry_staff). Plan key deep_analysis: Pro 3 / Max 10 / Intel 10.
-- Foreign keys are in migration 113 (run by hand); this file works without them.

create table if not exists public.deep_entries (
  id                uuid primary key default gen_random_uuid(),
  kind              text not null check (kind in ('person', 'weapon', 'org', 'place', 'term')),
  name_he           text not null default '',
  name_en           text not null default '',
  name_orig         text not null default '',
  summary_he        text not null default '',
  summary_en        text not null default '',
  sections          jsonb not null default '[]',
  sources           jsonb not null default '[]',
  image             jsonb,
  related_event_ids uuid[] not null default '{}',
  model             text,
  cost_usd          numeric(12, 6) not null default 0,
  version           int not null default 1,
  created_by        uuid,
  created_at        timestamptz not null default now(),
  updated_by        uuid,
  updated_at        timestamptz not null default now(),
  edited_at         timestamptz,
  prev              jsonb
);

create table if not exists public.deep_aliases (
  alias    text primary key,
  entry_id uuid not null
);
create index if not exists deep_aliases_entry on public.deep_aliases (entry_id);

create table if not exists public.deep_jobs (
  key         text primary key,
  busy_until  timestamptz,
  busy_token  uuid,
  started_by  uuid,
  staff       boolean not null default false,
  fail_reason text check (fail_reason in ('failed', 'no_entry')),
  retry_after timestamptz,
  entry_id    uuid
);

create table if not exists public.event_terms (
  event_id   uuid not null,
  key        text not null,
  keys       text[] not null,
  kind       text not null check (kind in ('person', 'weapon', 'org', 'place', 'term')),
  he         text not null default '',
  en         text not null default '',
  name       text not null default '',
  source     text not null default 'ai' check (source in ('ai', 'staff')),
  created_at timestamptz not null default now(),
  primary key (event_id, key)
);
create index if not exists event_terms_keys on public.event_terms using gin (keys);

alter table public.deep_entries enable row level security;
alter table public.deep_aliases enable row level security;
alter table public.deep_jobs enable row level security;
alter table public.event_terms enable row level security;
revoke all on public.deep_entries, public.deep_aliases, public.deep_jobs, public.event_terms from anon, authenticated;

insert into public.app_settings (key, value) values ('deep_daily_budget_usd', '5'::jsonb)
on conflict (key) do nothing;

insert into public.plan_features (feature_key, plan_id, enabled, limit_value, note) values
  ('deep_analysis', 'guest', false, 0,  'deep analysis: new entries per day'),
  ('deep_analysis', 'free',  false, 0,  'deep analysis: new entries per day'),
  ('deep_analysis', 'pro',   true,  3,  'deep analysis: new entries per day'),
  ('deep_analysis', 'max',   true,  10, 'deep analysis: new entries per day'),
  ('deep_analysis', 'intel', true,  10, 'deep analysis: new entries per day')
on conflict (feature_key, plan_id) do update
  set enabled = excluded.enabled, limit_value = excluded.limit_value, note = excluded.note;

-- ── Service-role helpers (event-agent) ─────────────────────────────────────────────
/** May this user open entries / start new ones? { enabled, staff, limit }. Staff = active non-viewer. */
create or replace function public.deep_allowed(p_uid uuid)
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
  select enabled, limit_value into f from public.plan_features where feature_key = 'deep_analysis' and plan_id = v_plan;
  return jsonb_build_object('enabled', coalesce(f.enabled, false), 'staff', false, 'limit', f.limit_value);
end $$;

/** Take the 4-minute writer lease for a name. Returns the token, or null while someone else holds it. */
create or replace function public.deep_claim(p_key text, p_uid uuid, p_staff boolean)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_token uuid := gen_random_uuid(); v_got uuid;
begin
  insert into public.deep_jobs (key, busy_until, busy_token, started_by, staff)
  values (p_key, now() + interval '4 minutes', v_token, p_uid, coalesce(p_staff, false))
  on conflict (key) do update
    set busy_until = now() + interval '4 minutes', busy_token = excluded.busy_token, started_by = excluded.started_by,
        staff = excluded.staff, fail_reason = null, retry_after = null
    where coalesce(public.deep_jobs.busy_until, '-infinity') < now()
  returning busy_token into v_got;
  return v_got;
end $$;

/** Finish a write (only while the lease is ours): the entry, or why it failed and when to try again. */
create or replace function public.deep_done(p_key text, p_token uuid, p_entry uuid, p_fail text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  update public.deep_jobs set busy_until = null, entry_id = p_entry, fail_reason = p_fail,
    retry_after = case p_fail when 'failed' then now() + interval '1 hour' when 'no_entry' then now() + interval '30 days' else null end
  where key = p_key and busy_token = p_token and busy_until is not null;
  get diagnostics n = row_count;
  return n > 0;
end $$;

/** Subscribers' spend on new entries since Israel midnight (staff writes are logged as deep_entry_staff). */
create or replace function public.deep_spent_today()
returns numeric language sql stable security definer set search_path = '' as $$
  select coalesce(sum(cost_usd), 0) from public.ai_usage
  where purpose = 'deep_entry'
    and at >= ((now() at time zone 'Asia/Jerusalem')::date)::timestamp at time zone 'Asia/Jerusalem';
$$;

/** Writes in progress: all of them (the two-at-a-time cap) and the subscribers' ones (the budget reserve). */
create or replace function public.deep_in_flight()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('all', count(*), 'readers', count(*) filter (where not staff))
  from public.deep_jobs where busy_until > now();
$$;

revoke all on function public.deep_allowed(uuid), public.deep_claim(text, uuid, boolean), public.deep_done(text, uuid, uuid, text),
  public.deep_spent_today(), public.deep_in_flight() from public, anon, authenticated;

-- ── The browser's calls ────────────────────────────────────────────────────────────
/** The event's terms: stored marks (with their entry when one exists), then existing entries whose
 *  alias (4+ characters) appears in the event's text. Only for readers of the summary. At most 12. */
create or replace function public.event_terms_for(p_event uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare e record; v_txt text; v_out jsonb := '[]'::jsonb; v_seen uuid[] := '{}'; r record;
begin
  if not public.my_feature('event_summary') then return '[]'::jsonb; end if;
  select id, title, description, translations into e from public.events
  where id = p_event and status in ('published', 'archived') and deleted_at is null;
  if e.id is null then return '[]'::jsonb; end if;
  for r in
    select t.key, t.name, t.kind, t.he, t.en,
      (select a.entry_id from public.deep_aliases a where a.alias = any (t.keys) limit 1) as entry
    from public.event_terms t where t.event_id = p_event order by t.created_at, t.key limit 12
  loop
    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'key', r.key, 'name', r.name, 'kind', r.kind,
      'surfaces', to_jsonb(array_remove(array[nullif(r.he, ''), nullif(r.en, '')], null)),
      'entry', r.entry));
    if r.entry is not null then v_seen := v_seen || r.entry; end if;
  end loop;
  if jsonb_array_length(v_out) >= 12 then return v_out; end if;
  v_txt := lower(coalesce(e.title, '') || ' ' || coalesce(e.description, '') || ' ' || coalesce(e.translations::text, ''));
  for r in
    select d.id, d.name_en, d.kind, array_agg(a.alias order by length(a.alias) desc) as hits
    from public.deep_aliases a join public.deep_entries d on d.id = a.entry_id
    where length(a.alias) >= 4 and position(a.alias in v_txt) > 0 and not (d.id = any (v_seen))
    group by d.id, d.name_en, d.kind
    order by d.name_en
    limit 12 - jsonb_array_length(v_out)
  loop
    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'key', r.id::text, 'name', r.name_en, 'kind', r.kind, 'surfaces', to_jsonb(r.hits), 'entry', r.id));
  end loop;
  return v_out;
end $$;

/** One entry for a reader whose plan has deep_analysis: its text, names and our events that mention it. */
create or replace function public.deep_entry(p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare d record; v_aliases text[]; v_events uuid[];
begin
  if not public.my_feature('deep_analysis') then return null; end if;
  select * into d from public.deep_entries where id = p_id;
  if d.id is null then return null; end if;
  select coalesce(array_agg(alias order by alias), '{}') into v_aliases from public.deep_aliases where entry_id = p_id;
  select coalesce(array_agg(x.id order by x.occurred_at desc), '{}') into v_events from (
    select ev.id, ev.occurred_at from public.events ev
    where ev.status in ('published', 'archived') and ev.deleted_at is null
      and (ev.id = any (d.related_event_ids)
           or exists (select 1 from public.event_terms t where t.event_id = ev.id and t.keys && v_aliases))
    order by ev.occurred_at desc limit 12
  ) x;
  return jsonb_build_object(
    'id', d.id, 'kind', d.kind, 'name_he', d.name_he, 'name_en', d.name_en, 'name_orig', d.name_orig,
    'summary_he', d.summary_he, 'summary_en', d.summary_en, 'sections', d.sections, 'sources', d.sources,
    'image', d.image, 'version', d.version, 'created_at', d.created_at, 'updated_at', d.updated_at, 'edited_at', d.edited_at,
    'aliases', to_jsonb(v_aliases), 'events', to_jsonb(v_events));
end $$;

/** The caller's day: { enabled, staff, used, limit, budget_left } (staff: no limit, budget always left). */
create or replace function public.deep_my_quota()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_staff boolean; v_used int := 0; v_budget numeric; v_left boolean;
begin
  select (p.status = 'active' and p.role <> 'viewer') into v_staff from public.profiles p where p.id = v_uid;
  v_staff := coalesce(v_staff, false);
  if v_uid is not null then
    select coalesce(sum(count), 0) into v_used from public.feature_usage
    where user_id = v_uid and feature_key = 'deep_analysis' and day = (now() at time zone 'Asia/Jerusalem')::date;
  end if;
  select nullif(value::text, 'null')::numeric into v_budget from public.app_settings where key = 'deep_daily_budget_usd';
  v_left := v_staff or v_budget is null
    or public.deep_spent_today() + ((public.deep_in_flight()->>'readers')::int * 0.5) < v_budget;
  return jsonb_build_object('enabled', public.my_feature('deep_analysis'), 'staff', v_staff, 'used', v_used,
    'limit', case when v_staff then null else public.my_feature_limit('deep_analysis') end, 'budget_left', v_left);
end $$;

revoke all on function public.event_terms_for(uuid), public.deep_entry(uuid), public.deep_my_quota() from public;
grant execute on function public.event_terms_for(uuid), public.deep_entry(uuid), public.deep_my_quota() to anon, authenticated;
