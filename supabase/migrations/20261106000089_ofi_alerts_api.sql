-- OFI phase 5 (database side):
--  · threshold alerts: a user's alert fires when an estimate crosses a level (up or down) or moves by
--    more than X points between two estimates. Pro: up to 3 alerts; Max: unlimited + webhook URL.
--  · a delivery queue, drained by /api/ofi-alerts (web push with the site's existing VAPID keys,
--    and webhooks for Max).
--  · the data API: /api/v1/insights (same API keys and limits as /api/v1/events).

-- Tier of any user (ofi_tier() = the caller's).
create or replace function public.ofi_tier_of(p_uid uuid) returns smallint
language sql stable security definer set search_path = '' as $$
  select (case
    when pr.id is null or pr.status <> 'active' then 0
    when pr.role <> 'viewer' then 3
    when not coalesce((select s.value = 'true'::jsonb from public.app_settings s where s.key = 'enforce_plans'), false) then 3
    else coalesce((
      select max(case f.feature_key when 'insights_max' then 3 when 'insights_pro' then 2 else 1 end)
      from public.plan_features f
      where f.enabled and f.feature_key in ('insights_basic', 'insights_pro', 'insights_max')
        and f.plan_id = case when pr.plan <> 'free' and pr.plan_expires_at is not null and pr.plan_expires_at < now()
                             then 'free' else pr.plan end), 0)
  end)::smallint
  from (select 1) one left join public.profiles pr on pr.id = p_uid;
$$;
revoke all on function public.ofi_tier_of(uuid) from public, anon, authenticated;

create or replace function public.ofi_tier() returns smallint
language sql stable security definer set search_path = '' as $$
  select public.ofi_tier_of(auth.uid());
$$;
revoke all on function public.ofi_tier() from public, anon;
grant execute on function public.ofi_tier() to authenticated;

-- ── Alerts ───────────────────────────────────────────────────────────────────────────────
create table if not exists public.insight_alerts (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  event_id      uuid not null references public.insight_events(id) on delete cascade,
  kind          text not null check (kind in ('above', 'below', 'change')),
  -- above/below: a probability 0.01..0.95; change: percentage points 0.5..50
  value         numeric not null,
  webhook_url   text check (webhook_url is null or (webhook_url ~ '^https://[^/\s]+\.[^/\s]+(/\S*)?$' and length(webhook_url) <= 500)),
  enabled       boolean not null default true,
  last_fired_at timestamptz,
  created_at    timestamptz not null default now(),
  check ((kind = 'change' and value between 0.5 and 50) or (kind <> 'change' and value between 0.01 and 0.95))
);
create index if not exists insight_alerts_event on public.insight_alerts (event_id) where enabled;

alter table public.insight_alerts enable row level security;
revoke all on table public.insight_alerts from anon;
drop policy if exists "ofi alerts: own" on public.insight_alerts;
create policy "ofi alerts: own" on public.insight_alerts for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Plan limits, enforced on write: Free none, Pro 3 (no webhook), Max unlimited (+ webhook).
create or replace function public.insight_alerts_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare t smallint := public.ofi_tier_of(new.user_id); n int;
begin
  if t < 2 then raise exception 'plan: alerts need the Pro plan'; end if;
  if new.webhook_url is not null and t < 3 then raise exception 'plan: webhooks need the Max plan'; end if;
  if tg_op = 'INSERT' and t < 3 then
    select count(*) into n from public.insight_alerts where user_id = new.user_id;
    if n >= 3 then raise exception 'plan: the Pro plan allows 3 alerts'; end if;
  end if;
  if not exists (select 1 from public.insight_events e where e.id = new.event_id and e.is_published and e.status <> 'draft') then
    raise exception 'unknown insight';
  end if;
  return new;
end $$;
revoke all on function public.insight_alerts_guard() from public, anon, authenticated;
drop trigger if exists insight_alerts_guard on public.insight_alerts;
create trigger insight_alerts_guard before insert or update on public.insight_alerts
  for each row execute function public.insight_alerts_guard();

-- ── Delivery queue (service role only) ──────────────────────────────────────────────────────
create table if not exists public.insight_alert_queue (
  id          bigint generated always as identity primary key,
  alert_id    uuid references public.insight_alerts(id) on delete cascade,
  user_id     uuid not null,
  event_slug  text not null,
  title_he    text not null,
  title_en    text not null,
  kind        text not null,
  value       numeric not null,
  probability numeric not null,
  previous    numeric,
  webhook_url text,
  created_at  timestamptz not null default now(),
  sent_at     timestamptz,
  error       text
);
alter table public.insight_alert_queue enable row level security;
revoke all on table public.insight_alert_queue from anon, authenticated;

-- Called by ofi-runner after it stores a forecast: queue the alerts it trips, then wake the sender.
create or replace function public.ofi_queue_alerts(p_forecast bigint) returns int
language plpgsql security definer set search_path = '' as $$
declare f public.insight_forecasts%rowtype; e public.insight_events%rowtype; prev numeric; n int := 0;
begin
  select * into f from public.insight_forecasts where id = p_forecast;
  if not found then return 0; end if;
  select * into e from public.insight_events where id = f.event_id;
  if not e.is_published then return 0; end if;
  select x.probability into prev from public.insight_forecasts x
   where x.event_id = f.event_id and x.ts < f.ts order by x.ts desc limit 1;
  if prev is null then return 0; end if;

  insert into public.insight_alert_queue (alert_id, user_id, event_slug, title_he, title_en, kind, value, probability, previous, webhook_url)
  select a.id, a.user_id, e.slug, e.title_he, e.title_en, a.kind, a.value, f.probability, prev, a.webhook_url
  from public.insight_alerts a
  where a.event_id = f.event_id and a.enabled
    and public.ofi_tier_of(a.user_id) >= 2
    and ((a.kind = 'above' and prev < a.value and f.probability >= a.value)
      or (a.kind = 'below' and prev > a.value and f.probability <= a.value)
      or (a.kind = 'change' and abs(f.probability - prev) * 100 >= a.value));
  get diagnostics n = row_count;
  if n > 0 then
    update public.insight_alerts a set last_fired_at = now()
    where a.id in (select q.alert_id from public.insight_alert_queue q where q.sent_at is null);
    perform net.http_post(
      url := 'https://osintfront.com/api/ofi-alerts',
      headers := jsonb_build_object('content-type', 'application/json', 'x-push-secret', (select value from public.push_config where key = 'secret')),
      body := '{}'::jsonb,
      timeout_milliseconds := 30000);
  end if;
  return n;
end $$;
revoke all on function public.ofi_queue_alerts(bigint) from public, anon, authenticated;
grant execute on function public.ofi_queue_alerts(bigint) to service_role;

-- ── Data API: published insights (same keys, switch and limits as api_events) ────────────────
create or replace function public.api_insights(p_key text)
returns jsonb language plpgsql volatile security definer set search_path = public, extensions as $$
declare v_key api_keys; v_tier api_tiers; v_day int; v_min int;
begin
  if coalesce((select value from app_settings where key = 'api_enabled') = 'true'::jsonb, false) is not true then
    return jsonb_build_object('error', 'api_not_available', 'status', 503);
  end if;
  select * into v_key from api_keys
   where key_hash = encode(extensions.digest(coalesce(p_key, ''), 'sha256'), 'hex')
     and revoked_at is null and (expires_at is null or expires_at > now());
  if not found then return jsonb_build_object('error', 'invalid_key', 'status', 401); end if;
  select * into v_tier from api_tiers where id = v_key.tier;
  insert into api_usage_minute (key_id, minute, calls) values (v_key.id, date_trunc('minute', now()), 1)
  on conflict (key_id, minute) do update set calls = api_usage_minute.calls + 1 returning calls into v_min;
  if v_min > v_tier.per_minute then return jsonb_build_object('error', 'rate_limited', 'status', 429, 'retry_after', 60 - extract(second from now())::int); end if;
  insert into api_usage (key_id, day, calls) values (v_key.id, (now() at time zone 'UTC')::date, 1)
  on conflict (key_id, day) do update set calls = api_usage.calls + 1 returning calls into v_day;
  if v_day > v_tier.daily_limit then return jsonb_build_object('error', 'daily_limit_reached', 'status', 429); end if;
  update api_keys set last_used_at = now() where id = v_key.id;

  return jsonb_build_object(
    'disclaimer', 'Experimental statistical estimate only — not an official alert, intelligence or advice. In an emergency follow the Home Front Command.',
    'insights', coalesce((
      select jsonb_agg(jsonb_build_object(
        'slug', e.slug, 'title_en', e.title_en, 'title_he', e.title_he, 'horizon_hours', e.horizon_hours,
        'probability', f.probability, 'confidence_low', f.confidence_low, 'confidence_high', f.confidence_high,
        'updated_at', f.ts, 'next_update', e.next_run_at, 'model_version', f.model_version,
        'contributions', (select coalesce(jsonb_agg(jsonb_build_object('key', c->>'key', 'name', c->>'name_en', 'pp', (c->>'pp')::numeric)), '[]'::jsonb)
                          from jsonb_array_elements(f.contributions) c)
      ) order by e.sort)
      from insight_events e
      join lateral (select * from insight_forecasts x where x.event_id = e.id order by x.ts desc limit 1) f on true
      where e.is_published and e.status <> 'draft'), '[]'::jsonb),
    'usage', jsonb_build_object('tier', v_tier.id, 'today', v_day, 'daily_limit', v_tier.daily_limit));
end $$;
revoke all on function public.api_insights(text) from public;
grant execute on function public.api_insights(text) to anon, authenticated;

-- Admin: resolve a 24 h window ("did it happen?") — links the estimate that covered it.
create or replace function public.ofi_admin_resolve(p_slug text, p_start timestamptz, p_outcome boolean, p_notes text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare e public.insight_events%rowtype; fid bigint;
begin
  if not public.is_super_admin() then raise exception 'not allowed'; end if;
  select * into e from public.insight_events where slug = p_slug;
  if not found then raise exception 'unknown event'; end if;
  select id into fid from public.insight_forecasts where event_id = e.id and ts <= p_start order by ts desc limit 1;
  insert into public.insight_resolutions (event_id, window_start, window_end, outcome, forecast_id, notes, resolved_by)
  values (e.id, p_start, p_start + make_interval(hours => e.horizon_hours), p_outcome, fid, left(p_notes, 500), auth.uid())
  on conflict (event_id, window_start) do update set outcome = excluded.outcome, forecast_id = excluded.forecast_id, notes = excluded.notes;
  return jsonb_build_object('ok', true, 'forecast_id', fid);
end $$;
revoke all on function public.ofi_admin_resolve(text, timestamptz, boolean, text) from public, anon;
grant execute on function public.ofi_admin_resolve(text, timestamptz, boolean, text) to authenticated;
