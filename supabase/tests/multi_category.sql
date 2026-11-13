-- Several event types: the Killed / Wounded rows, the secondary column and its cleaning trigger,
-- the hand-set RPC, the two views, ask-the-map candidates and the public API.
-- Run inside one statement on live: everything is rolled back by the final exception.
do $$
declare
  ed uuid := gen_random_uuid(); vw uuid := gen_random_uuid();
  c_killed uuid; c_air uuid; c_uav uuid;
  e2 uuid; e3 uuid; e4 uuid; e5 uuid; e_uav uuid;
  got text[]; r jsonb; n int; first_id uuid;
begin
  update public.event_categories set is_active = true where slug in ('killed', 'wounded');
  select id into c_killed from public.event_categories where slug = 'killed';
  select id into c_air from public.event_categories where slug = 'airstrike';
  select id into c_uav from public.event_categories where slug = 'uav';

  -- 1. the two rows
  if not exists (select 1 from public.event_categories where slug = 'killed' and icon = 'Skull' and color = '#27272a' and translations->>'he' = 'הרוגים') then
    raise exception 'check 1: killed row';
  end if;
  if not exists (select 1 from public.event_categories where slug = 'wounded' and icon = 'MedicalCross' and color = '#701a75' and translations->>'he' = 'פצועים') then
    raise exception 'check 1: wounded row';
  end if;

  insert into auth.users (id, email, aud, role, email_confirmed_at) values
    (ed, 'mc-editor@e2e.test', 'authenticated', 'authenticated', now()),
    (vw, 'mc-viewer@e2e.test', 'authenticated', 'authenticated', now());
  update public.profiles set status = 'active', role = 'editor', plan = 'pro' where id = ed;
  update public.profiles set status = 'active', role = 'viewer', plan = 'pro' where id = vw;

  -- 2. cleaning on insert
  insert into public.events (title, occurred_at, published_at, created_by, status, country, latitude, longitude, category_id, secondary_categories)
  values ('mc killed', now() - interval '1 hour', now() - interval '1 hour', ed, 'published', 'Lebanon', 33.27, 35.2, c_killed,
          '{airstrike,killed,airstrike,nope,other,uav}') returning id, secondary_categories into e2, got;
  if got is distinct from '{airstrike,uav}'::text[] then raise exception 'check 2: %', got; end if;

  -- 3. wounded goes last
  insert into public.events (title, occurred_at, created_by, status, category_id, secondary_categories)
  values ('mc w1', now() - interval '1 hour', ed, 'draft', c_killed, '{wounded,airstrike,explosion}') returning id, secondary_categories into e3, got;
  if got is distinct from '{airstrike,explosion}'::text[] then raise exception 'check 3a: %', got; end if;
  insert into public.events (title, occurred_at, created_by, status, category_id, secondary_categories)
  values ('mc w2', now() - interval '1 hour', ed, 'draft', c_killed, '{wounded,airstrike}') returning id, secondary_categories into e4, got;
  if got is distinct from '{airstrike,wounded}'::text[] then raise exception 'check 3b: %', got; end if;

  -- 4. the new main type leaves the list
  update public.events set category_id = c_air where id = e4 returning secondary_categories into got;
  if got is distinct from '{wounded}'::text[] then raise exception 'check 4: %', got; end if;

  -- 5. an inactive type is dropped
  update public.event_categories set is_active = false where slug = 'fire';
  insert into public.events (title, occurred_at, created_by, status, category_id, secondary_categories)
  values ('mc inactive', now() - interval '1 hour', ed, 'draft', c_killed, '{fire,uav}') returning id, secondary_categories into e5, got;
  if got is distinct from '{uav}'::text[] then raise exception 'check 5: %', got; end if;

  -- 6. the hand-set RPC
  perform set_config('request.jwt.claims', json_build_object('sub', vw, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.set_event_secondary_categories(e3, '{uav}');
    raise exception 'check 6: viewer allowed';
  exception when insufficient_privilege then null;
  end;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', ed, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.set_event_secondary_categories(e3, '{force-sighting}');
  begin
    perform public.set_event_secondary_categories(e3, '{uav,drone,explosion}');
    raise exception 'check 6: three accepted';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.set_event_secondary_categories(e3, '{nope}');
    raise exception 'check 6: unknown accepted';
  exception when invalid_parameter_value then null;
  end;
  reset role;
  select secondary_categories into got from public.events where id = e3;
  if got is distinct from '{force-sighting}'::text[] then raise exception 'check 6: stored %', got; end if;
  if (select ai_suggestions->>'manual_secondary' from public.events where id = e3) is distinct from 'true' then raise exception 'check 6: flag'; end if;
  set local role authenticated;
  perform public.set_event_secondary_categories(e3, '{}');
  reset role;
  select secondary_categories into got from public.events where id = e3;
  if got is distinct from '{}'::text[] then raise exception 'check 6: not cleared %', got; end if;
  if (select ai_suggestions->>'manual_secondary' from public.events where id = e3) is distinct from 'true' then raise exception 'check 6: flag lost'; end if;

  -- 7. views: last column, and a member sees the list
  if (select column_name from information_schema.columns where table_schema = 'public' and table_name = 'published_events' order by ordinal_position desc limit 1) <> 'secondary_categories' then
    raise exception 'check 7: published_events last column';
  end if;
  if (select column_name from information_schema.columns where table_schema = 'public' and table_name = 'archived_events' order by ordinal_position desc limit 1) <> 'secondary_categories' then
    raise exception 'check 7: archived_events last column';
  end if;
  perform set_config('request.jwt.claims', json_build_object('sub', vw, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select p.secondary_categories into got from public.published_events p where p.id = e2;
  reset role;
  if got is distinct from '{airstrike,uav}'::text[] then raise exception 'check 7: member sees %', got; end if;

  -- 8. ask-the-map candidates: a secondary match counts, a main match ranks higher
  insert into public.events (title, occurred_at, published_at, created_by, status, country, category_id)
  values ('mc uav', now() - interval '2 hours', now() - interval '2 hours', ed, 'published', 'Lebanon', c_uav) returning id into e_uav;
  select count(*) into n from public.ai_search_candidates(now() - interval '1 day', null, '{}', '{}', '{uav}', '{}', 200) s where s.id = e2;
  if n <> 1 then raise exception 'check 8: secondary match missing'; end if;
  select s.id into first_id from public.ai_search_candidates(now() - interval '1 day', null, '{}', '{}', '{uav}', '{}', 200) s
   where s.id in (e2, e_uav) order by s.score desc, s.occurred_at desc limit 1;
  if first_id <> e_uav then raise exception 'check 8: main match not first'; end if;

  -- 9. public API
  update public.app_settings set value = 'true'::jsonb where key = 'api_enabled';
  if not found then insert into public.app_settings (key, value) values ('api_enabled', 'true'::jsonb); end if;
  insert into public.api_keys (name, tier, key_hash, key_prefix)
  values ('mc test', 'business', encode(extensions.digest('mc-test-key', 'sha256'), 'hex'), 'mc');
  r := public.api_events('mc-test-key', now() - interval '1 day', null, 'uav', null, 500);
  if r ? 'error' then raise exception 'check 9: %', r; end if;
  select x into r from jsonb_array_elements(r->'data') x where x->>'id' = e2::text;
  if r is null then raise exception 'check 9: event missing'; end if;
  if r->'secondary_categories' is distinct from '["airstrike","uav"]'::jsonb then raise exception 'check 9: item %', r; end if;

  raise exception 'MULTI_CATEGORY_ALL_OK';
end $$;
