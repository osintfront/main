-- Free-text EEI: owner-only lists, shared tables closed to users, marks per caller, lease, daily
-- counters, the theatre pre-filter and plan gating. Run inside begin; ... rollback;
do $$
declare
  a uuid := gen_random_uuid(); b uuid := gen_random_uuid();
  h_a text := repeat('a', 64); h_b text := repeat('b', 64);
  e_ok uuid; e_tagged uuid; e_old uuid; e_draft uuid; e_other uuid; e_b uuid;
  r jsonb; n int; ok boolean; i int; cnt int := 0;
begin
  insert into auth.users (id, email, aud, role, email_confirmed_at) values
    (a, 'eei-a@e2e.test', 'authenticated', 'authenticated', now()),
    (b, 'eei-b@e2e.test', 'authenticated', 'authenticated', now());
  update public.profiles set status = 'active', plan = 'pro' where id = a;
  update public.profiles set status = 'active', plan = 'free' where id = b;
  update public.app_settings set value = 'true'::jsonb where key = 'enforce_plans';

  insert into public.eei_theatres (hash, spec) values
    (h_a, '{"name":"Lebanon","areas":["lebanon"],"countries":["lebanon","לבנון"],"boxes":[[33.05,35.1,34.7,36.62]],"topics":[{"key":"aaaaaaaa","label":"x"}]}'),
    (h_b, '{"name":"Iran","areas":["iran"],"countries":["iran"],"boxes":[],"topics":[{"key":"bbbbbbbb","label":"y"}]}');
  insert into public.eei_lists (user_id, list) values
    (a, jsonb_build_object('theatres', jsonb_build_array(jsonb_build_object('hash', h_a, 'kind', 'theatre')))),
    (b, jsonb_build_object('theatres', jsonb_build_array(jsonb_build_object('hash', h_b, 'kind', 'theatre'))));

  insert into public.events (title, occurred_at, created_by, status, country, latitude, longitude) values
    ('eei ok', now() - interval '1 hour', a, 'published', 'Lebanon', 33.27, 35.2) returning id into e_ok;
  insert into public.events (title, occurred_at, created_by, status, country) values
    ('eei tagged', now() - interval '2 hours', a, 'published', 'Lebanon') returning id into e_tagged;
  insert into public.events (title, occurred_at, created_by, status, country) values
    ('eei old', now() - interval '30 hours', a, 'published', 'Lebanon') returning id into e_old;
  insert into public.events (title, occurred_at, created_by, status, country) values
    ('eei draft', now() - interval '1 hour', a, 'draft', 'Lebanon') returning id into e_draft;
  insert into public.events (title, occurred_at, created_by, status, country, latitude, longitude) values
    ('eei other', now() - interval '1 hour', a, 'published', 'Iran', 35.69, 51.39) returning id into e_other;
  insert into public.events (title, occurred_at, created_by, status, country) values
    ('eei b', now() - interval '1 hour', a, 'published', 'Iran') returning id into e_b;
  insert into public.eei_tags (theatre_hash, event_id, topics) values (h_a, e_tagged, '{aaaaaaaa}'), (h_b, e_b, '{bbbbbbbb}');

  -- pending: only the untagged, fresh, published Lebanon event
  select count(*) into n from public.eei_pending(h_a, 2000) p where p.id in (e_ok, e_tagged, e_old, e_draft, e_other);
  assert n = 1, 'pending count ' || n;
  assert exists (select 1 from public.eei_pending(h_a, 2000) p where p.id = e_ok), 'pending misses the fresh event';

  -- lease: one owner; renew / release only by the owner
  declare tok uuid := public.eei_claim(h_a); begin
    assert tok is not null, 'first claim';
    assert public.eei_claim(h_a) is null, 'second claim must fail';
    assert not public.eei_renew(h_a, gen_random_uuid()), 'a stranger renewed the lease';
    assert public.eei_renew(h_a, tok), 'the owner could not renew';
    perform public.eei_release(h_a, gen_random_uuid());
    assert public.eei_claim(h_a) is null, 'a stranger released the lease';
    perform public.eei_release(h_a, tok);
  end;

  -- daily counter: 5 splits
  for i in 1..6 loop if public.eei_count(a, 'parse') then cnt := cnt + 1; end if; end loop;
  assert cnt = 5, 'parse count ' || cnt;

  -- plan gating
  assert (public.eei_allowed(a)->>'enabled')::boolean, 'pro must be allowed';
  assert not (public.eei_allowed(b)->>'enabled')::boolean, 'free must not be allowed';

  -- as user A
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.eei_lists where user_id = b;
  assert n = 0, 'A sees B''s list';
  begin perform 1 from public.eei_theatres limit 1; assert false, 'eei_theatres readable'; exception when insufficient_privilege then null; end;
  begin perform 1 from public.eei_tags limit 1; assert false, 'eei_tags readable'; exception when insufficient_privilege then null; end;
  r := public.eei_my_tags();
  assert jsonb_array_length(r->'tags') = 1, 'A marks ' || r;
  assert r->'tags'->0->>'h' = h_a, 'A got another theatre ' || r;
  reset role;
end $$;
