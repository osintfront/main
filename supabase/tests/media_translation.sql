-- Media translation: closed tables, the item rule (same four-row example as tests/media/mediaInput.test.ts),
-- the job lease, the reader's RPC (plan gate, todo counting, hidden vanished items, drafts), the
-- readers-only spend, runs in flight, media_allowed and the plan rows.
-- Run on live as one statement: the final exception rolls everything back (that text = pass).
do $$
declare
  an uuid := gen_random_uuid(); pro uuid := gen_random_uuid(); fr uuid := gen_random_uuid();
  cat uuid := (select id from public.event_categories where slug = 'airstrike' limit 1);
  ev uuid; dr uuid; tok uuid; tok2 uuid; r jsonb; n int;
  p uuid := gen_random_uuid(); s uuid := gen_random_uuid(); v uuid := gen_random_uuid(); u uuid := gen_random_uuid();
  base text := 'https://kbfggmvrfevstzneqfzf.supabase.co/storage/v1/object/public/event-media/test/';
begin
  perform set_config('request.jwt.claims', '', true);
  insert into auth.users (id, email, aud, role, email_confirmed_at) values
    (an, 'mt-an@e2e.test', 'authenticated', 'authenticated', now()),
    (pro, 'mt-pro@e2e.test', 'authenticated', 'authenticated', now()),
    (fr, 'mt-free@e2e.test', 'authenticated', 'authenticated', now());
  update public.profiles set status = 'active', role = 'analyst', plan = 'pro' where id = an;
  update public.profiles set status = 'active', role = 'viewer', plan = 'pro' where id = pro;
  update public.profiles set status = 'active', role = 'viewer', plan = 'free' where id = fr;
  update public.app_settings set value = 'true'::jsonb where key = 'enforce_plans';
  update public.app_settings set value = '3'::jsonb where key = 'media_daily_budget_usd';
  update public.app_settings set value = 'false'::jsonb where key = 'media_audio_enabled';

  -- closed tables
  perform set_config('request.jwt.claims', json_build_object('sub', pro, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin perform 1 from public.media_readings limit 1; raise exception 'media_readings readable'; exception when insufficient_privilege then null; end;
  begin perform 1 from public.media_jobs limit 1; raise exception 'media_jobs readable'; exception when insufficient_privilege then null; end;
  reset role;
  set local role anon;
  begin perform 1 from public.media_readings limit 1; raise exception 'media_readings readable by anon'; exception when insufficient_privilege then null; end;
  begin perform 1 from public.media_jobs limit 1; raise exception 'media_jobs readable by anon'; exception when insufficient_privilege then null; end;
  reset role;
  perform set_config('request.jwt.claims', '', true);

  -- a published event with the four-row example: P picture, S still (k1), V its file, U a lone video (k2)
  insert into public.events (title, occurred_at, created_by, status, category_id)
  values ('mt event', now(), an, 'published', cat) returning id into ev;
  insert into public.event_media (id, event_id, kind, storage_path, public_url, bytes, source_msg_key, source_url, thumb_id, ready, created_at) values
    (p, ev, 'image',       'test/p', base || 'p.jpg', 1000, null, null, null, true, now() - interval '4 minutes'),
    (s, ev, 'video_thumb', 'test/s', base || 's.jpg', 1000, 'k1', 'https://t.me/x/1', null, true, now() - interval '3 minutes'),
    (v, ev, 'video',       'test/v', base || 'v.mp4', 9437184, null, null, s, true, now() - interval '2 minutes'),
    (u, ev, 'video',       'test/u', base || 'u.mp4', 62914560, 'k2', null, null, true, now() - interval '1 minute');

  select count(*) into n from public.media_items(ev);
  if n <> 3 then raise exception 'media_items count %', n; end if;
  if (select array_agg(media_id order by created_at) from public.media_items(ev)) <> array[p, s, u] then raise exception 'media_items order'; end if;
  if (select kind from public.media_items(ev) where media_id = s) <> 'video' then raise exception 'still is a video item'; end if;
  if (select thumb from public.media_items(ev) where media_id = u) is not null then raise exception 'lone video has no thumb'; end if;
  if (select thumb from public.media_items(ev) where media_id = p) <> base || 'p.jpg' then raise exception 'picture thumb'; end if;

  -- the lease
  tok := public.media_claim(ev, pro, false);
  if tok is null then raise exception 'first claim'; end if;
  if public.media_claim(ev, an, true) is not null then raise exception 'second claim given'; end if;
  if public.media_done(ev, gen_random_uuid(), 'failed', 0) then raise exception 'done with a wrong token'; end if;
  if not public.media_done(ev, tok, 'failed', 0.01) then raise exception 'done with the right token'; end if;
  if (select retry_after from public.media_jobs where event_id = ev) not between now() + interval '9 minutes' and now() + interval '11 minutes' then
    raise exception 'retry_after';
  end if;
  tok2 := public.media_claim(ev, pro, false);
  if tok2 is null then raise exception 'claim after a failure'; end if;
  if (select fail_reason from public.media_jobs where event_id = ev) is not null then raise exception 'claim clears the failure'; end if;
  perform public.media_done(ev, tok2, null, 0);

  -- the reader's RPC: Free and anon get null
  perform set_config('request.jwt.claims', json_build_object('sub', fr, 'role', 'authenticated')::text, true);
  set local role authenticated;
  if public.media_translation(ev) is not null then raise exception 'free reads'; end if;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  set local role anon;
  if public.media_translation(ev) is not null then raise exception 'anon reads'; end if;
  reset role;

  -- Pro, nothing saved yet
  perform set_config('request.jwt.claims', json_build_object('sub', pro, 'role', 'authenticated')::text, true);
  set local role authenticated;
  r := public.media_translation(ev);
  reset role;
  if r is null then raise exception 'pro gets nothing'; end if;
  if jsonb_array_length(r->'items') <> 0 or (r->>'todo')::int <> 3 or (r->>'limit')::int <> 3 or (r->>'used')::int <> 0
     or (r->>'working')::boolean or not (r->>'budget_left')::boolean then
    raise exception 'pro empty: %', r;
  end if;

  -- readings for P and S (S with speech off)
  perform set_config('request.jwt.claims', '', true);
  insert into public.media_readings (media_id, event_id, kind, description_he, description_en, texts, speech, model) values
    (p, ev, 'image', 'תמונה', 'picture', '[]', null, 'm'),
    (s, ev, 'video', 'סרטון', 'video', '[]', '{"state":"off"}', 'm');
  perform set_config('request.jwt.claims', json_build_object('sub', pro, 'role', 'authenticated')::text, true);
  set local role authenticated;
  r := public.media_translation(ev);
  reset role;
  if jsonb_array_length(r->'items') <> 2 or (r->>'todo')::int <> 1 then raise exception 'two saved: %', r; end if;
  if r->'items'->0->>'media_id' <> p::text or r->'items'->1->>'media_id' <> s::text then raise exception 'saved order'; end if;

  -- speech switched on: the 'off' video counts as new again
  update public.app_settings set value = 'true'::jsonb where key = 'media_audio_enabled';
  set local role authenticated;
  r := public.media_translation(ev);
  reset role;
  if (r->>'todo')::int <> 2 then raise exception 'todo with speech on: %', r; end if;
  -- retry cap (128): after two route failures the 'off' video is no longer new media
  update public.media_readings set speech = '{"state":"off","tries":1}' where media_id = s;
  set local role authenticated;
  r := public.media_translation(ev);
  reset role;
  if (r->>'todo')::int <> 2 then raise exception 'one failure still retried: %', r; end if;
  update public.media_readings set speech = '{"state":"off","tries":2}' where media_id = s;
  set local role authenticated;
  r := public.media_translation(ev);
  reset role;
  if (r->>'todo')::int <> 1 then raise exception 'two failures not capped: %', r; end if;
  update public.media_readings set speech = '{"state":"off"}' where media_id = s;
  update public.app_settings set value = 'false'::jsonb where key = 'media_audio_enabled';

  -- a vanished item's saved row is hidden
  update public.event_media set ready = false where id = p;
  set local role authenticated;
  r := public.media_translation(ev);
  reset role;
  if jsonb_array_length(r->'items') <> 1 then raise exception 'vanished item still shown: %', r; end if;

  -- a draft answers null
  perform set_config('request.jwt.claims', '', true);
  insert into public.events (title, occurred_at, created_by, status, category_id) values ('mt draft', now(), an, 'draft', cat) returning id into dr;
  perform set_config('request.jwt.claims', json_build_object('sub', pro, 'role', 'authenticated')::text, true);
  set local role authenticated;
  if public.media_translation(dr) is not null then raise exception 'draft answered'; end if;
  reset role;

  -- spend: readers only
  perform set_config('request.jwt.claims', '', true);
  n := public.media_spent_today();
  insert into public.ai_usage (fn, purpose, model, cost_usd) values
    ('event-agent', 'media_translate_staff', 'x', 50), ('event-agent', 'expand', 'x', 7), ('event-agent', 'media_translate', 'x', 3);
  if public.media_spent_today() - n < 3 or public.media_spent_today() - n >= 4 then raise exception 'spend counts readers only'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', pro, 'role', 'authenticated')::text, true);
  set local role authenticated;
  if (public.media_translation(ev)->>'budget_left')::boolean then raise exception 'pro budget left after $3'; end if;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', an, 'role', 'authenticated')::text, true);
  set local role authenticated;
  r := public.media_translation(ev);
  reset role;
  if not (r->>'budget_left')::boolean or not (r->>'staff')::boolean or r->>'limit' is not null then raise exception 'staff view: %', r; end if;
  -- the speech note (128): staff see it, readers get null
  reset role;
  perform set_config('request.jwt.claims', '', true);
  update public.media_jobs set speech_note = 'route 502 busy' where event_id = ev;
  perform set_config('request.jwt.claims', json_build_object('sub', an, 'role', 'authenticated')::text, true);
  set local role authenticated;
  if public.media_translation(ev)->>'speech_note' is distinct from 'route 502 busy' then raise exception 'staff note missing'; end if;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', pro, 'role', 'authenticated')::text, true);
  set local role authenticated;
  if jsonb_typeof(public.media_translation(ev)->'speech_note') <> 'null' then raise exception 'reader sees the note'; end if;
  reset role;
  perform set_config('request.jwt.claims', '', true);

  -- in flight: one staff lease and one reader lease
  insert into public.events (title, occurred_at, created_by, status, category_id) values ('mt e2', now(), an, 'published', cat) returning id into dr;
  n := (public.media_in_flight()->>'all')::int;
  perform public.media_claim(ev, an, true);
  perform public.media_claim(dr, pro, false);
  if (public.media_in_flight()->>'all')::int - n <> 2 then raise exception 'in flight all: %', public.media_in_flight(); end if;
  if (public.media_in_flight()->>'readers')::int < 1 then raise exception 'in flight readers'; end if;

  -- media_allowed
  r := public.media_allowed(pro);
  if not (r->>'enabled')::boolean or (r->>'limit')::int <> 3 then raise exception 'allowed pro: %', r; end if;
  if (public.media_allowed(fr)->>'enabled')::boolean then raise exception 'allowed free'; end if;
  if not (public.media_allowed(an)->>'staff')::boolean then raise exception 'allowed staff'; end if;

  -- plan rows
  if (select count(*) from public.plan_features where feature_key = 'media_translate') <> 5 then raise exception 'plan rows'; end if;
  if (select limit_value from public.plan_features where feature_key = 'media_translate' and plan_id = 'pro') <> 3
     or (select limit_value from public.plan_features where feature_key = 'media_translate' and plan_id = 'max') <> 10
     or (select limit_value from public.plan_features where feature_key = 'media_translate' and plan_id = 'intel') <> 10
     or (select enabled from public.plan_features where feature_key = 'media_translate' and plan_id = 'free')
     or (select enabled from public.plan_features where feature_key = 'media_translate' and plan_id = 'guest') then
    raise exception 'plan values';
  end if;

  raise exception 'MEDIA_TRANSLATION_ALL_OK';
end $$;
