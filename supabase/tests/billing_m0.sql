-- Billing M0 checks. Run inside a test database only: begin; ... rollback;
-- Covers: grants and row security of the billing tables, idempotent billing_apply,
-- time is added and never shortened, grace after a failed charge, refund revokes paid access.
-- Not covered here: redeem_license (needs a signed-in JWT); check it by hand with a test key.
do $$
begin
  -- Structure and grants
  assert (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname = '_plan_set' and p.pronargs = 7) = 1, '_plan_set must take the billing period';
  assert has_function_privilege('service_role', 'public.billing_apply(text,text,uuid,text,text,text,text,uuid,int,int,jsonb)', 'execute'), 'service_role must run billing_apply';
  assert not has_function_privilege('authenticated', 'public.billing_apply(text,text,uuid,text,text,text,text,uuid,int,int,jsonb)', 'execute'), 'members must not run billing_apply';
  assert not has_function_privilege('anon', 'public.billing_apply(text,text,uuid,text,text,text,text,uuid,int,int,jsonb)', 'execute'), 'anon must not run billing_apply';
  assert not has_table_privilege('authenticated', 'public.billing_events', 'select'), 'members must not read billing_events';
  assert not has_table_privilege('authenticated', 'public.billing_subscriptions', 'insert'), 'members must not write subscriptions';
end $$;

-- Behaviour: a test user on Free
do $$
declare
  u uuid := gen_random_uuid();
  r jsonb;
  p record;
  end1 timestamptz;
begin
  insert into auth.users (id, email) values (u, 'billing-m0-test@example.invalid');
  -- profiles is created for new auth users by the existing sign-up trigger
  assert (select plan from public.profiles where id = u) = 'free', 'test user must start on Free';

  -- First charge: Pro monthly, subscription created
  r := public.billing_apply('evt-1', 'payment', u, 'pro', 'monthly', 'gs-1', 'txn-1', null, 5900, 900);
  assert (r->>'duplicate')::boolean = false, 'first event is not a duplicate';
  select plan, plan_source, plan_expires_at, billing_period into p from public.profiles where id = u;
  assert p.plan = 'pro' and p.plan_source = 'paid' and p.billing_period = 'monthly', 'first charge grants paid Pro monthly';
  end1 := p.plan_expires_at;
  assert end1 > now() + interval '28 days' and end1 < now() + interval '32 days', 'monthly period is about one month';

  -- The same event again changes nothing
  r := public.billing_apply('evt-1', 'payment', u, 'pro', 'monthly', 'gs-1', 'txn-1', null, 5900, 900);
  assert (r->>'duplicate')::boolean = true, 'repeated event is a duplicate';
  assert (select plan_expires_at from public.profiles where id = u) = end1, 'duplicate must not extend time';

  -- Renewal: time is added to the period end, not to now
  r := public.billing_apply('evt-2', 'renewal', u, 'pro', 'monthly', 'gs-1', 'txn-2', null, 5900, 900);
  assert (select plan_expires_at from public.profiles where id = u) > end1 + interval '28 days', 'renewal extends from the period end';
  assert (select count(*) from public.billing_payments where user_id = u) = 2, 'two charges recorded';

  -- Same transaction under a new event key: payments table stops a double record
  r := public.billing_apply('evt-3', 'renewal', u, 'pro', 'monthly', 'gs-1', 'txn-2', null, 5900, 900);
  assert (select count(*) from public.billing_payments where user_id = u) = 2, 'a transaction is recorded once';

  -- Failed charge: Pro stays through a 3 day grace after the paid period end
  r := public.billing_apply('evt-4', 'failed', u, null, null, 'gs-1', null, null, 0, 0, '{}');
  assert (select status from public.billing_subscriptions where grow_subscription_id = 'gs-1') = 'past_due', 'failed charge makes the subscription past_due';
  assert (select plan from public.profiles where id = u) = 'pro', 'plan stays during grace';
  assert (select plan_expires_at from public.profiles where id = u)
         = (select current_period_end + interval '3 days' from public.billing_subscriptions where grow_subscription_id = 'gs-1'), 'grace is 3 days after the period end';

  -- Cancellation keeps access until the period ends
  r := public.billing_apply('evt-5', 'canceled', u, null, null, 'gs-1', null, null, 0, 0, '{}');
  assert (select plan from public.profiles where id = u) = 'pro', 'cancel does not downgrade at once';
  assert (select cancel_at_period_end from public.billing_subscriptions where grow_subscription_id = 'gs-1') = true, 'cancel is recorded';

  -- Refund removes paid access at once
  r := public.billing_apply('evt-6', 'refund', u, null, null, 'gs-1', 'txn-refund-1', null, 5900, 0, '{}');
  assert (select plan from public.profiles where id = u) = 'free', 'refund returns the user to Free';
  assert (select status from public.billing_subscriptions where grow_subscription_id = 'gs-1') = 'revoked', 'refund revokes the subscription';
end $$;
