-- Home Front Command alerts → permanent feed events.
--
-- Until now a live alert lived only on its 10-minute map timer and left nothing in the feed or the
-- archive. Now every alert wave becomes one published event (category home-front-alerts) that stays
-- in the feed and moves to the archive like any other event:
--   * a wave = alerts of the same threat within 5 minutes of each other (any areas);
--   * the event lists all the wave's areas, with a pin per area, Hebrew + English text;
--   * the alert rows point to it (hfc_alerts.event_id).
-- These events are marked ai_suggestions.hfc_auto = true so events_hfc_alert does not turn them back
-- into new map alerts (that path is for events an editor writes by hand).
-- Drills and alerts that came from an editor's event ('event:<id>') are skipped.

create or replace function public.hfc_threat_label(p_threat integer, p_lang text)
returns text language sql immutable set search_path = '' as $$
  select case when p_lang = 'en' then
    case p_threat when 0 then 'Rockets and missiles' when 1 then 'Hazardous materials' when 2 then 'Terrorist infiltration'
      when 3 then 'Earthquake' when 4 then 'Tsunami' when 5 then 'Hostile aircraft intrusion' when 6 then 'Radiological event'
      when 7 then 'Non-conventional weapons' else 'Alert' end
  else
    case p_threat when 0 then 'ירי רקטות וטילים' when 1 then 'חומרים מסוכנים' when 2 then 'חדירת מחבלים'
      when 3 then 'רעידת אדמה' when 4 then 'צונאמי' when 5 then 'חדירת כלי טיס עוין' when 6 then 'אירוע רדיולוגי'
      when 7 then 'נשק לא קונבנציונלי' else 'התרעה' end
  end
$$;

/** Rewrite a wave event's text, areas and pins from the alerts linked to it. */
create or replace function public.hfc_wave_refresh(p_event uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_threat integer;
  v_first timestamptz;
  v_last timestamptz;
  v_he text[];
  v_en text[];
  v_locs jsonb;
  n integer;
  t_he text;
  t_en text;
  list_he text;
  list_en text;
  when_he text;
  when_en text;
  title_he text;
  title_en text;
  desc_he text;
  desc_en text;
begin
  select min(a.threat), min(a.alerted_at), max(a.alerted_at) into v_threat, v_first, v_last
  from public.hfc_alerts a where a.event_id = p_event;
  if v_first is null then return; end if;

  -- areas in the order they were alerted
  select array_agg(x.area_name order by x.at), array_agg(coalesce(nullif(x.name_en, ''), x.area_name) order by x.at),
         coalesce(jsonb_agg(jsonb_build_object(
           'name', x.area_name, 'name_en', coalesce(nullif(x.name_en, ''), x.area_name),
           'lat', round(x.lat::numeric, 5), 'lng', round(x.lng::numeric, 5),
           'precision', 'city', 'category_slug', 'home-front-alerts') order by x.at) filter (where x.lat is not null), '[]'::jsonb)
    into v_he, v_en, v_locs
  from (
    select a.area_name, min(a.alerted_at) at, max(h.name_en) name_en,
           max(coalesce(h.latitude, extensions.st_y(extensions.st_pointonsurface(h.geom)))) lat,
           max(coalesce(h.longitude, extensions.st_x(extensions.st_pointonsurface(h.geom)))) lng
    from public.hfc_alerts a left join public.hfc_areas h on h.name = a.area_name
    where a.event_id = p_event
    group by a.area_name
  ) x;

  n := cardinality(v_he);
  t_he := public.hfc_threat_label(v_threat, 'he');
  t_en := public.hfc_threat_label(v_threat, 'en');
  list_he := array_to_string(v_he[1:5], ', ') || case when n > 5 then format(' ועוד %s', n - 5) else '' end;
  list_en := array_to_string(v_en[1:5], ', ') || case when n > 5 then format(' and %s more', n - 5) else '' end;
  when_he := case when v_last - v_first < interval '1 minute'
    then 'ב-' || to_char(v_first at time zone 'Asia/Jerusalem', 'HH24:MI')
    else format('בין %s ל-%s', to_char(v_first at time zone 'Asia/Jerusalem', 'HH24:MI'), to_char(v_last at time zone 'Asia/Jerusalem', 'HH24:MI')) end;
  when_en := case when v_last - v_first < interval '1 minute'
    then 'at ' || to_char(v_first at time zone 'Asia/Jerusalem', 'HH24:MI')
    else format('between %s and %s', to_char(v_first at time zone 'Asia/Jerusalem', 'HH24:MI'), to_char(v_last at time zone 'Asia/Jerusalem', 'HH24:MI')) end;
  title_he := format('התרעת פיקוד העורף – %s: %s', t_he, list_he);
  title_en := format('Home Front Command alert – %s: %s', t_en, list_en);
  desc_he := format('%s %s (שעון ישראל) ב%s: %s.', t_he, when_he,
    case when n = 1 then 'אזור אחד' else format('-%s אזורים', n) end, array_to_string(v_he, ', '));
  desc_en := format('%s %s (Israel time) in %s: %s.', t_en, when_en,
    case when n = 1 then '1 area' else format('%s areas', n) end, array_to_string(v_en, ', '));

  update public.events e set
    title = title_he,
    description = desc_he,
    original_report_text = desc_he,
    hfc_areas = v_he,
    locations = v_locs,
    location_name_en = v_en[1],
    translations = jsonb_build_object(
      'he', jsonb_build_object('title', title_he, 'summary', desc_he),
      'en', jsonb_build_object('title', title_en, 'summary', desc_en, 'description', desc_en)),
    ai_suggestions = coalesce(e.ai_suggestions, '{}'::jsonb)
      || jsonb_build_object('hfc_auto', true, 'hfc_threat', v_threat, 'hfc_first', v_first, 'hfc_last', v_last)
  where e.id = p_event;
end $$;

/** Put one alert into its wave's event (creating the event for a new wave). Returns the event id. */
create or replace function public.hfc_alert_to_event(p_alert bigint)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  a public.hfc_alerts%rowtype;
  v_event uuid;
  v_cat uuid;
  v_area public.hfc_areas%rowtype;
begin
  select * into a from public.hfc_alerts where id = p_alert;
  if not found or a.is_drill or a.source like 'event:%' or a.event_id is not null then
    return a.event_id;
  end if;

  -- an open wave: same threat, this alert within 5 minutes of the wave's span
  select e.id into v_event
  from public.events e
  where e.deleted_at is null
    and e.ai_suggestions ->> 'hfc_auto' = 'true'
    and (e.ai_suggestions ->> 'hfc_threat')::integer = a.threat
    and e.occurred_at > a.alerted_at - interval '1 day'
    and a.alerted_at between (e.ai_suggestions ->> 'hfc_first')::timestamptz - interval '5 minutes'
                         and (e.ai_suggestions ->> 'hfc_last')::timestamptz + interval '5 minutes'
  order by e.occurred_at desc
  limit 1;

  if v_event is null then
    select id into v_cat from public.event_categories where slug = 'home-front-alerts';
    select * into v_area from public.hfc_areas where name = a.area_name;
    insert into public.events (
      title, description, original_report_text, category_id, status, severity,
      location_name, location_name_he, location_name_en, country, location_precision,
      latitude, longitude,
      source_name, source_url, source_type, occurred_at, published_at, created_by,
      is_breaking, is_verified, ai_suggestions)
    values (
      'התרעת פיקוד העורף – ' || public.hfc_threat_label(a.threat, 'he') || ': ' || a.area_name,
      public.hfc_threat_label(a.threat, 'he') || ': ' || a.area_name,
      public.hfc_threat_label(a.threat, 'he') || ': ' || a.area_name,
      v_cat, 'published',
      (case when a.threat in (0, 2, 5, 6, 7) then 'high' else 'medium' end)::public.event_severity,
      a.area_name, a.area_name, v_area.name_en, 'Israel', 'city',
      v_area.latitude, v_area.longitude,
      'פיקוד העורף', 'https://www.oref.org.il/', 'emergency_service', a.alerted_at, a.alerted_at,
      'd8d87c3a-1739-4c8a-8617-9a3d157fdc68',  -- the ingest bot user (same as whatsapp-ingest / intel-crawler)
      true, true,
      jsonb_build_object('hfc_auto', true, 'hfc_threat', a.threat, 'hfc_first', a.alerted_at, 'hfc_last', a.alerted_at))
    returning id into v_event;
  end if;

  update public.hfc_alerts set event_id = v_event where id = p_alert;
  perform public.hfc_wave_refresh(v_event);
  return v_event;
end $$;

revoke all on function public.hfc_threat_label(integer, text) from public, anon, authenticated;
revoke all on function public.hfc_wave_refresh(uuid) from public, anon, authenticated;
revoke all on function public.hfc_alert_to_event(bigint) from public, anon, authenticated;

-- Every new live alert goes to its wave's event (after the row exists, so the map logic is untouched).
create or replace function public.hfc_alerts_to_event_trg()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if not new.is_drill and new.source not like 'event:%' and new.event_id is null then
    begin
      perform public.hfc_alert_to_event(new.id);
    exception when others then
      -- never lose the alert itself because of the feed copy
      raise warning 'hfc_alert_to_event(%): %', new.id, sqlerrm;
    end;
  end if;
  return null;
end $$;

drop trigger if exists hfc_alerts_to_event on public.hfc_alerts;
create trigger hfc_alerts_to_event after insert on public.hfc_alerts
  for each row execute function public.hfc_alerts_to_event_trg();

-- Wave events are already alerts: don't record them again as new map alerts.
create or replace function public.events_hfc_alert()
returns trigger language plpgsql security definer set search_path = '' as $function$
declare
  v_threat integer;
  v_area   text;
begin
  if coalesce(new.ai_suggestions ->> 'hfc_auto', '') = 'true' then
    return null;
  end if;
  if new.status <> 'published' or new.deleted_at is not null or cardinality(new.hfc_areas) = 0 then
    return null;
  end if;
  if tg_op = 'UPDATE' and old.status = 'published' and old.deleted_at is null
     and old.hfc_areas is not distinct from new.hfc_areas then
    return null;
  end if;

  v_threat := public.hfc_guess_threat(concat_ws(' ', new.title, new.description, new.original_report_text));
  foreach v_area in array new.hfc_areas loop
    if tg_op = 'UPDATE' and old.status = 'published' and old.deleted_at is null and v_area = any (old.hfc_areas) then
      continue;
    end if;
    perform public.hfc_record_alert(v_area, v_threat, now(), false, 'event:' || new.id);
  end loop;
  update public.hfc_alerts set event_id = new.id where source = 'event:' || new.id and event_id is null;
  return null;
end;
$function$;

-- Backfill: real live alerts since October 2026 that have no event yet (older rows are test data).
do $$
declare r record;
begin
  for r in
    select id from public.hfc_alerts
    where not is_drill and source not like 'event:%' and event_id is null and alerted_at >= '2026-10-01'
    order by alerted_at, id
  loop
    perform public.hfc_alert_to_event(r.id);
  end loop;
end $$;
