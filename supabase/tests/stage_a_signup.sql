-- Stage A / Task 4: self sign-up creates a free viewer, active only after email confirmation.
do $$
declare u uuid := gen_random_uuid(); g uuid := gen_random_uuid(); pr record; r jsonb;
begin
  insert into auth.users (id, email, aud, role, raw_user_meta_data)
    values (u, 'signup-e2e@e2e.test', 'authenticated', 'authenticated', '{"full_name":"Test Signup"}');
  select * into pr from public.profiles where id = u;
  assert pr.id is not null, 'no profile created';
  assert pr.role = 'viewer' and pr.plan = 'free' and pr.status = 'pending', 'wrong profile ' || row_to_json(pr);
  assert pr.full_name = 'Test Signup', 'name';
  r := public.consume_feature(u, 'expand_daily'); assert r->>'reason' = 'signup_required', 'unverified ' || r;
  update auth.users set email_confirmed_at = now() where id = u;
  assert (select status from public.profiles where id = u) = 'active', 'not activated on confirm';
  r := public.consume_feature(u, 'expand_daily'); assert (r->>'ok')::bool, 'verified ' || r;
  -- Google: confirmed at creation, name in "name"
  insert into auth.users (id, email, aud, role, email_confirmed_at, raw_user_meta_data)
    values (g, 'google-e2e@e2e.test', 'authenticated', 'authenticated', now(), '{"name":"G User"}');
  assert (select status = 'active' and full_name = 'G User' from public.profiles where id = g), 'google user';
end $$;
