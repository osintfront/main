-- Osintfront · Migration 129 — statistics dashboard in "Ask the map".
-- plan_features key ai_dashboard: Max and Intel on; guest, free and Pro off. Staff always.
-- ai_dashboards: one row per dashboard build (background job + its result), service role only.
--   At most one running build per user. Read by event-agent (action dashboard_status) only.
-- ai_stats_candidates(): every public event matching a dashboard's broad filter (up to 2,001,
--   oldest first) — the ask search without its 120 cap, with the merged-report count.
-- ai_quota(): a dashboard is a fixed charge of 3 credits — its own model rows (purpose
--   ask_dashboard_*) stay in spent_today_usd (global budget) but leave the user's "used".
-- Cleanup (30 days) is in migration 130.
-- Spec: docs/superpowers/specs/2026-11-14-ask-map-dashboard-design.md

insert into public.plan_features (feature_key, plan_id, enabled, limit_value, note) values
  ('ai_dashboard', 'guest', false, null, 'statistics dashboard in ask the map'),
  ('ai_dashboard', 'free',  false, null, 'statistics dashboard in ask the map'),
  ('ai_dashboard', 'pro',   false, null, 'statistics dashboard in ask the map'),
  ('ai_dashboard', 'max',   true,  null, 'statistics dashboard in ask the map'),
  ('ai_dashboard', 'intel', true,  null, 'statistics dashboard in ask the map')
on conflict (feature_key, plan_id) do update
  set enabled = excluded.enabled, limit_value = excluded.limit_value, note = excluded.note;

create table if not exists public.ai_dashboards (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid,
  staff       boolean not null default false,
  status      text not null check (status in ('running', 'done', 'failed')),
  stage       text not null default 'finding' check (stage in ('finding', 'classifying', 'merging', 'insights')),
  progress    jsonb,
  question    text not null,
  lang        text not null check (lang in ('he', 'en')),
  metric      jsonb not null,
  since       timestamptz not null,
  until       timestamptz not null,
  cache_key   text not null,
  cached      boolean not null default false,
  charged     boolean not null default false,
  result      jsonb,
  created_at  timestamptz not null default now(),
  finished_at timestamptz
);
create unique index if not exists ai_dashboards_one_running on public.ai_dashboards (user_id) where status = 'running';
create index if not exists ai_dashboards_cache on public.ai_dashboards (cache_key, finished_at desc) where status = 'done' and not cached;
create index if not exists ai_dashboards_charged on public.ai_dashboards (user_id, finished_at) where charged;
alter table public.ai_dashboards enable row level security;
revoke all on public.ai_dashboards from anon, authenticated;

/** May this user build dashboards? { enabled, staff }. Staff = active non-viewer (as deep_allowed). */
create or replace function public.ai_dashboard_allowed(p_uid uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare pr record; v_plan text; f record;
begin
  select id, role, status, plan, plan_expires_at into pr from public.profiles where id = p_uid;
  if pr.id is not null and pr.status = 'active' and pr.role <> 'viewer' then
    return jsonb_build_object('enabled', true, 'staff', true);
  end if;
  if not public.plans_enforced() then return jsonb_build_object('enabled', true, 'staff', false); end if;
  v_plan := case
    when pr.id is null or pr.status <> 'active' then 'guest'
    when pr.plan <> 'free' and pr.plan_expires_at is not null and pr.plan_expires_at < now() then 'free'
    else pr.plan::text end;
  select enabled into f from public.plan_features where feature_key = 'ai_dashboard' and plan_id = v_plan;
  return jsonb_build_object('enabled', coalesce(f.enabled, false), 'staff', false);
end $$;

/** Every public event in [since, until) that passes the ask search's place and topic filter. */
create or replace function public.ai_stats_candidates(
  p_since timestamptz,
  p_until timestamptz,
  p_countries text[] default '{}',
  p_places text[] default '{}',
  p_categories text[] default '{}',
  p_terms text[] default '{}',
  p_limit integer default 2001
) returns table (
  id uuid, occurred_at timestamptz, title text, title_en text, description text, category_slug text,
  country text, location_name text, latitude double precision, longitude double precision,
  location_precision text, source_count integer
) language sql stable security definer set search_path = '' as $$
  with base as (
    select e.*, c.slug as cslug,
      lower(coalesce(e.title,'') || ' ' || coalesce(e.description,'') || ' ' || coalesce(e.original_report_text,'') || ' ' ||
            coalesce(e.translations::text,'') || ' ' || coalesce(e.location_name,'') || ' ' || coalesce(e.locations::text,'') || ' ' ||
            coalesce(e.city,'') || ' ' || coalesce(e.region,'')) as txt
    from public.events e
    left join public.event_categories c on c.id = e.category_id
    where e.deleted_at is null
      and e.status in ('published', 'archived')
      and e.occurred_at >= p_since
      and e.occurred_at < p_until
  ), scored as (
    select b.*,
      (cardinality(p_countries) = 0 and cardinality(p_places) = 0)
        or lower(coalesce(b.country,'')) = any(select lower(x) from unnest(p_countries) x)
        or exists (select 1 from unnest(p_places) p where char_length(p) >= 2 and b.txt like '%' || lower(p) || '%') as place_ok,
      (cardinality(p_categories) = 0 and cardinality(p_terms) = 0)
        or b.cslug = any(p_categories)
        or exists (select 1 from unnest(p_terms) t where char_length(t) >= 2 and b.txt like '%' || lower(t) || '%') as topic_ok
    from base b
  )
  select s.id, s.occurred_at, s.title, s.translations->'en'->>'title', left(s.description, 300), s.cslug,
         s.country, s.location_name, s.latitude::double precision, s.longitude::double precision,
         s.location_precision,
         case when jsonb_typeof(s.sources) = 'array' then jsonb_array_length(s.sources) else 0 end
  from scored s
  where s.place_ok and s.topic_ok
  order by s.occurred_at, s.id
  limit least(greatest(p_limit, 1), 2001);
$$;

revoke all on function public.ai_dashboard_allowed(uuid) from public, anon, authenticated;
revoke all on function public.ai_stats_candidates(timestamptz, timestamptz, text[], text[], text[], text[], integer) from public, anon, authenticated;

-- ai_quota (migration 71) with one change: "used" leaves out the dashboard's own model rows and
-- adds 3 credits per charged dashboard finished today. Everything else is as before.
create or replace function public.ai_quota(p_uid uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_enabled boolean := coalesce((select value from app_settings where key = 'ai_limits_enabled') = 'true'::jsonb, false);
  v_credit numeric := coalesce((select (value #>> '{}')::numeric from app_settings where key = 'ai_credit_usd'), 0.08);
  v_budget numeric := (select (value #>> '{}')::numeric from app_settings where key = 'ai_daily_budget_usd');
  v_day timestamptz := date_trunc('day', now() at time zone 'Asia/Jerusalem') at time zone 'Asia/Jerusalem';
  p record;
  v_plan text;
  v_limit int;
  v_used numeric;
  v_spent numeric;
begin
  select role, plan, plan_expires_at into p from profiles where id = p_uid;
  v_plan := case when p.plan is distinct from 'free' and p.plan_expires_at is not null and p.plan_expires_at < now() then 'free' else coalesce(p.plan, 'free') end;
  select limit_value into v_limit from plan_features where feature_key = 'ai_expand_ask' and plan_id = v_plan;
  select coalesce(sum(cost_usd), 0) / nullif(v_credit, 0) into v_used from ai_usage
    where user_id = p_uid and at >= v_day and not starts_with(purpose, 'ask_dashboard_');
  v_used := coalesce(v_used, 0) + 3 * (select count(*) from ai_dashboards d
    where d.user_id = p_uid and d.charged and d.finished_at >= v_day);
  select coalesce(sum(cost_usd), 0) into v_spent from ai_usage where user_id is not null and at >= v_day;
  return jsonb_build_object(
    'enabled', v_enabled,
    'staff', coalesce(p.role <> 'viewer', false),
    'plan', v_plan,
    'limit', v_limit,
    'used', round(coalesce(v_used, 0), 2),
    'budget_usd', v_budget,
    'spent_today_usd', round(v_spent, 4)
  );
end;
$$;
revoke all on function public.ai_quota(uuid) from public, anon, authenticated;
