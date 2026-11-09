-- Follow-up to 094: the alert-wave events were created but hidden.
--  * published_events hides events that carry hfc_areas (those are an editor's manual alerts, shown
--    as live alert polygons instead). Wave events keep their areas in `locations` / the text only.
--  * expire_events archived every home-front-alerts event after the 10-minute alert timer. Wave events
--    now live as long as any other event (event_lifetime hours) and then move to the archive.

create or replace function public.expire_events()
returns integer language plpgsql security definer set search_path = '' as $function$
declare
  v_cfg   jsonb;
  v_hours integer;
  v_ttl   interval;
  v_n     integer;
begin
  select value into v_cfg from public.app_settings where key = 'event_lifetime';
  if not coalesce((v_cfg ->> 'enabled')::boolean, true) then return 0; end if;
  v_hours := greatest(1, coalesce((v_cfg ->> 'hours')::integer, 24));
  select make_interval(mins => greatest(1, coalesce((value ->> 'ttl_minutes')::integer, 10)))
    into v_ttl from public.app_settings where key = 'hfc_alerts';
  v_ttl := coalesce(v_ttl, interval '10 minutes');

  update public.events e
     set status = 'archived', expired_at = now()
    from (
      select e2.id
      from public.events e2
      left join public.event_categories c on c.id = e2.category_id
      where e2.status = 'published' and e2.deleted_at is null
        and case when c.slug = 'home-front-alerts' and coalesce(e2.ai_suggestions ->> 'hfc_auto', '') <> 'true'
                 then greatest(e2.occurred_at, coalesce(e2.published_at, e2.occurred_at)) + v_ttl
                 else e2.occurred_at + make_interval(hours => v_hours)
            end < now()
      order by e2.occurred_at
      limit 50
    ) x
   where e.id = x.id;
  get diagnostics v_n = row_count;
  return v_n;
end;
$function$;

-- Wave events: no hfc_areas (so the feed shows them); the areas stay in the text and the pins.
create or replace function public.hfc_wave_events_no_areas()
returns trigger language plpgsql set search_path = '' as $$
begin
  if coalesce(new.ai_suggestions ->> 'hfc_auto', '') = 'true' then
    new.hfc_areas := '{}';
  end if;
  return new;
end $$;

drop trigger if exists events_zzzzz_hfc_wave_no_areas on public.events;
create trigger events_zzzzz_hfc_wave_no_areas before insert or update on public.events
  for each row execute function public.hfc_wave_events_no_areas();

-- Bring back the waves archived by the old rule (still inside their normal lifetime).
update public.events e
   set hfc_areas = '{}',
       status = case when e.occurred_at > now() - make_interval(hours => greatest(1, coalesce(
                  (select (value ->> 'hours')::integer from public.app_settings where key = 'event_lifetime'), 24)))
                then 'published'::public.event_status else e.status end,
       expired_at = case when e.occurred_at > now() - make_interval(hours => greatest(1, coalesce(
                  (select (value ->> 'hours')::integer from public.app_settings where key = 'event_lifetime'), 24)))
                then null else e.expired_at end
 where e.ai_suggestions ->> 'hfc_auto' = 'true' and e.deleted_at is null;
