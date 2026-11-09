-- ════════════════════════════════════════════════════════════════════
-- Osintfront · Migration 40 — daily search quota
-- The search bar ("search events, places"): 3 searches a day per user (Israel day),
-- super admins unlimited. The same text again on the same day is free.
-- ════════════════════════════════════════════════════════════════════
create table if not exists public.search_quota_log (
  id       bigserial primary key,
  user_id  uuid not null,
  day      date not null,
  query    text not null,
  at       timestamptz not null default now()
);
create index if not exists search_quota_log_user_day on public.search_quota_log (user_id, day);
alter table public.search_quota_log enable row level security;
revoke all on public.search_quota_log from anon, authenticated;

create or replace function public.use_search_quota(p_query text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid   uuid := auth.uid();
  v_role  text;
  v_day   date := (now() at time zone 'Asia/Jerusalem')::date;
  v_q     text := lower(btrim(coalesce(p_query, '')));
  v_used  integer;
  v_limit constant integer := 3;
begin
  if v_uid is null then raise exception 'Sign in required.' using errcode = '42501'; end if;
  select role into v_role from public.profiles where id = v_uid and status = 'active';
  if v_role is null then raise exception 'Not a member.' using errcode = '42501'; end if;
  if v_role = 'super_admin' then return jsonb_build_object('ok', true, 'unlimited', true); end if;
  if v_q = '' then return jsonb_build_object('ok', true, 'remaining', null); end if;
  select count(distinct query) into v_used from public.search_quota_log where user_id = v_uid and day = v_day;
  if exists (select 1 from public.search_quota_log where user_id = v_uid and day = v_day and query = left(v_q, 120)) then
    return jsonb_build_object('ok', true, 'remaining', greatest(v_limit - v_used, 0), 'limit', v_limit);
  end if;
  if v_used >= v_limit then
    return jsonb_build_object('ok', false, 'remaining', 0, 'limit', v_limit);
  end if;
  insert into public.search_quota_log (user_id, day, query) values (v_uid, v_day, left(v_q, 120));
  return jsonb_build_object('ok', true, 'remaining', v_limit - v_used - 1, 'limit', v_limit);
end;
$$;
revoke execute on function public.use_search_quota(text) from public, anon;
grant execute on function public.use_search_quota(text) to authenticated;
