-- Stage A / Task 3: guests read the last 24 h through published_events (not the events table).
-- Run inside begin; ... rollback;
create temp table t_expect as
  select (select count(*) from public.events e where e.status = 'published' and e.deleted_at is null
            and cardinality(e.hfc_areas) = 0 and e.occurred_at > now() - interval '24 hours') recent,
         (select count(*) from public.ais_vessels) ships,
         (select count(*) from public.control_areas) control,
         (select count(*) from public.lebanon_sects) sects,
         (select count(*) from public.event_media m join public.events e on e.id = m.event_id
            where m.ready and e.status = 'published' and e.deleted_at is null and e.occurred_at > now() - interval '24 hours') media;
grant select on t_expect to anon;
set local role anon;
do $$
declare e record;
begin
  select * into e from t_expect;
  assert (select count(*) from public.published_events where occurred_at <= now() - interval '24 hours') = 0, 'old events visible';
  assert (select count(*) from public.published_events) = e.recent, 'recent: ' || (select count(*) from public.published_events) || ' of ' || e.recent;
  assert (select count(*) from public.event_media) = e.media, 'media: ' || (select count(*) from public.event_media) || ' of ' || e.media;
  assert (select count(*) from public.ais_vessels) = e.ships, 'ships hidden';
  assert (select count(*) from public.control_areas) = e.control, 'control areas hidden';
  assert (select count(*) from public.lebanon_sects) = e.sects, 'lebanon communities hidden';
  assert not has_table_privilege('anon', 'public.wadi_lines', 'select'), 'wadis must stay members-only';
  assert not has_table_privilege('anon', 'public.events', 'select'), 'events table must stay closed to anon';
end $$;
reset role;
