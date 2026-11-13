-- Deep analysis: closed tables, the writer lease, alias uniqueness, the event's terms (stored and
-- found by text), the entry for Pro / Free, the budget split between readers and staff, plan rows.
-- Run on live as one statement: the final exception rolls everything back (that text = pass).
do $$
declare
  an uuid := gen_random_uuid(); pro uuid := gen_random_uuid(); fr uuid := gen_random_uuid();
  cat uuid := (select id from public.event_categories where slug = 'uav' limit 1);
  ev uuid; ev2 uuid; dr uuid; en uuid; en2 uuid; tok uuid; r jsonb; n int; ok boolean;
begin
  insert into auth.users (id, email, aud, role, email_confirmed_at) values
    (an, 'deep-an@e2e.test', 'authenticated', 'authenticated', now()),
    (pro, 'deep-pro@e2e.test', 'authenticated', 'authenticated', now()),
    (fr, 'deep-free@e2e.test', 'authenticated', 'authenticated', now());
  update public.profiles set status = 'active', role = 'analyst', plan = 'pro' where id = an;
  update public.profiles set status = 'active', role = 'viewer', plan = 'pro' where id = pro;
  update public.profiles set status = 'active', role = 'viewer', plan = 'free' where id = fr;
  update public.app_settings set value = 'true'::jsonb where key = 'enforce_plans';
  update public.app_settings set value = '5'::jsonb where key = 'deep_daily_budget_usd';

  -- closed tables
  perform set_config('request.jwt.claims', json_build_object('sub', pro, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin perform 1 from public.deep_entries limit 1; raise exception 'deep_entries readable'; exception when insufficient_privilege then null; end;
  begin perform 1 from public.deep_aliases limit 1; raise exception 'deep_aliases readable'; exception when insufficient_privilege then null; end;
  begin perform 1 from public.deep_jobs limit 1; raise exception 'deep_jobs readable'; exception when insufficient_privilege then null; end;
  begin perform 1 from public.event_terms limit 1; raise exception 'event_terms readable'; exception when insufficient_privilege then null; end;
  reset role;
  set local role anon;
  begin perform 1 from public.deep_entries limit 1; raise exception 'deep_entries readable by anon'; exception when insufficient_privilege then null; end;
  begin perform 1 from public.event_terms limit 1; raise exception 'event_terms readable by anon'; exception when insufficient_privilege then null; end;
  reset role;
  perform set_config('request.jwt.claims', '', true);

  -- lease
  tok := public.deep_claim('k', pro, false);
  if tok is null then raise exception 'first claim'; end if;
  if public.deep_claim('k', an, true) is not null then raise exception 'second claim given'; end if;
  if public.deep_done('k', gen_random_uuid(), null, 'failed') then raise exception 'done with a wrong token'; end if;
  if not public.deep_done('k', tok, null, 'failed') then raise exception 'done with the right token'; end if;
  if (select retry_after from public.deep_jobs where key = 'k') not between now() + interval '59 minutes' and now() + interval '61 minutes' then
    raise exception 'retry_after not one hour';
  end if;

  -- aliases are unique
  insert into public.deep_entries (kind, name_he, name_en, summary_en) values ('weapon', 'הרון', 'IAI Heron', 'A drone') returning id into en;
  insert into public.deep_entries (kind, name_en, summary_en) values ('term', 'Other', 'x') returning id into en2;
  insert into public.deep_aliases (alias, entry_id) values ('heron', en);
  begin
    insert into public.deep_aliases (alias, entry_id) values ('heron', en2);
    raise exception 'alias taken twice';
  exception when unique_violation then null;
  end;

  -- the event's terms
  insert into public.events (title, occurred_at, published_at, created_by, status, country, category_id)
  values ('Heron drone over Tyre', now() - interval '1 hour', now() - interval '1 hour', an, 'published', 'Lebanon', cat) returning id into ev;
  insert into public.event_terms (event_id, key, keys, kind, en, name) values (ev, 'iai heron', '{iai heron,heron}', 'weapon', 'Heron', 'IAI Heron');
  perform set_config('request.jwt.claims', json_build_object('sub', pro, 'role', 'authenticated')::text, true);
  set local role authenticated;
  r := public.event_terms_for(ev);
  reset role;
  if jsonb_array_length(r) <> 1 or (r->0->>'entry')::uuid is distinct from en then raise exception 'stored mark: %', r; end if;

  insert into public.events (title, occurred_at, published_at, created_by, status, country, category_id)
  values ('Another Heron flight', now() - interval '2 hours', now() - interval '2 hours', an, 'published', 'Lebanon', cat) returning id into ev2;
  set local role authenticated;
  r := public.event_terms_for(ev2);
  reset role;
  if jsonb_array_length(r) <> 1 or (r->0->>'entry')::uuid is distinct from en then raise exception 'found by text: %', r; end if;

  insert into public.deep_aliases (alias, entry_id) values ('her', en2);
  insert into public.events (title, occurred_at, published_at, created_by, status, country, category_id)
  values ('Her words', now() - interval '2 hours', now() - interval '2 hours', an, 'published', 'Lebanon', cat) returning id into dr;
  set local role authenticated;
  r := public.event_terms_for(dr);
  reset role;
  if jsonb_array_length(r) <> 0 then raise exception 'short alias matched: %', r; end if;

  insert into public.events (title, occurred_at, created_by, status, category_id)
  values ('Heron draft', now(), an, 'draft', cat) returning id into dr;
  set local role authenticated;
  r := public.event_terms_for(dr);
  reset role;
  if jsonb_array_length(r) <> 0 then raise exception 'draft has terms: %', r; end if;

  -- the entry: Free → null, Pro → text and events
  perform set_config('request.jwt.claims', json_build_object('sub', fr, 'role', 'authenticated')::text, true);
  set local role authenticated;
  r := public.deep_entry(en);
  reset role;
  if r is not null then raise exception 'free reads the entry'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', pro, 'role', 'authenticated')::text, true);
  set local role authenticated;
  r := public.deep_entry(en);
  reset role;
  if r->>'name_en' is distinct from 'IAI Heron' then raise exception 'pro entry: %', r; end if;
  if not (r->'events') ? ev::text then raise exception 'entry events: %', r->'events'; end if;
  if r ? 'prev' or r ? 'cost_usd' then raise exception 'entry leaks fields'; end if;

  -- spend: readers only
  perform set_config('request.jwt.claims', '', true);
  insert into public.ai_usage (fn, purpose, model, cost_usd) values
    ('event-agent', 'ask', 'x', 3), ('event-agent', 'deep_entry_staff', 'x', 50), ('event-agent', 'deep_entry', 'x', 0.25);
  if public.deep_spent_today() - (select coalesce(sum(cost_usd), 0) from public.ai_usage where purpose = 'deep_entry'
        and at >= ((now() at time zone 'Asia/Jerusalem')::date)::timestamp at time zone 'Asia/Jerusalem') <> 0 then
    raise exception 'spent_today counts other purposes';
  end if;

  -- in flight: one staff lease, one reader lease (+ the released 'k')
  perform public.deep_claim('s1', an, true);
  perform public.deep_claim('r1', pro, false);
  r := public.deep_in_flight();
  if (r->>'all')::int <> 2 or (r->>'readers')::int <> 1 then raise exception 'in flight: %', r; end if;
  update public.deep_jobs set busy_until = null where key in ('s1', 'r1');

  -- quota and budget
  perform set_config('request.jwt.claims', json_build_object('sub', pro, 'role', 'authenticated')::text, true);
  set local role authenticated;
  r := public.deep_my_quota();
  reset role;
  if (r->>'limit')::int <> 3 or (r->>'used')::int <> 0 then raise exception 'pro quota: %', r; end if;
  if (r->>'budget_left')::boolean is distinct from (public.deep_spent_today() < 5) then raise exception 'pro budget_left: %', r; end if;
  insert into public.ai_usage (fn, purpose, model, cost_usd) values ('event-agent', 'deep_entry', 'x', 5);
  set local role authenticated;
  r := public.deep_my_quota();
  reset role;
  if (r->>'budget_left')::boolean then raise exception 'pro budget not used up: %', r; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', an, 'role', 'authenticated')::text, true);
  set local role authenticated;
  r := public.deep_my_quota();
  reset role;
  if not (r->>'budget_left')::boolean or not (r->>'staff')::boolean or r->>'limit' is not null then raise exception 'analyst quota: %', r; end if;

  -- allowed
  perform set_config('request.jwt.claims', '', true);
  r := public.deep_allowed(pro);
  if not (r->>'enabled')::boolean or (r->>'limit')::int <> 3 then raise exception 'allowed pro: %', r; end if;
  r := public.deep_allowed(fr);
  if (r->>'enabled')::boolean then raise exception 'allowed free: %', r; end if;
  r := public.deep_allowed(an);
  if not (r->>'staff')::boolean then raise exception 'allowed analyst: %', r; end if;

  raise exception 'DEEP_ANALYSIS_ALL_OK';
end $$;
