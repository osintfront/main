-- OFI Insights, phase 1: schema, RLS, tier gating, seed of the first insight event.
--
-- Admin-defined events with an estimated probability that they happen within the next
-- horizon_hours, explained by weighted signals. The probability engine (phase 3) runs with the
-- service role; readers never touch these tables directly — they call the ofi_* functions below,
-- which return only what the reader's plan allows (locked data never leaves the database).
--
-- Tiers (ofi_tier): 0 = guest / no access, 1 = basic (Free), 2 = Pro, 3 = Max (and staff).
-- Driven by plan_features rows insights_basic / insights_pro / insights_max.

-- ── Tables ──────────────────────────────────────────────────────────────────────────────
create table if not exists public.insight_events (
  id                     uuid primary key default gen_random_uuid(),
  slug                   text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{2,59}$'),
  title_he               text not null check (length(title_he) between 3 and 200),
  title_en               text not null check (length(title_en) between 3 and 200),
  description_he         text,
  description_en         text,
  resolution_criteria_he text not null,
  resolution_criteria_en text not null,
  horizon_hours          int not null default 24 check (horizon_hours between 1 and 720),
  refresh_interval_hours int not null default 24 check (refresh_interval_hours between 1 and 168),
  next_run_at            timestamptz not null default now(),
  last_run_at            timestamptz,
  status                 text not null default 'draft' check (status in ('draft', 'active', 'paused', 'resolved')),
  base_rate              numeric not null default 0.02 check (base_rate > 0 and base_rate < 1),
  -- Entity terms that make one of our collected events "about" this insight (prefilter).
  keywords               text[] not null default '{}',
  -- Lowest tier that sees the number (3 = Max early access to a new event).
  min_tier               smallint not null default 1 check (min_tier between 1 and 3),
  is_published           boolean not null default false,
  sort                   int not null default 0,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

create table if not exists public.insight_signals (
  id                 uuid primary key default gen_random_uuid(),
  event_id           uuid not null references public.insight_events(id) on delete cascade,
  key                text not null check (key ~ '^[a-z0-9_]{2,60}$'),
  source_type        text not null check (source_type in
                       ('internal_events', 'hfc', 'polymarket', 'finance', 'advisory',
                        'notam', 'gdelt', 'trends', 'shipping', 'rhetoric')),
  name_he            text not null,
  name_en            text not null,
  weight             numeric not null default 1 check (weight >= 0 and weight <= 10),
  -- +1: a high score raises the probability; -1: a high score lowers it.
  direction          smallint not null default 1 check (direction in (-1, 1)),
  normalization      jsonb not null default '{}'::jsonb,   -- how raw → 0..1 (method + parameters)
  config             jsonb not null default '{}'::jsonb,   -- source parameters (symbols, market, URLs…)
  enabled            boolean not null default true,
  is_circuit_breaker boolean not null default false,       -- may override smoothing when it fires
  stale_after_hours  int not null default 48 check (stale_after_hours between 1 and 720),
  last_updated       timestamptz,
  last_error         text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (event_id, key)
);

create table if not exists public.insight_signal_readings (
  id               bigint generated always as identity primary key,
  signal_id        uuid not null references public.insight_signals(id) on delete cascade,
  ts               timestamptz not null default now(),
  raw_value        numeric,
  normalized_score numeric not null check (normalized_score >= 0 and normalized_score <= 1),
  metadata         jsonb not null default '{}'::jsonb
);
create index if not exists insight_signal_readings_signal_ts on public.insight_signal_readings (signal_id, ts desc);

create table if not exists public.insight_forecasts (
  id              bigint generated always as identity primary key,
  event_id        uuid not null references public.insight_events(id) on delete cascade,
  ts              timestamptz not null default now(),
  probability     numeric not null check (probability >= 0.01 and probability <= 0.95),
  confidence_low  numeric check (confidence_low >= 0 and confidence_low <= 1),
  confidence_high numeric check (confidence_high >= 0 and confidence_high <= 1),
  -- [{key, name_he, name_en, source_type, score, weight, pp, stale}] — pp = percentage points.
  contributions   jsonb not null default '[]'::jsonb,
  model_version   text not null,
  trigger         text not null default 'schedule' check (trigger in ('schedule', 'manual', 'circuit_breaker')),
  summary_he      text,
  summary_en      text
);
create index if not exists insight_forecasts_event_ts on public.insight_forecasts (event_id, ts desc);

create table if not exists public.insight_resolutions (
  id           bigint generated always as identity primary key,
  event_id     uuid not null references public.insight_events(id) on delete cascade,
  window_start timestamptz not null,
  window_end   timestamptz not null check (window_end > window_start),
  outcome      boolean not null,
  -- The forecast that covered this window (the last one made before window_start).
  forecast_id  bigint references public.insight_forecasts(id) on delete set null,
  notes        text,
  resolved_by  uuid references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now(),
  unique (event_id, window_start)
);

-- Weighted terms for scoring our own collected events (admin-editable, no LLM).
create table if not exists public.insight_lexicon (
  id         bigint generated always as identity primary key,
  event_id   uuid not null references public.insight_events(id) on delete cascade,
  term       text not null check (length(term) between 1 and 120),
  lang       text not null default 'any' check (lang in ('he', 'en', 'ar', 'fa', 'any')),
  category   text not null check (category in ('escalation', 'de_escalation', 'intercept', 'proxy', 'airspace', 'threat')),
  weight     numeric not null default 1 check (weight > 0 and weight <= 10),
  enabled    boolean not null default true,
  created_at timestamptz not null default now(),
  unique (event_id, term, category)
);

-- One cached response per external source and cycle (phase 2 adapters).
create table if not exists public.insight_source_cache (
  key          text primary key,
  fetched_at   timestamptz not null default now(),
  content_hash text,
  status       int,
  body         jsonb
);

-- updated_at upkeep (the trigger function exists since the initial schema).
drop trigger if exists insight_events_updated_at on public.insight_events;
create trigger insight_events_updated_at before update on public.insight_events
  for each row execute function public.set_updated_at();
drop trigger if exists insight_signals_updated_at on public.insight_signals;
create trigger insight_signals_updated_at before update on public.insight_signals
  for each row execute function public.set_updated_at();

-- ── RLS: only the super admin reads or writes the tables; everyone else uses ofi_* ──────────
do $$
declare t text;
begin
  foreach t in array array['insight_events', 'insight_signals', 'insight_signal_readings', 'insight_forecasts',
                           'insight_resolutions', 'insight_lexicon', 'insight_source_cache'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from anon', t);
    execute format('drop policy if exists "ofi: super admin" on public.%I', t);
    execute format('create policy "ofi: super admin" on public.%I for all to authenticated
                    using (public.is_super_admin()) with check (public.is_super_admin())', t);
  end loop;
end $$;

-- ── Tier gating ─────────────────────────────────────────────────────────────────────────
insert into public.plan_features (feature_key, plan_id, enabled, limit_value, note)
select k, p.id,
       case k when 'insights_basic' then p.id in ('free', 'pro', 'max', 'intel')
              when 'insights_pro'   then p.id in ('pro', 'max', 'intel')
              else p.id in ('max', 'intel') end,
       null, 'OFI Insights'
from public.plans p cross join unnest(array['insights_basic', 'insights_pro', 'insights_max']) k
on conflict (feature_key, plan_id) do nothing;

create or replace function public.ofi_tier() returns smallint
language sql stable security definer set search_path = '' as $$
  select (case
    when pr.id is null or pr.status <> 'active' then 0
    when pr.role <> 'viewer' then 3                                   -- staff: everything
    when not coalesce((select s.value = 'true'::jsonb from public.app_settings s where s.key = 'enforce_plans'), false) then 3
    else coalesce((
      select max(case f.feature_key when 'insights_max' then 3 when 'insights_pro' then 2 else 1 end)
      from public.plan_features f
      where f.enabled and f.feature_key in ('insights_basic', 'insights_pro', 'insights_max')
        and f.plan_id = case when pr.plan <> 'free' and pr.plan_expires_at is not null and pr.plan_expires_at < now()
                             then 'free' else pr.plan end), 0)
  end)::smallint
  from (select 1) one left join public.profiles pr on pr.id = auth.uid();
$$;

-- Cards of the Insights page. Probability only for tiers that may see it; history (sparkline) Pro+.
create or replace function public.ofi_list() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare t smallint := public.ofi_tier();
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'slug', e.slug,
      'title_he', e.title_he,
      'title_en', e.title_en,
      'horizon_hours', e.horizon_hours,
      'status', e.status,
      'min_tier', e.min_tier,
      'tier', t,
      'locked', t < e.min_tier,
      'last_update', f.ts,
      'next_update', case when e.status = 'active' then e.next_run_at end,
      'probability', case when t >= e.min_tier then f.probability end,
      'previous_probability', case when t >= e.min_tier then fp.probability end,
      'spark', case when t >= greatest(e.min_tier, 2) then (
        select jsonb_agg(jsonb_build_array(h.ts, h.probability) order by h.ts)
        from public.insight_forecasts h where h.event_id = e.id and h.ts > now() - interval '30 days') end
    ) order by e.sort, e.created_at)
    from public.insight_events e
    left join lateral (select x.ts, x.probability from public.insight_forecasts x
                       where x.event_id = e.id order by x.ts desc limit 1) f on true
    left join lateral (select x.probability from public.insight_forecasts x
                       where x.event_id = e.id order by x.ts desc offset 1 limit 1) fp on true
    where e.is_published and e.status <> 'draft'
  ), '[]'::jsonb);
end $$;

-- One insight in detail. Free: number + trend + one teaser signal. Pro: band, all signals with
-- weights and 30 days of readings, summary, 30 days of history. Max: full history.
create or replace function public.ofi_detail(p_slug text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  t smallint := public.ofi_tier();
  e public.insight_events%rowtype;
  f public.insight_forecasts%rowtype;
  prev numeric;
  sees boolean;
  pro boolean;
  contribs jsonb;
begin
  select * into e from public.insight_events where slug = p_slug;
  if not found or ((not e.is_published or e.status = 'draft') and not public.is_super_admin()) then
    return null;
  end if;
  sees := t >= e.min_tier;
  pro := t >= greatest(e.min_tier, 2);
  select * into f from public.insight_forecasts where event_id = e.id order by ts desc limit 1;
  select x.probability into prev from public.insight_forecasts x where x.event_id = e.id order by x.ts desc offset 1 limit 1;
  contribs := coalesce(f.contributions, '[]'::jsonb);

  return jsonb_build_object(
    'slug', e.slug,
    'title_he', e.title_he, 'title_en', e.title_en,
    'description_he', e.description_he, 'description_en', e.description_en,
    'resolution_criteria_he', e.resolution_criteria_he, 'resolution_criteria_en', e.resolution_criteria_en,
    'horizon_hours', e.horizon_hours,
    'status', e.status,
    'tier', t,
    'min_tier', e.min_tier,
    'locked', not sees,
    'last_update', f.ts,
    'next_update', case when e.status = 'active' then e.next_run_at end,
    'model_version', case when sees then f.model_version end,
    'probability', case when sees then f.probability end,
    'previous_probability', case when sees then prev end,
    'confidence_low', case when pro then f.confidence_low end,
    'confidence_high', case when pro then f.confidence_high end,
    'base_rate', case when pro then e.base_rate end,
    'summary_he', case when pro then f.summary_he end,
    'summary_en', case when pro then f.summary_en end,
    'signal_count', jsonb_array_length(contribs),
    -- Free gets one signal (the largest contribution) as a teaser; Pro+ gets all of them.
    'contributions', case
      when pro then contribs
      when sees then coalesce((select jsonb_build_array(c) from jsonb_array_elements(contribs) c
                               order by abs(coalesce((c->>'pp')::numeric, 0)) desc limit 1), '[]'::jsonb)
      else '[]'::jsonb end,
    'signals', case when pro then (
      select coalesce(jsonb_agg(jsonb_build_object(
        'key', s.key, 'source_type', s.source_type, 'name_he', s.name_he, 'name_en', s.name_en,
        'weight', s.weight, 'direction', s.direction, 'is_circuit_breaker', s.is_circuit_breaker,
        'last_updated', s.last_updated,
        'stale', s.last_updated is null or s.last_updated < now() - make_interval(hours => s.stale_after_hours),
        'readings', (select coalesce(jsonb_agg(jsonb_build_array(r.ts, r.normalized_score) order by r.ts), '[]'::jsonb)
                     from public.insight_signal_readings r
                     where r.signal_id = s.id and r.ts > now() - interval '30 days')
      ) order by s.weight desc, s.key), '[]'::jsonb)
      from public.insight_signals s where s.event_id = e.id and s.enabled) end,
    'history', case when pro then (
      select coalesce(jsonb_agg(jsonb_build_object('ts', h.ts, 'p', h.probability, 'trigger', h.trigger) order by h.ts), '[]'::jsonb)
      from public.insight_forecasts h
      where h.event_id = e.id and (t >= 3 or h.ts > now() - interval '30 days')) end
  );
end $$;

-- Public track record: past windows that were resolved, the estimate that covered each, the outcome
-- and the Brier score. Only closed windows, so it never reveals a current estimate.
create or replace function public.ofi_track_record(p_slug text) returns jsonb
language sql stable security definer set search_path = '' as $$
  with ev as (
    select id from public.insight_events
    where slug = p_slug and is_published and status <> 'draft'
  ), rows as (
    select r.window_start, r.window_end, r.outcome, f.probability
    from public.insight_resolutions r
    join ev on ev.id = r.event_id
    left join public.insight_forecasts f on f.id = r.forecast_id
    where r.window_end < now()
  )
  select case when not exists (select 1 from ev) then null else jsonb_build_object(
    'n', (select count(*) from rows where probability is not null),
    'brier', (select round(avg(power(probability - case when outcome then 1 else 0 end, 2)), 4)
              from rows where probability is not null),
    'windows', (select coalesce(jsonb_agg(jsonb_build_object('start', window_start, 'end', window_end,
                                                             'p', probability, 'outcome', outcome)
                                          order by window_start desc), '[]'::jsonb) from rows)
  ) end;
$$;

revoke all on function public.ofi_tier() from public;
revoke all on function public.ofi_list() from public;
revoke all on function public.ofi_detail(text) from public;
revoke all on function public.ofi_track_record(text) from public;
grant execute on function public.ofi_tier() to anon, authenticated;
grant execute on function public.ofi_list() to anon, authenticated;
grant execute on function public.ofi_detail(text) to anon, authenticated;
grant execute on function public.ofi_track_record(text) to anon, authenticated;

-- ── Seed: the first insight event ───────────────────────────────────────────────────────
-- Base rate 2% per 24 h: ~16 days of direct Israel/US–Iran exchanges in ~900 days (2024 – mid 2026).
-- Kept unpublished until the engine (phase 3) has produced a first forecast.
insert into public.insight_events
  (slug, title_he, title_en, description_he, description_en, resolution_criteria_he, resolution_criteria_en,
   horizon_hours, refresh_interval_hours, status, base_rate, keywords, min_tier, is_published, sort)
values (
  'iran-direct-confrontation',
  'עימות צבאי ישיר בין ישראל/ארה"ב לאיראן ב-24 השעות הקרובות',
  'Direct military confrontation between Israel/US and Iran within the next 24h',
  'הערכת הסבירות לחילופי אש ישירים בין ישראל או ארה"ב לבין איראן.',
  'Estimated likelihood of a direct exchange of fire between Israel or the US and Iran.',
  'מתקיים אם בתוך חלון ה-24 שעות: צה"ל או כוחות ארה"ב תוקפים יעד בשטח איראן, או שאיראן משגרת טילים או כלי טיס בלתי מאוישים ישירות משטחה לעבר ישראל או לעבר יעד אמריקאי. יירוט של כלי טיס איראני בדרך ופעולות של שלוחים (חיזבאללה, החות''ים ואחרים) אינם נחשבים כהתרחשות – הם משמשים כאותות בלבד.',
  'Resolves YES if, within the 24h window, the IDF or US forces strike a target on Iranian territory, or Iran launches missiles or drones directly from its territory at Israel or at a US target. Interceptions of Iranian projectiles en route and actions by proxies (Hezbollah, the Houthis and others) do not count as occurrence — they are signals only.',
  24, 24, 'active', 0.02,
  array['איראן', 'איראני', 'איראנית', 'טהרן', 'משמרות המהפכה', 'חמינאי',
        'Iran', 'Iranian', 'Tehran', 'IRGC', 'Khamenei',
        'إيران', 'الإيراني', 'طهران', 'الحرس الثوري', 'خامنئي'],
  1, false, 0)
on conflict (slug) do nothing;

-- Signals. Weights are starting values, to be tuned by the backtest (phase 6).
insert into public.insight_signals
  (event_id, key, source_type, name_he, name_en, weight, direction, normalization, config, enabled, is_circuit_breaker, stale_after_hours)
select e.id, s.key, s.source_type, s.name_he, s.name_en, s.weight, s.direction, s.normalization::jsonb, s.config::jsonb,
       s.enabled, s.breaker, s.stale
from public.insight_events e
cross join (values
  -- A. Our collected events (no external API)
  ('internal_volume',     'internal_events', 'נפח אירועים הקשורים לאיראן',      'Iran-related event volume',               1.0, 1, '{"method":"ratio_vs_baseline","baseline_days":7}', '{}', true, false, 3),
  ('internal_escalation', 'internal_events', 'מילון הסלמה מול הרגעה',          'Escalation vs. de-escalation lexicon',    1.5, 1, '{"method":"lexicon_balance"}', '{"categories":["escalation","de_escalation"]}', true, false, 3),
  ('iran_intercepts',     'internal_events', 'יירוט כלי טיס איראני',            'Interceptions of Iranian projectiles',    2.0, 1, '{"method":"count_saturation","half":2}', '{"categories":["intercept"],"require_entity":true}', true, false, 3),
  ('proxy_attributed',    'internal_events', 'פעולת שלוחים בייחוס איראני',       'Iran-attributed proxy activity',          1.0, 1, '{"method":"count_saturation","half":3}', '{"categories":["proxy"],"require_entity":true}', true, false, 3),
  ('severity_mix',        'internal_events', 'תמהיל חומרה',                     'Severity mix',                            0.7, 1, '{"method":"share_high_critical"}', '{}', true, false, 3),
  ('airspace_closure',    'internal_events', 'סגירת מרחב אווירי',               'Airspace closure',                        2.5, 1, '{"method":"count_saturation","half":1}', '{"categories":["airspace"]}', true, true, 3),
  ('hfc_alerts',          'hfc',             'התרעות פיקוד העורף',              'Home Front Command alerts',               1.0, 1, '{"method":"ratio_vs_baseline","baseline_days":7}', '{}', true, true, 3),
  -- B. Prediction market (anchor; the market is chosen in the admin page)
  ('polymarket',          'polymarket',      'שוק תחזיות (Polymarket)',         'Prediction market (Polymarket)',          1.0, 1, '{"method":"market_anchor","alpha":0.5}', '{"market_slug":null}', true, false, 48),
  -- C. Financial war signals (z-score vs. 30-day rolling volatility)
  ('finance_defense',     'finance',         'מניות ביטחוניות',                 'Defense stocks (LMT, RTX, NOC, ESLT)',    0.5, 1, '{"method":"zscore","window_days":30}', '{"symbols":["LMT","RTX","NOC","ESLT"]}', true, false, 96),
  ('finance_haven',       'finance',         'נפט, זהב ותנודתיות',              'Oil, gold & volatility (Brent, gold, VIX)', 0.5, 1, '{"method":"zscore","window_days":30}', '{"symbols":["BRENT","GOLD","VIX"]}', true, false, 96),
  ('finance_usdils',      'finance',         'שער דולר-שקל',                    'USD/ILS',                                 0.3, 1, '{"method":"zscore","window_days":30}', '{"symbols":["USDILS"]}', true, false, 96),
  -- D. Official signals (page hash; only a change in level scores)
  ('advisory_us',         'advisory',        'אזהרת מסע – ארה"ב',               'US State Dept travel advisory',           0.8, 1, '{"method":"level_change"}', '{"country":"US"}', true, false, 72),
  ('advisory_uk',         'advisory',        'אזהרת מסע – בריטניה',             'UK FCDO travel advice',                   0.8, 1, '{"method":"level_change"}', '{"country":"UK"}', true, false, 72),
  ('advisory_il',         'advisory',        'אזהרות מסע – המל"ל',              'Israeli NSC travel warnings',             0.8, 1, '{"method":"level_change"}', '{"country":"IL"}', true, false, 72),
  -- Optional, off by default
  ('notam_airspace',      'notam',           'הודעות NOTAM ומרחב אווירי',        'NOTAMs / airspace',                       1.0, 1, '{"method":"count_saturation","half":2}', '{}', false, true, 24),
  ('gdelt_tone',          'gdelt',           'נפח וטון בחדשות (GDELT)',          'News volume & tone (GDELT)',              0.5, 1, '{"method":"zscore","window_days":30}', '{}', false, false, 48),
  ('google_trends',       'trends',          'חיפושים ב-Google Trends',          'Google Trends searches',                  0.3, 1, '{"method":"zscore","window_days":30}', '{}', false, false, 48),
  ('shipping_disruption', 'shipping',        'שיבושי שיט',                      'Shipping disruption',                     0.5, 1, '{"method":"zscore","window_days":30}', '{}', false, false, 72),
  ('leader_rhetoric',     'rhetoric',        'רטוריקת מנהיגים',                 'Leader rhetoric',                         0.5, 1, '{"method":"count_saturation","half":3}', '{"categories":["threat"],"require_entity":true}', false, false, 24)
) as s(key, source_type, name_he, name_en, weight, direction, normalization, config, enabled, breaker, stale)
where e.slug = 'iran-direct-confrontation'
on conflict (event_id, key) do nothing;

-- Lexicon (admin-editable). Matching is case-insensitive substring in phase 2.
insert into public.insight_lexicon (event_id, term, lang, category, weight)
select e.id, l.term, l.lang, l.category, l.weight
from public.insight_events e
cross join (values
  ('טיל בליסטי', 'he', 'escalation', 1.5), ('ballistic missile', 'en', 'escalation', 1.5), ('صاروخ باليستي', 'ar', 'escalation', 1.5),
  ('תקיפה באיראן', 'he', 'escalation', 2.0), ('strike on Iran', 'en', 'escalation', 2.0), ('ضربة على إيران', 'ar', 'escalation', 2.0),
  ('שיגור', 'he', 'escalation', 1.0), ('launch', 'en', 'escalation', 1.0), ('إطلاق', 'ar', 'escalation', 1.0),
  ('כוננות', 'he', 'escalation', 0.8), ('high alert', 'en', 'escalation', 0.8), ('حالة تأهب', 'ar', 'escalation', 0.8),
  ('פינוי', 'he', 'escalation', 1.0), ('evacuation', 'en', 'escalation', 1.0), ('إخلاء', 'ar', 'escalation', 1.0),
  ('נושאת מטוסים', 'he', 'escalation', 0.8), ('aircraft carrier', 'en', 'escalation', 0.8), ('حاملة طائرات', 'ar', 'escalation', 0.8),
  ('מטוסי תדלוק', 'he', 'escalation', 0.8), ('tanker aircraft', 'en', 'escalation', 0.8),
  ('הפסקת אש', 'he', 'de_escalation', 1.5), ('ceasefire', 'en', 'de_escalation', 1.5), ('وقف إطلاق النار', 'ar', 'de_escalation', 1.5),
  ('משא ומתן', 'he', 'de_escalation', 1.0), ('negotiations', 'en', 'de_escalation', 1.0), ('مفاوضات', 'ar', 'de_escalation', 1.0),
  ('ריסון', 'he', 'de_escalation', 1.0), ('restraint', 'en', 'de_escalation', 1.0), ('ضبط النفس', 'ar', 'de_escalation', 1.0),
  ('הסכם', 'he', 'de_escalation', 0.8), ('agreement', 'en', 'de_escalation', 0.8), ('اتفاق', 'ar', 'de_escalation', 0.8),
  ('יירוט', 'he', 'intercept', 1.0), ('intercept', 'en', 'intercept', 1.0), ('اعتراض', 'ar', 'intercept', 1.0),
  ('כטב"ם', 'he', 'intercept', 1.0), ('UAV', 'en', 'intercept', 1.0), ('drone', 'en', 'intercept', 0.8), ('مسيرة', 'ar', 'intercept', 1.0),
  ('חיזבאללה', 'he', 'proxy', 1.0), ('Hezbollah', 'en', 'proxy', 1.0), ('حزب الله', 'ar', 'proxy', 1.0),
  ('חות''ים', 'he', 'proxy', 1.0), ('Houthi', 'en', 'proxy', 1.0), ('الحوثي', 'ar', 'proxy', 1.0),
  ('מיליציות בעיראק', 'he', 'proxy', 0.8), ('Iraqi militia', 'en', 'proxy', 0.8),
  ('סגירת המרחב האווירי', 'he', 'airspace', 3.0), ('airspace closed', 'en', 'airspace', 3.0), ('airspace closure', 'en', 'airspace', 3.0),
  ('إغلاق المجال الجوي', 'ar', 'airspace', 3.0), ('NOTAM', 'en', 'airspace', 1.0),
  ('נקמה', 'he', 'threat', 1.0), ('revenge', 'en', 'threat', 1.0), ('انتقام', 'ar', 'threat', 1.0),
  ('תגובה קשה', 'he', 'threat', 1.0), ('harsh response', 'en', 'threat', 1.0), ('رد قاس', 'ar', 'threat', 1.0)
) as l(term, lang, category, weight)
where e.slug = 'iran-direct-confrontation'
on conflict (event_id, term, category) do nothing;
