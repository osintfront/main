-- OFI: the base rate (how often this happens on an ordinary day) is shown to every registered user
-- who sees the estimate, so the page can say "x times the usual". It is a published model constant,
-- not sensitive. Everything else in these functions is unchanged.

create or replace function public.ofi_detail(p_slug text)
returns jsonb language plpgsql stable security definer set search_path = '' as $function$
declare
  t smallint := public.ofi_tier();
  e public.insight_events%rowtype;
  f public.insight_forecasts%rowtype;
  prev numeric;
  sees boolean;
  pro boolean;
  contribs jsonb;
begin
  if t = 0 then return null; end if;
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
    'base_rate', case when sees then e.base_rate end,
    'summary_he', case when pro then f.summary_he end,
    'summary_en', case when pro then f.summary_en end,
    'signal_count', jsonb_array_length(contribs),
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
end $function$;

create or replace function public.ofi_list()
returns jsonb language plpgsql stable security definer set search_path = '' as $function$
declare t smallint := public.ofi_tier();
begin
  if t = 0 then return '[]'::jsonb; end if;
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
      'base_rate', case when t >= e.min_tier then e.base_rate end,
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
end $function$;
