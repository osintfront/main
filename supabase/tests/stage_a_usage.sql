-- Stage A / Task 2: feature_usage + consume_feature. Run inside begin; ... rollback;
do $$
declare
  u uuid := gen_random_uuid(); p uuid := gen_random_uuid(); s uuid := gen_random_uuid(); r jsonb; n int;
begin
  insert into auth.users (id, email, aud, role, email_confirmed_at) values
    (u, 't-free@e2e.test', 'authenticated', 'authenticated', now()),
    (p, 't-pro@e2e.test',  'authenticated', 'authenticated', now()),
    (s, 't-staff@e2e.test','authenticated', 'authenticated', now());
  insert into public.profiles (id, full_name, email, role, status, plan) values
    (u, 'free', 't-free@e2e.test', 'viewer', 'active', 'free'),
    (p, 'pro',  't-pro@e2e.test',  'viewer', 'active', 'pro'),
    (s, 'staff','t-staff@e2e.test','analyst','active', 'free')
  on conflict (id) do update set role = excluded.role, status = excluded.status, plan = excluded.plan;
  update public.app_settings set value = 'true'::jsonb where key = 'enforce_plans';

  -- 3 uses, then refused
  r := public.consume_feature(u, 'expand_daily'); assert (r->>'ok')::bool and (r->>'remaining')::int = 2, 'use1 ' || r;
  r := public.consume_feature(u, 'expand_daily'); assert (r->>'remaining')::int = 1, 'use2 ' || r;
  r := public.consume_feature(u, 'expand_daily'); assert (r->>'remaining')::int = 0, 'use3 ' || r;
  r := public.consume_feature(u, 'expand_daily'); assert not (r->>'ok')::bool and r->>'reason' = 'quota_exceeded', 'use4 ' || r;
  -- day = Israel calendar day
  assert (select day from public.feature_usage where user_id = u and feature_key = 'expand_daily') = (now() at time zone 'Asia/Jerusalem')::date, 'day';
  -- not enforced: allowed, still counted
  update public.app_settings set value = 'false'::jsonb where key = 'enforce_plans';
  r := public.consume_feature(u, 'expand_daily'); assert (r->>'ok')::bool and (r->>'used')::int = 4, 'not enforced ' || r;
  update public.app_settings set value = 'true'::jsonb where key = 'enforce_plans';
  -- feature not in plan
  r := public.consume_feature(u, 'insights'); assert r->>'reason' = 'not_in_plan', 'not_in_plan ' || r;
  -- no user / pending user
  r := public.consume_feature(null, 'expand_daily'); assert r->>'reason' = 'signup_required', 'null uid ' || r;
  update public.profiles set status = 'pending' where id = u;
  r := public.consume_feature(u, 'satellite'); assert r->>'reason' = 'signup_required', 'pending ' || r;
  update public.profiles set status = 'active' where id = u;
  -- Pro unlimited; expired Pro = free (3)
  r := public.consume_feature(p, 'satellite'); assert (r->>'ok')::bool and r->'limit' = 'null'::jsonb, 'pro unlimited ' || r;
  update public.profiles set plan_expires_at = now() - interval '1 day' where id = p;
  r := public.consume_feature(p, 'satellite'); assert (r->>'limit')::int = 3, 'expired pro ' || r;
  -- staff unlimited
  r := public.consume_feature(s, 'insights'); assert (r->>'ok')::bool and r->'limit' = 'null'::jsonb, 'staff ' || r;
  -- atomic: 5 attempts on a fresh row -> exactly 3 ok
  select count(*) into n from generate_series(1,5) g where (public.consume_feature(u, 'satellite')->>'ok')::bool;
  assert n = 3, 'satellite ok count ' || n;
end $$;
