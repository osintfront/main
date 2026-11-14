-- Statistics dashboard (migration 131): plan rows, ai_dashboard_allowed, the fixed 3-credit charge in
-- ai_quota, one running build per user, ai_stats_candidates and the closed ai_dashboards table.
-- Run on live as one statement: the final exception rolls everything back (that text = pass).
do $$
declare
  an uuid := gen_random_uuid(); mx uuid := gen_random_uuid(); it uuid := gen_random_uuid();
  pr uuid := gen_random_uuid(); ex uuid := gen_random_uuid();
  cat uuid := (select id from public.event_categories where slug = 'airstrike' limit 1);
  credit numeric := coalesce((select (value #>> '{}')::numeric from public.app_settings where key = 'ai_credit_usd'), 0.08);
  v_day timestamptz := date_trunc('day', now() at time zone 'Asia/Jerusalem') at time zone 'Asia/Jerusalem';
  t0 timestamptz := now() - interval '3 hours';
  e1 uuid := gen_random_uuid(); e2 uuid := gen_random_uuid(); e3 uuid := gen_random_uuid();
  e4 uuid := gen_random_uuid(); e5 uuid := gen_random_uuid();
  r jsonb; ids uuid[]; n int;
begin
  perform set_config('request.jwt.claims', '', true);
  insert into auth.users (id, email, aud, role, email_confirmed_at) values
    (an, 'ad-an@e2e.test', 'authenticated', 'authenticated', now()),
    (mx, 'ad-max@e2e.test', 'authenticated', 'authenticated', now()),
    (it, 'ad-intel@e2e.test', 'authenticated', 'authenticated', now()),
    (pr, 'ad-pro@e2e.test', 'authenticated', 'authenticated', now()),
    (ex, 'ad-expired@e2e.test', 'authenticated', 'authenticated', now());
  update public.profiles set status = 'active', role = 'analyst', plan = 'free' where id = an;
  update public.profiles set status = 'active', role = 'viewer', plan = 'max' where id = mx;
  update public.profiles set status = 'active', role = 'viewer', plan = 'intel' where id = it;
  update public.profiles set status = 'active', role = 'viewer', plan = 'pro' where id = pr;
  update public.profiles set status = 'active', role = 'viewer', plan = 'max', plan_expires_at = now() - interval '1 day' where id = ex;
  update public.app_settings set value = 'true'::jsonb where key = 'enforce_plans';

  -- plan rows
  if (select count(*) from public.plan_features where feature_key = 'ai_dashboard') <> 5 then raise exception 'plan rows'; end if;
  if (select string_agg(plan_id::text || ':' || enabled::text, ',' order by plan_id::text) from public.plan_features where feature_key = 'ai_dashboard')
     <> 'free:false,guest:false,intel:true,max:true,pro:false' then raise exception 'plan values'; end if;

  -- who may build
  r := public.ai_dashboard_allowed(an);
  if not ((r->>'enabled')::boolean and (r->>'staff')::boolean) then raise exception 'allowed staff'; end if;
  if not (public.ai_dashboard_allowed(mx)->>'enabled')::boolean then raise exception 'allowed max'; end if;
  if not (public.ai_dashboard_allowed(it)->>'enabled')::boolean then raise exception 'allowed intel'; end if;
  if (public.ai_dashboard_allowed(pr)->>'enabled')::boolean then raise exception 'allowed pro'; end if;
  if (public.ai_dashboard_allowed(ex)->>'enabled')::boolean then raise exception 'allowed expired max'; end if;

  -- the fixed charge: 2 credits of questions + 3 for one charged dashboard today
  insert into public.ai_usage (fn, purpose, model, cost_usd, user_id) values
    ('event-agent', 'ask_answer', 'x', 2 * credit, mx),
    ('event-agent', 'ask_dashboard_classify', 'x', 5, mx);
  insert into public.ai_dashboards (user_id, status, question, lang, metric, since, until, cache_key, cached, charged, finished_at) values
    (mx, 'done', 'q', 'he', '{}', t0, now(), 'k1', false, true, now()),
    (mx, 'done', 'q', 'he', '{}', t0, now(), 'k1', true, false, now()),
    (mx, 'failed', 'q', 'he', '{}', t0, now(), 'k2', false, false, now()),
    (mx, 'done', 'q', 'he', '{}', t0, now(), 'k3', false, true, v_day - interval '1 hour');
  r := public.ai_quota(mx);
  if (r->>'used')::numeric <> 5 then raise exception 'used % <> 5', r->>'used'; end if;
  if (r->>'spent_today_usd')::numeric < 5 + 2 * credit - 0.0001 then raise exception 'spent leaves out the dashboard rows'; end if;

  -- one running build per user
  insert into public.ai_dashboards (user_id, status, question, lang, metric, since, until, cache_key) values (mx, 'running', 'q', 'he', '{}', t0, now(), 'k4');
  begin
    insert into public.ai_dashboards (user_id, status, question, lang, metric, since, until, cache_key) values (mx, 'running', 'q', 'he', '{}', t0, now(), 'k5');
    raise exception 'second running build accepted';
  exception when unique_violation then null;
  end;

  -- candidates: public, not removed, inside [since, until), oldest first, with source_count
  insert into public.events (id, title, description, category_id, status, latitude, longitude, location_name, country, occurred_at, created_by, sources, deleted_at) values
    (e1, 'ADTEST one', '', cat, 'published', 33.1, 35.8, 'Quneitra', 'Syria', t0 + interval '2 minutes', an, '[{"name":"a"},{"name":"b"}]', null),
    (e2, 'ADTEST two', '', cat, 'archived', 33.1, 35.8, 'Quneitra', 'Syria', t0 + interval '1 minute', an, '[]', null),
    (e3, 'ADTEST draft', '', cat, 'draft', 33.1, 35.8, 'Quneitra', 'Syria', t0 + interval '3 minutes', an, '[]', null),
    (e4, 'ADTEST removed', '', cat, 'published', 33.1, 35.8, 'Quneitra', 'Syria', t0 + interval '4 minutes', an, '[]', now()),
    (e5, 'ADTEST late', '', cat, 'published', 33.1, 35.8, 'Quneitra', 'Syria', t0 + interval '2 hours', an, '[]', null);
  select array_agg(c.id order by c.occurred_at, c.id) into ids
    from public.ai_stats_candidates(t0, t0 + interval '1 hour', array['Syria'], '{}', '{}', array['adtest']) c;
  if ids is distinct from array[e2, e1] then raise exception 'candidates %', ids; end if;
  select c.source_count into n from public.ai_stats_candidates(t0, t0 + interval '1 hour', array['Syria'], '{}', '{}', array['adtest']) c where c.id = e1;
  if n <> 2 then raise exception 'source_count %', n; end if;

  -- closed table
  perform set_config('request.jwt.claims', json_build_object('sub', mx, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin perform 1 from public.ai_dashboards limit 1; raise exception 'ai_dashboards readable by authenticated'; exception when insufficient_privilege then null; end;
  reset role;
  set local role anon;
  begin perform 1 from public.ai_dashboards limit 1; raise exception 'ai_dashboards readable by anon'; exception when insufficient_privilege then null; end;
  reset role;

  raise exception 'ASK_DASHBOARD_ALL_OK';
end $$;
