-- Alert-wave events: the map icon stays only for the alert timer (10 minutes after the wave's last
-- alert, as hfc_alerts.ttl_minutes); after that the event stays in the feed and archive without a pin.

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

  -- Alert-wave events leave the map once the alert timer is over (10 minutes after the wave's last
  -- alert); the event itself stays in the feed and the archive (events_no_map drops the pins).
  update public.events e
     set ai_suggestions = e.ai_suggestions || '{"no_map": true}'::jsonb
   where e.ai_suggestions ->> 'hfc_auto' = 'true'
     and coalesce(e.ai_suggestions ->> 'no_map', '') <> 'true'
     and e.deleted_at is null
     and (e.ai_suggestions ->> 'hfc_last')::timestamptz + v_ttl < now();

  return v_n;
end;
$function$;

select public.expire_events();
