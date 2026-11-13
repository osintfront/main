-- events_gaza_country: an automatic write with a pin in the Gaza Strip and country Israel → Palestine;
-- a statement, a pin outside the Strip (Nir Oz) and a staff edit stay as they are.
-- Run on live inside begin; ... rollback; the final exception text GAZA_COUNTRY_ALL_OK = pass.
do $$
declare
  u uuid := gen_random_uuid(); staff uuid := gen_random_uuid();
  air uuid := (select id from public.event_categories where slug = 'airstrike' limit 1);
  st uuid := (select id from public.event_categories where slug = 'statements' limit 1);
  e1 uuid; e2 uuid; e3 uuid; e4 uuid; e5 uuid;
begin
  perform set_config('request.jwt.claims', '', true);
  insert into auth.users (id, email, aud, role, email_confirmed_at) values
    (u, 'gaza-c@e2e.test', 'authenticated', 'authenticated', now()), (staff, 'gaza-s@e2e.test', 'authenticated', 'authenticated', now());
  -- Daraj, Gaza City
  insert into public.events (title, occurred_at, created_by, status, country, latitude, longitude, category_id)
    values ('gz strike', now(), u, 'draft', 'Israel', 31.508, 34.465, air) returning id into e1;
  if (select country from public.events where id = e1) <> 'Palestine' then raise exception 'Gaza strike stayed Israel'; end if;
  -- a statement pinned in Gaza keeps the speaker
  insert into public.events (title, occurred_at, created_by, status, country, latitude, longitude, category_id)
    values ('gz statement', now(), u, 'draft', 'Israel', 31.508, 34.465, st) returning id into e2;
  if (select country from public.events where id = e2) <> 'Israel' then raise exception 'statement changed'; end if;
  -- Nir Oz (Israel, next to the border)
  insert into public.events (title, occurred_at, created_by, status, country, latitude, longitude, category_id)
    values ('nir oz', now(), u, 'draft', 'Israel', 31.3095, 34.4015, air) returning id into e3;
  if (select country from public.events where id = e3) <> 'Israel' then raise exception 'Nir Oz moved to Palestine'; end if;
  -- the pin arrives later (the editor places it): fixed on that update
  insert into public.events (title, occurred_at, created_by, status, country, category_id)
    values ('gz later', now(), u, 'draft', 'Israel', air) returning id into e4;
  update public.events set latitude = 31.418, longitude = 34.35 where id = e4; -- Deir al-Balah
  if (select country from public.events where id = e4) <> 'Palestine' then raise exception 'later pin not fixed'; end if;
  -- a signed-in staff member sets Israel on a Gaza pin: kept
  insert into public.events (title, occurred_at, created_by, status, country, latitude, longitude, category_id)
    values ('gz staff', now(), u, 'draft', 'Lebanon', 31.508, 34.465, air) returning id into e5;
  perform set_config('request.jwt.claims', json_build_object('sub', staff, 'role', 'authenticated')::text, true);
  update public.events set country = 'Israel' where id = e5;
  perform set_config('request.jwt.claims', '', true);
  if (select country from public.events where id = e5) <> 'Israel' then raise exception 'staff choice overridden'; end if;
  raise exception 'GAZA_COUNTRY_ALL_OK';
end $$;
