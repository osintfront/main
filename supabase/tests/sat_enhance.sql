-- Satellite enhance (migration 126): plans and quota, the shared cache, the worker queue (claim,
-- housekeeping, resolve / finish merges, expiry), RLS, storage access per product, grants.
-- Run on live as one statement right after the migration: the final exception rolls everything
-- back (that text = pass). Nothing is left behind.
create or replace function pg_temp.sr_as(p uuid) returns void language plpgsql as $$
begin
  execute 'reset role';
  if p is null then
    perform set_config('request.jwt.claims', '{"role":"anon"}', true);
    execute 'set local role anon';
  else
    perform set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
  end if;
end $$;
create or replace function pg_temp.sr_off() returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
end $$;
create or replace function pg_temp.sr_result(p_job uuid, p_scene date) returns jsonb language sql as $$
  select jsonb_build_object(
    'scene_date', p_scene, 'scene_id', 'S2B_TEST_' || p_scene, 'cloud_pct', 1.5,
    'south', 31.49, 'west', 34.44, 'north', 31.51, 'east', 34.46, 'width', 1024, 'height', 1030,
    'products', jsonb_build_object(
      'tci',  jsonb_build_object('sr', p_job || '/tci_sr.png',  'lr', p_job || '/tci_lr.png'),
      'irp',  jsonb_build_object('sr', p_job || '/irp_sr.png',  'lr', p_job || '/irp_lr.png'),
      'ndvi', jsonb_build_object('sr', p_job || '/ndvi_sr.png', 'lr', p_job || '/ndvi_lr.png')),
    'meta', jsonb_build_object('source', 'test', 'engine', 'bicubic_x4'));
$$;

do $$
declare
  fr uuid := gen_random_uuid(); pro uuid := gen_random_uuid(); pro2 uuid := gen_random_uuid();
  mx uuid := gen_random_uuid(); st uuid := gen_random_uuid(); ex uuid := gen_random_uuid();
  r jsonb; q jsonb; c jsonb; i int; n int;
  ja uuid; jb uuid; jc uuid; jd uuid; je uuid; jf uuid; jx uuid; jy uuid; jz uuid; req uuid;
  d date := (now() at time zone 'Asia/Jerusalem')::date - 3;
begin
  insert into auth.users (id, email, aud, role, email_confirmed_at) values
    (fr,   'satsr-free@e2e.test',  'authenticated', 'authenticated', now()),
    (pro,  'satsr-pro@e2e.test',   'authenticated', 'authenticated', now()),
    (pro2, 'satsr-pro2@e2e.test',  'authenticated', 'authenticated', now()),
    (mx,   'satsr-max@e2e.test',   'authenticated', 'authenticated', now()),
    (st,   'satsr-staff@e2e.test', 'authenticated', 'authenticated', now()),
    (ex,   'satsr-exp@e2e.test',   'authenticated', 'authenticated', now());
  update public.profiles set status = 'active', role = 'viewer', plan = 'free' where id = fr;
  update public.profiles set status = 'active', role = 'viewer', plan = 'pro' where id in (pro, pro2);
  update public.profiles set status = 'active', role = 'viewer', plan = 'max' where id = mx;
  update public.profiles set status = 'active', role = 'analyst', plan = 'free' where id = st;
  update public.profiles set status = 'active', role = 'viewer', plan = 'pro', plan_expires_at = now() - interval '1 day' where id = ex;
  update public.app_settings set value = 'true'::jsonb where key = 'enforce_plans';
  update public.app_settings set value = '1000'::jsonb where key = 'satsr_max_queue';

  -- plan rows
  assert (select count(*) from public.plan_features where feature_key = 'sat_enhance') = 5, 'five plan rows';
  assert (select enabled and limit_value = 3 from public.plan_features where feature_key = 'sat_enhance' and plan_id = 'pro'), 'pro 3';
  assert (select enabled and limit_value = 15 from public.plan_features where feature_key = 'sat_enhance' and plan_id = 'max'), 'max 15';
  assert (select enabled and limit_value = 15 from public.plan_features where feature_key = 'sat_enhance' and plan_id = 'intel'), 'intel 15';

  -- ── guests, Free, expired Pro ───────────────────────────────────────
  perform pg_temp.sr_as(null);
  q := public.satsr_my_quota();
  assert not (q->>'enabled')::bool and not (q->>'signed_in')::bool, 'guest quota ' || q::text;
  begin
    perform public.satsr_request(31.5, 34.45);
    raise exception 'anon may call satsr_request';
  exception when insufficient_privilege then null;
  end;
  begin
    perform 1 from public.satsr_jobs limit 1;
    raise exception 'anon reads satsr_jobs';
  exception when insufficient_privilege then null;
  end;
  perform pg_temp.sr_as(fr);
  r := public.satsr_request(31.5, 34.45);
  assert r->>'reason' = 'not_in_plan' and not (r->>'ok')::bool, 'free ' || r::text;
  q := public.satsr_my_quota();
  assert (q->>'signed_in')::bool and not (q->>'enabled')::bool, 'free quota ' || q::text;
  perform pg_temp.sr_as(ex);
  r := public.satsr_request(31.5, 34.45);
  assert r->>'reason' = 'not_in_plan', 'expired pro = free ' || r::text;
  -- no sub in the token
  perform set_config('request.jwt.claims', '{"role":"authenticated"}', true);
  r := public.satsr_request(31.5, 34.45);
  assert r->>'reason' = 'signup_required', 'no uid ' || r::text;
  -- plans not enforced: still closed for Free (paid tool), still limited for Pro (below)
  perform pg_temp.sr_off();
  update public.app_settings set value = 'false'::jsonb where key = 'enforce_plans';
  perform pg_temp.sr_as(fr);
  r := public.satsr_request(31.5, 34.45);
  assert r->>'reason' = 'not_in_plan', 'free with plans off ' || r::text;
  -- pending account
  perform pg_temp.sr_off();
  update public.profiles set status = 'pending' where id = fr;
  perform pg_temp.sr_as(fr);
  r := public.satsr_request(31.5, 34.45);
  assert r->>'reason' = 'signup_required', 'pending ' || r::text;

  -- ── Pro: 3 a day ────────────────────────────────────────────────────
  perform pg_temp.sr_as(pro);
  q := public.satsr_my_quota();
  assert (q->>'enabled')::bool and (q->>'limit')::int = 3 and (q->>'used')::int = 0 and not (q->>'staff')::bool, 'pro quota ' || q::text;
  r := public.satsr_request(70, 34.45);                        assert r->>'reason' = 'bad_input', 'lat 70 ' || r::text;
  r := public.satsr_request(31.5, 190);                        assert r->>'reason' = 'bad_input', 'lng 190 ' || r::text;
  r := public.satsr_request('NaN'::float8, 34.45);             assert r->>'reason' = 'bad_input', 'NaN ' || r::text;
  r := public.satsr_request(31.5, 34.45, date '2016-12-31');   assert r->>'reason' = 'bad_input', 'date too old ' || r::text;
  r := public.satsr_request(31.5, 34.45, current_date + 3);    assert r->>'reason' = 'bad_input', 'future date ' || r::text;
  r := public.satsr_request(31.5, 34.45, null, 'bicubic_x4');
  assert (r->>'ok')::bool and not (r->>'cache_hit')::bool and (r->>'used')::int = 1 and r->>'status' = 'queued', 'pro 1 ' || r::text;
  ja := (r->>'job_id')::uuid;
  r := public.satsr_request(31.51, 34.45, d);                  assert (r->>'ok')::bool and (r->>'used')::int = 2, 'pro 2 ' || r::text;
  jb := (r->>'job_id')::uuid;
  r := public.satsr_request(31.52, 34.45);                     assert (r->>'ok')::bool and (r->>'used')::int = 3, 'pro 3 ' || r::text;
  jc := (r->>'job_id')::uuid;
  r := public.satsr_request(31.53, 34.45);
  assert r->>'reason' = 'quota_exceeded' and (r->>'used')::int = 3 and (r->>'limit')::int = 3, 'pro 4 ' || r::text;
  -- asking again for my own queued cell: same job, not charged twice
  r := public.satsr_request(31.5002, 34.4502);
  assert (r->>'ok')::bool and (r->>'job_id')::uuid = ja and (r->>'used')::int = 3, 'own repeat ' || r::text;
  perform pg_temp.sr_off();
  assert (select engine from public.satsr_jobs where id = ja) = 'sen2sr_lite_rgbn_x4', 'engine choice ignored for viewers';
  assert (select cell_x = 6890 and cell_y = 6300 from public.satsr_jobs where id = ja), 'cell snap';
  assert (select count(*) from public.satsr_requests where user_id = pro) = 3, 'three requests';

  -- ── the cache: a second user gets it free ───────────────────────────
  perform pg_temp.sr_as(pro2);
  r := public.satsr_request(31.5004, 34.4496);
  assert (r->>'ok')::bool and (r->>'cache_hit')::bool and (r->>'job_id')::uuid = ja and (r->>'used')::int = 0, 'cache hit ' || r::text;
  r := public.satsr_request(31.51, 34.45, d);
  assert (r->>'cache_hit')::bool and (r->>'job_id')::uuid = jb, 'cache hit with date ' || r::text;
  q := public.satsr_my_quota();
  assert (q->>'used')::int = 0, 'cache hits are free ' || q::text;
  perform pg_temp.sr_off();
  assert (select not charged from public.satsr_requests where user_id = pro2 and job_id = ja), 'uncharged row';

  -- a failed job gives the use back
  update public.satsr_jobs set status = 'failed', error_code = 'no_scene', finished_at = now() where id = jc;
  perform pg_temp.sr_as(pro);
  q := public.satsr_my_quota();
  assert (q->>'used')::int = 2, 'failed job refunded ' || q::text;
  -- busy: the queue is full
  perform pg_temp.sr_off();
  update public.app_settings set value = to_jsonb((select count(*) from public.satsr_jobs where status = 'queued')) where key = 'satsr_max_queue';
  perform pg_temp.sr_as(pro);
  r := public.satsr_request(31.54, 34.45);
  assert r->>'reason' = 'busy', 'busy ' || r::text;
  perform pg_temp.sr_off();
  update public.app_settings set value = '1000'::jsonb where key = 'satsr_max_queue';
  perform pg_temp.sr_as(pro);
  r := public.satsr_request(31.54, 34.45);
  assert (r->>'ok')::bool and (r->>'used')::int = 3, 'after refund ' || r::text;
  jd := (r->>'job_id')::uuid;
  r := public.satsr_request(31.55, 34.45);
  assert r->>'reason' = 'quota_exceeded', 'limited while plans are off ' || r::text;

  -- ── Max 15, staff unlimited ─────────────────────────────────────────
  perform pg_temp.sr_as(mx);
  for i in 1..15 loop
    r := public.satsr_request(30 + i * 0.01, 35.0);
    assert (r->>'ok')::bool and (r->>'used')::int = i, 'max ' || i || ' ' || r::text;
  end loop;
  r := public.satsr_request(30.5, 35.0);
  assert r->>'reason' = 'quota_exceeded' and (r->>'limit')::int = 15, 'max 16 ' || r::text;
  perform pg_temp.sr_as(st);
  q := public.satsr_my_quota();
  assert (q->>'staff')::bool and (q->'limit') = 'null'::jsonb and (q->>'enabled')::bool, 'staff quota ' || q::text;
  for i in 1..20 loop
    r := public.satsr_request(29 + i * 0.01, 35.0);
    assert (r->>'ok')::bool and (r->'limit') = 'null'::jsonb, 'staff ' || i || ' ' || r::text;
  end loop;
  r := public.satsr_request(28.5, 35.0, null, 'bicubic_x4');
  assert (select engine from public.satsr_jobs where id = (r->>'job_id')::uuid) = 'bicubic_x4', 'staff engine choice';
  r := public.satsr_request(28.6, 35.0, null, 'nope');
  assert (select engine from public.satsr_jobs where id = (r->>'job_id')::uuid) = 'sen2sr_lite_rgbn_x4', 'unknown engine → default';
  perform pg_temp.sr_off();

  -- ── the worker ──────────────────────────────────────────────────────
  q := public.satsr_my_quota();
  assert not (q->>'worker_online')::bool, 'no worker yet';
  -- X: stale running job (reclaim), Y: out of attempts (timeout), Z: queued 49 h (expired)
  insert into public.satsr_jobs (engine, cell_x, cell_y, status, attempts, claimed_at, created_at)
  values ('sen2sr_lite_rgbn_x4', 1, 1, 'running', 1, now() - interval '20 minutes', now() - interval '2 hours') returning id into jx;
  insert into public.satsr_jobs (engine, cell_x, cell_y, status, attempts, claimed_at, created_at)
  values ('sen2sr_lite_rgbn_x4', 2, 2, 'running', 3, now() - interval '20 minutes', now() - interval '3 hours') returning id into jy;
  insert into public.satsr_jobs (engine, cell_x, cell_y, status, created_at)
  values ('sen2sr_lite_rgbn_x4', 3, 3, 'queued', now() - interval '49 hours') returning id into jz;
  c := public.satsr_claim('test-worker', '{"engine":"bicubic_x4","device":"cpu"}');
  assert (c->>'job_id')::uuid = jx and (c->>'attempt')::int = 2, 'claim oldest / reclaim stale ' || c::text;
  assert (select status = 'running' and attempts = 2 and worker = 'test-worker' from public.satsr_jobs where id = jx), 'claimed';
  assert (select status = 'failed' and error_code = 'timeout' from public.satsr_jobs where id = jy), 'timeout';
  assert (select status = 'failed' and error_code = 'expired' from public.satsr_jobs where id = jz), 'expired';
  perform pg_temp.sr_as(pro);
  q := public.satsr_my_quota();
  assert (q->>'worker_online')::bool, 'worker online after claim ' || q::text;
  perform pg_temp.sr_off();
  update public.satsr_workers set last_seen = now() - interval '10 minutes';
  assert not public.satsr_worker_online(), 'offline after 10 minutes';
  perform public.satsr_heartbeat('test-worker', '{}');
  assert public.satsr_worker_online(), 'heartbeat';
  -- a fresh queued job is picked before newer ones
  update public.satsr_jobs set created_at = now() - interval '1 hour' where id = ja;
  c := public.satsr_claim('test-worker', '{}');
  assert (c->>'job_id')::uuid = ja and (c->>'lat')::float8 = 31.5 and (c->>'lng')::float8 = 34.45 and c->>'engine' = 'sen2sr_lite_rgbn_x4', 'claim A ' || c::text;
  -- requeue on a generic error, then done
  perform public.satsr_finish(jx, 'queued', '{"error":"temporary"}');
  assert (select status = 'queued' and error = 'temporary' and finished_at is null from public.satsr_jobs where id = jx), 'requeued';
  r := public.satsr_resolve(ja, date '2026-11-10', 'S2B_A');
  assert not (r->>'merged')::bool, 'resolve A ' || r::text;
  r := public.satsr_finish(ja, 'done', pg_temp.sr_result(ja, date '2026-11-10'));
  assert (r->>'updated')::bool and not (r->>'merged')::bool, 'finish A ' || r::text;
  assert (select status = 'done' and products ? 'irp' and width = 1024 and scene_date = date '2026-11-10' and error_code is null
            from public.satsr_jobs where id = ja), 'A done';
  r := public.satsr_finish(ja, 'failed', '{"error":"late"}');
  assert not (r->>'updated')::bool, 'only running jobs are updated';
  -- bad products are refused
  update public.satsr_jobs set status = 'running', claimed_at = now() where id = jb;
  begin
    perform public.satsr_finish(jb, 'done', jsonb_build_object('products', jsonb_build_object('tci', jsonb_build_object('sr', ja || '/tci_sr.png', 'lr', ja || '/tci_lr.png'))));
    raise exception 'foreign paths accepted';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.satsr_finish(jb, 'done', '{"products":{}}');
    raise exception 'empty products accepted';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.satsr_finish(jb, 'bogus', '{}');
    raise exception 'bad status accepted';
  exception when invalid_parameter_value then null;
  end;
  r := public.satsr_finish(jb, 'failed', '{"error_code":"weird","error":"boom"}');
  assert (select status = 'failed' and error_code = 'engine_error' from public.satsr_jobs where id = jb), 'unknown error code → engine_error';

  -- resolve merge: pro2 asks for another day of cell A, the worker finds A's picture
  perform pg_temp.sr_as(pro2);
  r := public.satsr_request(31.5, 34.45, date '2026-11-09');
  assert (r->>'ok')::bool and not (r->>'cache_hit')::bool and (r->>'used')::int = 1, 'pro2 new ' || r::text;
  je := (r->>'job_id')::uuid; req := (r->>'request_id')::uuid;
  perform pg_temp.sr_off();
  update public.satsr_jobs set status = 'running', claimed_at = now(), attempts = 1 where id = je;
  r := public.satsr_resolve(je, date '2026-11-10', 'S2B_A');
  assert (r->>'merged')::bool and (r->>'into')::uuid = ja, 'resolve merge ' || r::text;
  assert not exists (select 1 from public.satsr_jobs where id = je), 'merged job deleted';
  -- pro2 already had a request on A (cache hit): that one stays, the new one goes with the job
  assert (select count(*) from public.satsr_requests where user_id = pro2 and job_id = ja) = 1, 'one request on A';
  assert public.satsr_used(pro2) = 0, 'merge uncharges';
  -- max asks too; its job finishes the same picture at the last moment (unique index) → merge with orphans
  update public.app_settings set value = 'true'::jsonb where key = 'enforce_plans';
  update public.plan_features set limit_value = 16 where feature_key = 'sat_enhance' and plan_id = 'max';
  perform pg_temp.sr_as(mx);
  r := public.satsr_request(31.5, 34.45, date '2026-11-08');
  assert (r->>'ok')::bool and (r->>'used')::int = 16, 'max new ' || r::text;
  jf := (r->>'job_id')::uuid; req := (r->>'request_id')::uuid;
  perform pg_temp.sr_off();
  update public.satsr_jobs set status = 'running', claimed_at = now(), attempts = 1 where id = jf;
  r := public.satsr_finish(jf, 'done', pg_temp.sr_result(jf, date '2026-11-10'));
  assert (r->>'merged')::bool and (r->>'into')::uuid = ja and jsonb_array_length(r->'orphans') = 6
     and r->'orphans' ? (jf || '/ndvi_lr.png'), 'finish merge ' || r::text;
  assert (select job_id = ja and not charged from public.satsr_requests where id = req), 'request repointed, same id';
  assert public.satsr_used(mx) = 15, 'max refunded by the merge';

  -- ── what each user can read ─────────────────────────────────────────
  perform pg_temp.sr_as(pro);
  assert (select count(*) from public.satsr_requests) = (select count(*) from public.satsr_requests where user_id = pro), 'own requests only';
  assert (select count(*) from public.satsr_jobs) = 4, 'pro sees its 4 jobs';
  assert (select count(*) from public.satsr_workers) = 0, 'workers: staff only';
  begin
    perform created_by from public.satsr_jobs limit 1;
    raise exception 'created_by readable';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.satsr_jobs (engine, cell_x, cell_y) values ('x', 0, 0);
    raise exception 'direct insert allowed';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.satsr_requests (user_id, job_id, lat, lng, charged) values (pro, ja, 0, 0, false);
    raise exception 'direct request insert allowed';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.satsr_jobs set status = 'done' where id = jd;
    raise exception 'direct update allowed';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.satsr_claim('evil', '{}');
    raise exception 'browser can claim';
  exception when insufficient_privilege then null;
  end;
  select count(*) into n from public.satsr_my_jobs(50);
  assert n = 4, 'my jobs ' || n;
  assert (select products ? 'tci' and not cache_hit and queue_pos is null from public.satsr_my_jobs(50) where job_id = ja), 'my done job';
  assert (select queue_pos >= 1 and products is null from public.satsr_my_jobs(50) where job_id = jd), 'queued: position, no products';
  perform pg_temp.sr_as(pro2);
  assert exists (select 1 from public.satsr_jobs where id = ja), 'cache hit makes the job visible';
  assert not exists (select 1 from public.satsr_jobs where id = jd), 'others'' jobs hidden';
  assert (select cache_hit from public.satsr_my_jobs(50) where job_id = ja), 'my_jobs cache_hit';
  perform pg_temp.sr_off();
  n := (select count(*) from public.satsr_jobs);
  perform pg_temp.sr_as(st);
  assert (select count(*) from public.satsr_jobs) = n and n > 40, 'staff sees every job';
  assert (select count(*) from public.satsr_workers) = 1, 'staff sees workers';

  -- ── result files ────────────────────────────────────────────────────
  perform pg_temp.sr_as(pro);
  assert public.satsr_object_allowed(ja || '/tci_sr.png'), 'pro tci sr';
  assert public.satsr_object_allowed(ja || '/irp_lr.png'), 'pro irp lr';
  assert public.satsr_object_allowed(ja || '/ndvi_sr.png'), 'pro ndvi sr';
  assert not public.satsr_object_allowed(ja || '/other.png'), 'unlisted file';
  assert not public.satsr_object_allowed('not-a-uuid/tci_sr.png'), 'bad prefix';
  assert not public.satsr_object_allowed(ja::text), 'bare id';
  assert not public.satsr_object_allowed(jd || '/tci_sr.png'), 'unfinished job';
  perform pg_temp.sr_as(pro2);
  assert public.satsr_object_allowed(ja || '/irp_sr.png'), 'cache-hit user';
  perform pg_temp.sr_as(st);
  assert public.satsr_object_allowed(ja || '/ndvi_lr.png'), 'staff';
  perform pg_temp.sr_off();
  update public.profiles set status = 'active' where id = fr;
  perform pg_temp.sr_as(fr);
  assert not public.satsr_object_allowed(ja || '/tci_sr.png'), 'stranger';
  -- the real storage policy
  perform pg_temp.sr_off();
  insert into storage.objects (bucket_id, name) values
    ('satsr-results', ja || '/tci_sr.png'), ('satsr-results', ja || '/tci_lr.png'), ('satsr-results', ja || '/stray.png');
  perform pg_temp.sr_as(pro);
  assert (select count(*) from storage.objects where bucket_id = 'satsr-results') = 2, 'pro sees the 2 listed files';
  perform pg_temp.sr_as(fr);
  assert (select count(*) from storage.objects where bucket_id = 'satsr-results') = 0, 'stranger sees none';
  perform pg_temp.sr_off();
  assert (select not public and file_size_limit = 8388608 from storage.buckets where id = 'satsr-results'), 'private bucket';

  -- ── retention ───────────────────────────────────────────────────────
  update public.satsr_jobs set finished_at = now() - interval '61 days' where id = ja;
  c := public.satsr_expired(50);
  assert jsonb_array_length(c) = 6 and c ? (ja || '/tci_sr.png') and c ? (ja || '/ndvi_lr.png'), 'expired paths ' || c::text;
  assert not exists (select 1 from public.satsr_jobs where id = ja), 'expired job deleted';
  assert not exists (select 1 from public.satsr_requests where job_id = ja), 'its requests too';

  -- ── grants ──────────────────────────────────────────────────────────
  assert not has_function_privilege('authenticated', 'public.satsr_claim(text, jsonb)', 'execute'), 'claim';
  assert not has_function_privilege('authenticated', 'public.satsr_finish(uuid, text, jsonb)', 'execute'), 'finish';
  assert not has_function_privilege('authenticated', 'public.satsr_resolve(uuid, date, text)', 'execute'), 'resolve';
  assert not has_function_privilege('authenticated', 'public.satsr_heartbeat(text, jsonb)', 'execute'), 'heartbeat';
  assert not has_function_privilege('authenticated', 'public.satsr_expired(int)', 'execute'), 'expired';
  assert not has_function_privilege('authenticated', 'public.satsr_merge(uuid, uuid)', 'execute'), 'merge';
  assert not has_function_privilege('authenticated', 'public.satsr_used(uuid)', 'execute'), 'used';
  assert not has_function_privilege('authenticated', 'public.satsr_worker_online()', 'execute'), 'online';
  assert not has_function_privilege('authenticated', 'public.satsr_setting(text)', 'execute'), 'setting';
  assert not has_function_privilege('anon', 'public.satsr_claim(text, jsonb)', 'execute'), 'anon claim';
  assert not has_function_privilege('anon', 'public.satsr_request(double precision, double precision, date, text)', 'execute'), 'anon request';
  assert not has_function_privilege('anon', 'public.satsr_my_jobs(int)', 'execute'), 'anon my_jobs';
  assert has_function_privilege('anon', 'public.satsr_my_quota()', 'execute'), 'anon quota';
  assert has_function_privilege('authenticated', 'public.satsr_request(double precision, double precision, date, text)', 'execute'), 'request';
  assert has_function_privilege('service_role', 'public.satsr_claim(text, jsonb)', 'execute'), 'service claim';
  assert has_function_privilege('service_role', 'public.satsr_finish(uuid, text, jsonb)', 'execute'), 'service finish';
  assert (select bool_and(p.prosecdef and p.proconfig @> array['search_path=""'])
            from pg_proc p join pg_namespace s on s.oid = p.pronamespace
           where s.nspname = 'public' and p.proname like 'satsr\_%' and p.proname <> 'satsr_product_paths'), 'security definer + empty search_path';

  raise exception 'SAT_ENHANCE_ALL_OK';
end $$;
