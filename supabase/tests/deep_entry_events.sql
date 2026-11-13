-- deep_entry: the entry's events are its related ids and the events marked with one of its names,
-- published or archived only, not deleted, newest first, at most 12.
-- Run on live inside begin; ... rollback; the final exception text DEEP_EVENTS_ALL_OK = pass.
do $$
declare
  pro uuid := gen_random_uuid();
  cat uuid := (select id from public.event_categories where slug = 'uav' limit 1);
  en uuid; rel uuid; termed uuid; draft uuid; gone uuid; other uuid; r jsonb; ids text[];
begin
  perform set_config('request.jwt.claims', '', true);
  insert into auth.users (id, email, aud, role, email_confirmed_at) values (pro, 'deep-ev@e2e.test', 'authenticated', 'authenticated', now());
  update public.profiles set status = 'active', role = 'viewer', plan = 'pro' where id = pro;
  update public.app_settings set value = 'true'::jsonb where key = 'enforce_plans';
  insert into public.events (title, occurred_at, created_by, status, category_id) values ('dee related', now() - interval '3 hours', pro, 'published', cat) returning id into rel;
  insert into public.events (title, occurred_at, created_by, status, category_id) values ('dee termed', now() - interval '1 hour', pro, 'published', cat) returning id into termed;
  insert into public.events (title, occurred_at, created_by, status, category_id) values ('dee draft', now() - interval '2 hours', pro, 'draft', cat) returning id into draft;
  insert into public.events (title, occurred_at, created_by, status, category_id, deleted_at) values ('dee gone', now() - interval '2 hours', pro, 'published', cat, now()) returning id into gone;
  insert into public.events (title, occurred_at, created_by, status, category_id) values ('dee other', now() - interval '2 hours', pro, 'published', cat) returning id into other;
  insert into public.deep_entries (kind, name_en, summary_en, related_event_ids) values ('weapon', 'Zzq Drone', 'x', array[rel, draft]) returning id into en;
  insert into public.deep_aliases (alias, entry_id) values ('zzq drone', en);
  insert into public.event_terms (event_id, key, keys, kind, en, name) values
    (termed, 'zzq drone', '{zzq drone}', 'weapon', 'Zzq', 'Zzq Drone'),
    (gone, 'zzq drone', '{zzq drone}', 'weapon', 'Zzq', 'Zzq Drone'),
    (other, 'qqq', '{qqq}', 'weapon', 'Q', 'Q');
  perform set_config('request.jwt.claims', json_build_object('sub', pro, 'role', 'authenticated')::text, true);
  set local role authenticated;
  r := public.deep_entry(en);
  reset role;
  select array_agg(x) into ids from jsonb_array_elements_text(r->'events') x;
  if ids is distinct from array[termed::text, rel::text] then raise exception 'events: % (want termed, related)', ids; end if;
  raise exception 'DEEP_EVENTS_ALL_OK';
end $$;
