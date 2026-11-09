-- Stage A / Task 2 — daily usage counter per user and feature (Israel calendar day).
-- consume_feature(uid, key): edge functions (service role). use_feature(key): the signed-in browser.
-- Result: {ok, reason: null|signup_required|not_in_plan|quota_exceeded, used, limit, remaining}.
-- Staff (role <> viewer) are never limited. While enforce_plans is false nothing is refused (still counted).

create table if not exists public.feature_usage (
  user_id uuid not null references auth.users(id) on delete cascade,
  feature_key text not null,
  day date not null,
  count int not null default 0,
  primary key (user_id, feature_key, day)
);
alter table public.feature_usage enable row level security;
drop policy if exists "feature usage: own rows" on public.feature_usage;
create policy "feature usage: own rows" on public.feature_usage for select to authenticated
  using (user_id = (select auth.uid()));

create or replace function public.consume_feature(p_uid uuid, p_key text)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare
  v_prof public.profiles%rowtype;
  v_plan text;
  v_enforce boolean;
  v_enabled boolean;
  v_limit int;
  v_day date := (now() at time zone 'Asia/Jerusalem')::date;
  v_count int;
begin
  if p_uid is not null then
    select * into v_prof from public.profiles where id = p_uid;
  end if;
  if p_uid is null or v_prof.id is null or v_prof.status <> 'active' then
    return jsonb_build_object('ok', false, 'reason', 'signup_required', 'used', 0, 'limit', 0, 'remaining', 0);
  end if;
  select coalesce((select value = 'true'::jsonb from public.app_settings where key = 'enforce_plans'), false) into v_enforce;

  if v_prof.role <> 'viewer' then
    v_enabled := true; v_limit := null;                       -- staff: everything, no limit
  else
    v_plan := case when v_prof.plan <> 'free' and v_prof.plan_expires_at is not null and v_prof.plan_expires_at < now()
                   then 'free' else v_prof.plan end;
    select enabled, limit_value into v_enabled, v_limit
      from public.plan_features where feature_key = p_key and plan_id = v_plan;
    v_enabled := coalesce(v_enabled, false);
  end if;

  if not v_enabled and v_enforce then
    return jsonb_build_object('ok', false, 'reason', 'not_in_plan', 'used', 0, 'limit', 0, 'remaining', 0);
  end if;

  -- Atomic: the row is only bumped while under the limit (or when nothing is enforced).
  insert into public.feature_usage as fu (user_id, feature_key, day, count)
  values (p_uid, p_key, v_day, 1)
  on conflict (user_id, feature_key, day) do update set count = fu.count + 1
    where v_limit is null or not v_enforce or fu.count < v_limit
  returning count into v_count;

  if v_count is null then
    -- A first use with limit 0 also lands here only if the insert succeeded; a refused update returns no row.
    select count into v_count from public.feature_usage where user_id = p_uid and feature_key = p_key and day = v_day;
    return jsonb_build_object('ok', false, 'reason', 'quota_exceeded', 'used', v_count, 'limit', v_limit, 'remaining', 0);
  end if;
  if v_enforce and v_limit is not null and v_count > v_limit then
    -- First-ever use against a limit of 0 (inserted row): undo and refuse.
    update public.feature_usage set count = count - 1 where user_id = p_uid and feature_key = p_key and day = v_day;
    return jsonb_build_object('ok', false, 'reason', 'quota_exceeded', 'used', v_count - 1, 'limit', v_limit, 'remaining', 0);
  end if;
  return jsonb_build_object('ok', true, 'reason', null, 'used', v_count, 'limit', v_limit,
    'remaining', case when v_limit is null then null else greatest(v_limit - v_count, 0) end);
end;
$$;
revoke all on function public.consume_feature(uuid, text) from public, anon, authenticated;
grant execute on function public.consume_feature(uuid, text) to service_role;

create or replace function public.use_feature(p_key text)
returns jsonb language sql security definer set search_path to '' as $$
  select public.consume_feature(auth.uid(), p_key);
$$;
revoke all on function public.use_feature(text) from public, anon;
grant execute on function public.use_feature(text) to authenticated;

-- Today's use per feature for the signed-in user, with the plan's limit.
create or replace function public.my_feature_usage()
returns jsonb language sql stable security definer set search_path to '' as $$
  select coalesce(jsonb_object_agg(f.feature_key, jsonb_build_object('used', coalesce(u.count, 0), 'limit', f.limit_value)), '{}'::jsonb)
  from public.profiles pr
  join public.plan_features f
    on f.plan_id = case when pr.plan <> 'free' and pr.plan_expires_at is not null and pr.plan_expires_at < now() then 'free' else pr.plan end
   and f.feature_key in ('expand_daily', 'satellite')
  left join public.feature_usage u
    on u.user_id = pr.id and u.feature_key = f.feature_key and u.day = (now() at time zone 'Asia/Jerusalem')::date
  where pr.id = auth.uid();
$$;
revoke all on function public.my_feature_usage() from public, anon;
grant execute on function public.my_feature_usage() to authenticated;
