-- Stage A / review fix C1+I1 — give a use back when nothing was delivered (a pending poll,
-- a missing event, an AI-credit refusal, a failure). Server only; never below zero.
create or replace function public.refund_feature(p_uid uuid, p_key text)
returns void language sql security definer set search_path to '' as $$
  update public.feature_usage set count = count - 1
   where user_id = p_uid and feature_key = p_key
     and day = (now() at time zone 'Asia/Jerusalem')::date and count > 0;
$$;
revoke all on function public.refund_feature(uuid, text) from public, anon, authenticated;
grant execute on function public.refund_feature(uuid, text) to service_role;
