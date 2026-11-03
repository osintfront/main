-- Stage A / review fixes I5 + I10.
-- I5: guests get the live pulses (Realtime needs SELECT), so their map updates like members'.
grant select on public.events_pulse, public.hfc_pulse to anon;

-- I10: archive depth by plan (plan_features 'archive_days', null = unlimited). Only while
-- enforce_plans is on; staff unlimited; guests 0 (they have no archive access anyway).
create or replace function public.my_archive_days()
returns int language sql stable security definer set search_path to '' as $$
  select case
    when not coalesce((select s.value = 'true'::jsonb from public.app_settings s where s.key = 'enforce_plans'), false) then null
    when pr.id is null then 0
    when pr.role <> 'viewer' then null
    else (select f.limit_value from public.plan_features f
           where f.feature_key = 'archive_days'
             and f.plan_id = case when pr.plan <> 'free' and pr.plan_expires_at is not null and pr.plan_expires_at < now()
                                  then 'free' else pr.plan end)
  end
  from (select 1) one left join public.profiles pr on pr.id = auth.uid();
$$;
revoke all on function public.my_archive_days() from public;
grant execute on function public.my_archive_days() to anon, authenticated;

do $$
declare d text := pg_get_viewdef('public.archived_events'::regclass);
        tail constant text := '( SELECT is_member() AS is_member));';
begin
  if right(d, length(tail)) <> tail then raise exception 'archived_events: unexpected definition end'; end if;
  d := left(d, length(d) - length(tail))
    || '( SELECT is_member() AS is_member) AND (( SELECT my_archive_days() AS d) IS NULL'
    || ' OR e.occurred_at > (now() - make_interval(days => ( SELECT my_archive_days() AS d)))));';
  execute 'create or replace view public.archived_events as ' || d;
end $$;

-- I10: push severity by plan — Free devices get high and critical only (while enforced).
create or replace function public.push_set_min_severity(p_endpoint text, p_min text)
returns boolean language plpgsql security definer set search_path = public as $$
declare n int; pr public.profiles%rowtype; v_enforce boolean;
begin
  if p_min not in ('low', 'medium', 'high', 'critical') then raise exception 'bad severity'; end if;
  select * into pr from public.profiles where id = auth.uid();
  v_enforce := coalesce((select value = 'true'::jsonb from public.app_settings where key = 'enforce_plans'), false);
  if v_enforce and pr.role = 'viewer' and p_min in ('low', 'medium')
     and (pr.plan = 'free' or (pr.plan_expires_at is not null and pr.plan_expires_at < now())) then
    raise exception 'plan: the free plan gets high and critical alerts only';
  end if;
  update public.push_subscriptions set min_severity = p_min, updated_at = now()
   where endpoint = p_endpoint and user_id = auth.uid();
  get diagnostics n = row_count;
  return n > 0;
end $$;
revoke all on function public.push_set_min_severity(text, text) from public, anon;
grant execute on function public.push_set_min_severity(text, text) to authenticated;
