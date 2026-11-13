-- EEI theatre pre-filter: a country name matches whole words only ("oman" is not inside "Romania").
-- Run inside begin; ... rollback;
do $$
declare
  u uuid := gen_random_uuid(); h text := repeat('c', 64);
  e_oman uuid; e_sult uuid; e_rom uuid; e_car uuid; ids uuid[];
  cat uuid := (select id from public.event_categories where slug = 'airstrike' limit 1);
begin
  perform set_config('request.jwt.claims', '', true);
  insert into auth.users (id, email, aud, role, email_confirmed_at) values (u, 'eei-c@e2e.test', 'authenticated', 'authenticated', now());
  insert into public.eei_theatres (hash, spec) values
    (h, '{"name":"Oman","areas":["c:oman","c:c.a.r (x)"],"countries":["oman","c.a.r (x)"],"boxes":[],"topics":[{"key":"cccccccc","label":"z"}]}');
  insert into public.events (title, occurred_at, created_by, status, country, category_id) values
    ('w oman', now() - interval '1 hour', u, 'published', 'Oman', cat) returning id into e_oman;
  insert into public.events (title, occurred_at, created_by, status, country, category_id) values
    ('w sult', now() - interval '1 hour', u, 'published', 'Sultanate of Oman', cat) returning id into e_sult;
  insert into public.events (title, occurred_at, created_by, status, country, category_id) values
    ('w rom', now() - interval '1 hour', u, 'published', 'Romania', cat) returning id into e_rom;
  insert into public.events (title, occurred_at, created_by, status, country, category_id) values
    ('w car', now() - interval '1 hour', u, 'published', 'C.A.R (X)', cat) returning id into e_car;
  select array_agg(id) into ids from public.eei_pending(h, 2000);
  if not (e_oman = any(ids)) then raise exception 'Oman missing'; end if;
  if not (e_sult = any(ids)) then raise exception 'Sultanate of Oman missing'; end if;
  if not (e_car = any(ids)) then raise exception 'special characters missing'; end if;
  if e_rom = any(ids) then raise exception 'Romania matched oman'; end if;
  raise exception 'EEI_WORDS_ALL_OK';
end $$;
