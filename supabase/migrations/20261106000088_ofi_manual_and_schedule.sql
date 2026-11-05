-- OFI phase 3 (database side):
--  · the Israeli NSC advisory signal is switched off (no machine-readable level; not needed);
--  · a manual parameter the super admin sets from the OFI page (score + note + how long it holds);
--  · the scheduler: pg_cron every 15 minutes → ofi-runner "tick" (fire-and-forget).

alter table public.insight_signals drop constraint if exists insight_signals_source_type_check;
alter table public.insight_signals add constraint insight_signals_source_type_check check (source_type in
  ('internal_events', 'hfc', 'polymarket', 'finance', 'advisory', 'notam', 'gdelt', 'trends', 'shipping', 'rhetoric', 'manual'));

update public.insight_signals s set enabled = false, last_error = null
from public.insight_events e
where e.id = s.event_id and e.slug = 'iran-direct-confrontation' and s.key = 'advisory_il';

-- Every event gets one manual signal (new events too, via the trigger below).
insert into public.insight_signals (event_id, key, source_type, name_he, name_en, weight, direction, normalization, config, enabled, stale_after_hours)
select e.id, 'manual_admin', 'manual', 'הערכה ידנית (מנהל)', 'Manual assessment (admin)', 2.0, 1,
       '{"method":"manual"}'::jsonb, '{}'::jsonb, true, 24
from public.insight_events e
on conflict (event_id, key) do nothing;

create or replace function public.insight_events_add_manual() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.insight_signals (event_id, key, source_type, name_he, name_en, weight, direction, normalization, config, enabled, stale_after_hours)
  values (new.id, 'manual_admin', 'manual', 'הערכה ידנית (מנהל)', 'Manual assessment (admin)', 2.0, 1, '{"method":"manual"}'::jsonb, '{}'::jsonb, true, 24)
  on conflict (event_id, key) do nothing;
  return new;
end $$;
revoke all on function public.insight_events_add_manual() from public, anon, authenticated;
drop trigger if exists insight_events_manual on public.insight_events;
create trigger insight_events_manual after insert on public.insight_events
  for each row execute function public.insight_events_add_manual();

-- Set the manual parameter: p_level −100 (strongly lowers) … 0 (neutral) … +100 (strongly raises),
-- held for p_hours (after that it fades out like any stale signal). Super admin only.
create or replace function public.ofi_admin_manual(p_slug text, p_level int, p_note text, p_hours int default 24)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare sid uuid; score numeric;
begin
  if not public.is_super_admin() then raise exception 'not allowed'; end if;
  if p_level is null or p_level < -100 or p_level > 100 then raise exception 'level must be between -100 and 100'; end if;
  if p_hours is null or p_hours < 1 or p_hours > 720 then raise exception 'hours must be between 1 and 720'; end if;
  select s.id into sid from public.insight_signals s join public.insight_events e on e.id = s.event_id
  where e.slug = p_slug and s.key = 'manual_admin';
  if sid is null then raise exception 'unknown event'; end if;
  score := 0.5 + p_level::numeric / 200;
  insert into public.insight_signal_readings (signal_id, raw_value, normalized_score, metadata)
  values (sid, p_level, score, jsonb_build_object('note', left(coalesce(p_note, ''), 500), 'by', auth.uid(), 'hours', p_hours));
  update public.insight_signals set last_updated = now(), last_error = null, stale_after_hours = p_hours, enabled = true where id = sid;
  return jsonb_build_object('ok', true, 'score', score, 'until', now() + make_interval(hours => p_hours));
end $$;
revoke all on function public.ofi_admin_manual(text, int, text, int) from public, anon;
grant execute on function public.ofi_admin_manual(text, int, text, int) to authenticated;

-- The scheduler. The function itself decides what is due (full cycle, hourly internal check).
create or replace function public.ofi_tick() returns void
language plpgsql security definer set search_path = '' as $$
declare v_secret text;
begin
  if not exists (select 1 from public.insight_events where status = 'active') then return; end if;
  select value into v_secret from public.intel_config where key = 'cron_secret';
  perform net.http_post(
    url := 'https://kbfggmvrfevstzneqfzf.supabase.co/functions/v1/ofi-runner',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_secret),
    body := '{"action":"tick"}'::jsonb,
    timeout_milliseconds := 5000);
end $$;
revoke all on function public.ofi_tick() from public, anon, authenticated;

select cron.unschedule('osintfront-ofi-tick') where exists (select 1 from cron.job where jobname = 'osintfront-ofi-tick');
select cron.schedule('osintfront-ofi-tick', '7,22,37,52 * * * *', $c$select public.ofi_tick()$c$);
