-- OFI phase 2: counts from our own collected events and Home Front Command alerts, computed in the
-- database (no event text leaves it). Pure counting with the admin-editable lexicon — no LLM.
-- p_at lets the backtest (phase 6) ask "what did the data look like at that moment".
--
-- An event is "about" the insight when its text contains one of insight_events.keywords.
-- Window = the 24 h before p_at; baseline = the 7 days before the window (daily average).
-- Per lexicon category: weighted hits (per event capped at 3) and event counts in the window, and
-- the same as daily averages over the baseline (b_*) — both among the events about the insight and
-- among all events (the adapter picks by config.require_entity).

create or replace function public.ofi_internal_stats(p_event uuid, p_at timestamptz default now())
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  kw text[];
  base jsonb;
  cats jsonb;
  hfc jsonb;
begin
  select array(select lower(k) from unnest(e.keywords) k where length(k) > 1) into kw
  from public.insight_events e where e.id = p_event;
  if kw is null then return null; end if;

  create temporary table if not exists _ofi_ev (
    id uuid, occurred_at timestamptz, severity text, hay text, recent boolean, about boolean
  ) on commit drop;
  truncate _ofi_ev;
  insert into _ofi_ev
  select x.id, x.occurred_at, x.severity::text,
         lower(concat_ws(' ', x.title, x.description, x.original_report_text, x.translations::text)),
         x.occurred_at > p_at - interval '24 hours', false
  from public.events x
  where x.deleted_at is null and x.status::text in ('published', 'archived')
    and x.occurred_at > p_at - interval '8 days' and x.occurred_at <= p_at;
  -- (a WHERE clause is required: API callers run with safe-update protection)
  update _ofi_ev v set about = true where exists (select 1 from unnest(kw) k where v.hay like '%' || k || '%');

  select jsonb_build_object(
    'events_24h', count(*) filter (where recent),
    'matched_24h', count(*) filter (where recent and about),
    'baseline_daily', round(count(*) filter (where not recent and about)::numeric / 7, 3),
    'high_24h', count(*) filter (where recent and about and severity in ('high', 'critical')),
    'base_high_share', round(coalesce(
       (count(*) filter (where not recent and about and severity in ('high', 'critical')))::numeric
       / nullif(count(*) filter (where not recent and about), 0), 0), 4)
  ) into base from _ofi_ev;

  with lex as (
    select lower(l.term) term, l.category, l.weight
    from public.insight_lexicon l where l.event_id = p_event and l.enabled
  ), per as (
    select v.id, v.about, v.recent, l.category, least(sum(l.weight), 3) w
    from _ofi_ev v join lex l on v.hay like '%' || l.term || '%'
    group by v.id, v.about, v.recent, l.category
  ), agg as (
    select category,
           jsonb_build_object(
             'w_about', round(coalesce(sum(w) filter (where recent and about), 0), 3),
             'n_about', count(*) filter (where recent and about),
             'w_any', round(coalesce(sum(w) filter (where recent), 0), 3),
             'n_any', count(*) filter (where recent),
             -- daily averages over the 7-day baseline
             'b_w_about', round(coalesce(sum(w) filter (where not recent and about), 0) / 7, 3),
             'b_n_about', round((count(*) filter (where not recent and about))::numeric / 7, 3),
             'b_w_any', round(coalesce(sum(w) filter (where not recent), 0) / 7, 3),
             'b_n_any', round((count(*) filter (where not recent))::numeric / 7, 3)) j
    from per group by category
  )
  select coalesce(jsonb_object_agg(category, j), '{}'::jsonb) into cats from agg;

  -- HFC: alert waves (clusters, or minutes when unclustered), drills excluded.
  select jsonb_build_object(
    'waves_24h', count(distinct coalesce(a.cluster_id::text, to_char(date_trunc('minute', a.alerted_at), 'YYYYMMDDHH24MI')))
                   filter (where a.alerted_at > p_at - interval '24 hours'),
    'baseline_daily', round(count(distinct coalesce(a.cluster_id::text, to_char(date_trunc('minute', a.alerted_at), 'YYYYMMDDHH24MI')))
                   filter (where a.alerted_at <= p_at - interval '24 hours')::numeric / 7, 3),
    'last_alert', max(a.alerted_at)
  ) into hfc
  from public.hfc_alerts a
  where not a.is_drill and a.alerted_at > p_at - interval '8 days' and a.alerted_at <= p_at;

  return base || jsonb_build_object('categories', cats, 'hfc', hfc, 'at', p_at);
end $$;

revoke all on function public.ofi_internal_stats(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.ofi_internal_stats(uuid, timestamptz) to service_role;

-- Counts are compared with their own 7-day baseline (an absolute count saturates on a busy front).
update public.insight_signals s set normalization = '{"method":"ratio_vs_baseline"}'::jsonb
from public.insight_events e
where e.id = s.event_id and e.slug = 'iran-direct-confrontation'
  and s.key in ('iran_intercepts', 'proxy_attributed', 'airspace_closure', 'leader_rhetoric')
  and s.normalization ->> 'method' = 'count_saturation';
update public.insight_signals s set normalization = '{"method":"lexicon_balance_vs_baseline"}'::jsonb
from public.insight_events e
where e.id = s.event_id and e.slug = 'iran-direct-confrontation' and s.key = 'internal_escalation';
update public.insight_signals s set normalization = '{"method":"share_shift"}'::jsonb
from public.insight_events e
where e.id = s.event_id and e.slug = 'iran-direct-confrontation' and s.key = 'severity_mix';

-- Polymarket anchor: no direct "confrontation within 24 h" market exists; the closest are the
-- ceasefire markets — a breakdown is the event, so they are inverted (1 − P(yes)). Admin can change.
-- Fetched through the public search ("iran"): one call that also serves markets /markets?slug= omits.
update public.insight_signals s set config = '{"search":"iran","markets":[
  {"slug":"israel-x-iran-ceasefire-continues-through-november-30","invert":true},
  {"slug":"us-x-iran-effective-ceasefire-continues-through-november-30-20261103","invert":true}]}'::jsonb
from public.insight_events e
where e.id = s.event_id and e.slug = 'iran-direct-confrontation' and s.key = 'polymarket';
