-- Stage A / fix C1+I1: a use is returned when nothing was delivered (pending poll, error, refused).
do $$
declare u uuid := gen_random_uuid(); r jsonb;
begin
  insert into auth.users (id, email, aud, role, email_confirmed_at) values (u, 'refund@e2e.test', 'authenticated', 'authenticated', now());
  update public.app_settings set value = 'true'::jsonb where key = 'enforce_plans';
  r := public.consume_feature(u, 'expand_daily');
  r := public.consume_feature(u, 'expand_daily');
  perform public.refund_feature(u, 'expand_daily');
  assert (select count from public.feature_usage where user_id = u and feature_key = 'expand_daily') = 1, 'refund did not decrement';
  perform public.refund_feature(u, 'expand_daily');
  perform public.refund_feature(u, 'expand_daily');
  assert (select count from public.feature_usage where user_id = u and feature_key = 'expand_daily') = 0, 'refund went below zero';
  assert not has_function_privilege('authenticated', 'public.refund_feature(uuid, text)', 'execute'), 'refund must be server-only';
end $$;
