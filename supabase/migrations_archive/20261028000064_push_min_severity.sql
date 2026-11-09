-- Phone notifications only: the lowest severity this device wants (default high = high + critical).
-- Does not touch the website (feed, map, filters show every severity as before).
alter table public.push_subscriptions add column if not exists min_severity text not null default 'high'
  check (min_severity in ('low', 'medium', 'high', 'critical'));

-- A device changes only its own row (its endpoint, and only for the signed-in owner).
create or replace function public.push_set_min_severity(p_endpoint text, p_min text)
returns boolean language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if p_min not in ('low', 'medium', 'high', 'critical') then raise exception 'bad severity'; end if;
  update public.push_subscriptions set min_severity = p_min, updated_at = now()
   where endpoint = p_endpoint and user_id = auth.uid();
  get diagnostics n = row_count;
  return n > 0;
end $$;
revoke all on function public.push_set_min_severity(text, text) from public, anon;
grant execute on function public.push_set_min_severity(text, text) to authenticated;
