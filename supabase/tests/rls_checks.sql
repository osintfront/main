-- ════════════════════════════════════════════════════════════════════
-- Osintfront · security smoke tests
-- Run in the Supabase SQL editor (or psql as postgres) AFTER the demo
-- seed. Everything runs inside a transaction that is rolled back, so it
-- changes nothing. Any failed check aborts with "FAIL: …".
--
-- Impersonation uses the same mechanism PostgREST uses: a role plus
-- request.jwt.claims. That makes these checks equivalent to a malicious
-- client hand-editing its API requests.
-- ════════════════════════════════════════════════════════════════════
begin;

create temporary table _ids on commit drop as
select
  (select id from public.profiles where email = 'demo-superadmin@example.com') as super_id,
  (select id from public.profiles where email = 'demo-admin@example.com')      as admin_id,
  (select id from public.profiles where email = 'demo-editor@example.com')     as editor_id,
  (select id from public.profiles where email = 'demo-viewer@example.com')     as viewer_id,
  (select id from public.events where status = 'draft' limit 1)                as draft_id,
  (select id from public.events where status = 'published' limit 1)           as published_id,
  (select id from public.event_categories where slug = 'fire')                 as fire_id;
grant select on _ids to anon, authenticated;

create or replace function pg_temp.act_as(p_user uuid) returns void language plpgsql as $$
begin
  if p_user is null then
    perform set_config('request.jwt.claims', '{"role":"anon"}', true);
    execute 'set local role anon';
  else
    perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
  end if;
end $$;

create or replace function pg_temp.expect_error(p_sql text, p_label text) returns void language plpgsql as $$
begin
  execute p_sql;
  raise exception 'FAIL: % — statement succeeded but should have been blocked', p_label;
exception
  when raise_exception then
    if sqlerrm like 'FAIL:%' then raise; end if;
    raise notice 'ok   %  (%)', p_label, sqlerrm;
  when others then
    raise notice 'ok   %  (%)', p_label, sqlerrm;
end $$;

create or replace function pg_temp.check(p_cond boolean, p_label text) returns void language plpgsql as $$
begin
  if not coalesce(p_cond, false) then raise exception 'FAIL: %', p_label; end if;
  raise notice 'ok   %', p_label;
end $$;

-- ── Public (anon) ────────────────────────────────────────────────────
select pg_temp.act_as(null);
select pg_temp.check((select count(*) from public.published_events) > 0, 'anon reads published_events view');
select pg_temp.check(not exists (select 1 from public.events where status <> 'published'), 'anon cannot see unpublished rows in events');
select pg_temp.check((select count(*) from public.events where id = (select draft_id from _ids)) = 0, 'anon cannot fetch a draft by id');
select pg_temp.expect_error('select original_report_text from public.events limit 1', 'anon cannot read report text column');
select pg_temp.expect_error('select created_by from public.events limit 1', 'anon cannot read event ownership');
select pg_temp.expect_error('select * from public.profiles', 'anon cannot read profiles');
select pg_temp.expect_error('select * from public.audit_logs', 'anon cannot read audit logs');
select pg_temp.expect_error('select * from public.administrator_invitations', 'anon cannot read invitations');
select pg_temp.expect_error('select * from public.event_internal_notes', 'anon cannot read internal notes');
select pg_temp.expect_error($q$insert into public.events (title, occurred_at, created_by) values ('x', now(), (select editor_id from _ids))$q$, 'anon cannot insert events');
select pg_temp.check(not exists (select 1 from public.event_categories where not is_active), 'anon sees only active categories');
reset role;

-- ── Editor ───────────────────────────────────────────────────────────
select pg_temp.act_as((select editor_id from _ids));
select pg_temp.check(
  (select count(*) from public.events where status = 'draft') = (select count(*) from public.events where status = 'draft' and created_by = (select editor_id from _ids)),
  'editor sees only their own drafts');
select pg_temp.check((select count(*) from public.audit_logs) = 0, 'editor gets no audit rows');
select pg_temp.check((select count(*) from public.profiles) = 1, 'editor sees only own profile');
select pg_temp.expect_error($q$update public.profiles set role = 'admin' where id = (select editor_id from _ids)$q$, 'editor cannot promote self');
select pg_temp.expect_error($q$update public.profiles set last_login_at = '2000-01-01' where id = (select editor_id from _ids)$q$, 'last_login_at cannot be forged');
select pg_temp.expect_error($q$update public.profiles set status = 'suspended' where id = (select editor_id from _ids)$q$, 'editor cannot change own status');
select public.record_login();
select pg_temp.check((select last_login_at = now() from public.profiles where id = (select editor_id from _ids)), 'record_login stamps last_login_at');
update public.profiles set full_name = 'Hacked' where id = (select viewer_id from _ids);
reset role;
select pg_temp.check((select full_name from public.profiles where id = (select viewer_id from _ids)) <> 'Hacked', 'editor cannot edit other profiles');
select pg_temp.act_as((select editor_id from _ids));

-- Ownership spoofing: created_by is forced to the caller.
insert into public.events (title, original_report_text, occurred_at, created_by, category_id, status)
values ('Editor draft', 'test', now(), (select admin_id from _ids), (select fire_id from _ids), 'draft');
select pg_temp.check(
  (select created_by from public.events where title = 'Editor draft') = (select editor_id from _ids),
  'created_by cannot be spoofed on insert');
select pg_temp.expect_error($q$update public.events set created_by = (select admin_id from _ids) where title = 'Editor draft'$q$, 'created_by cannot be changed on update');
select pg_temp.expect_error($q$insert into public.events (title, occurred_at, created_by, category_id, status, latitude, longitude) values ('Sneaky publish', now(), (select editor_id from _ids), (select fire_id from _ids), 'published', 31.7, 35.2)$q$, 'editor cannot insert as published');
update public.events set status = 'pending_review' where title = 'Editor draft';
select pg_temp.check((select status from public.events where title = 'Editor draft') = 'pending_review', 'editor can submit own draft for review');
update public.events set title = 'Edited after submit' where title = 'Editor draft';
select pg_temp.check(exists (select 1 from public.events where title = 'Editor draft'), 'editor cannot edit once submitted (RLS hides it from UPDATE)');
select pg_temp.expect_error($q$insert into public.administrator_invitations (email, intended_role, token) values ('x@example.org', 'viewer', '')$q$, 'editor cannot invite users');
select pg_temp.expect_error($q$select public.write_audit('fake', 'x', null, '{}')$q$, 'editor cannot forge audit entries');
select pg_temp.expect_error($q$insert into public.audit_logs (action, entity_type) values ('fake', 'x')$q$, 'editor cannot insert audit rows directly');
reset role;

-- ── Viewer ───────────────────────────────────────────────────────────
select pg_temp.act_as((select viewer_id from _ids));
select pg_temp.check(not exists (select 1 from public.events where status = 'draft'), 'viewer cannot see drafts');
select pg_temp.check(exists (select 1 from public.events where status = 'pending_review'), 'viewer sees operational (pending) events');
select pg_temp.expect_error($q$insert into public.events (title, occurred_at, created_by) values ('v', now(), (select viewer_id from _ids))$q$, 'viewer cannot create events');
reset role;

-- ── Admin ────────────────────────────────────────────────────────────
select pg_temp.act_as((select admin_id from _ids));
select pg_temp.check(exists (select 1 from public.events where status = 'draft'), 'admin sees all drafts');
select pg_temp.expect_error($q$update public.events set status = 'published' where title = 'Explosion reported in Gaza'$q$, 'publishing without coordinates is blocked');
select pg_temp.expect_error($q$update public.events set status = 'rejected' where title = 'Editor draft'$q$, 'rejecting without a reason is blocked');
select pg_temp.expect_error($q$update public.events set status = 'published' where title = 'Editor draft' and status = 'pending_review'$q$, 'publishing needs coordinates (Editor draft has none)');
update public.events set latitude = 31.78, longitude = 35.21 where title = 'Editor draft';
update public.events set status = 'published' where title = 'Editor draft' and status = 'pending_review';
select pg_temp.check((select published_at is not null and approved_by = (select admin_id from _ids) from public.events where title = 'Editor draft'), 'publish sets published_at and approved_by server-side');
select pg_temp.expect_error($q$update public.events set status = 'draft' where title = 'Editor draft'$q$, 'invalid transition published → draft is blocked');
select pg_temp.check(exists (select 1 from public.event_history h join public.events e on e.id = h.event_id where e.title = 'Editor draft' and h.action = 'approved_and_published'), 'history records the publication');
select pg_temp.check(exists (select 1 from public.audit_logs where action = 'event.approved_and_published'), 'audit log records the publication');
select pg_temp.expect_error($q$update public.profiles set role = 'super_admin' where id = (select editor_id from _ids)$q$, 'admin cannot create a super admin');
select pg_temp.expect_error($q$update public.profiles set role = 'admin' where id = (select editor_id from _ids)$q$, 'admin cannot promote to admin');
select pg_temp.expect_error($q$update public.profiles set status = 'suspended' where id = (select super_id from _ids)$q$, 'admin cannot suspend a super admin');
select pg_temp.expect_error($q$update public.profiles set status = 'suspended' where id = (select admin_id from _ids)$q$, 'admin cannot suspend self');
select pg_temp.expect_error($q$insert into public.administrator_invitations (email, intended_role, token) values ('new-admin@example.org', 'admin', '')$q$, 'admin cannot invite admins');
insert into public.administrator_invitations (email, full_name, intended_role, token) values ('New-Editor@Example.org', 'New Editor', 'editor', 'client-chosen');
select pg_temp.expect_error($q$select token from public.administrator_invitations limit 1$q$, 'invitation tokens are not readable via API');
select pg_temp.expect_error($q$insert into public.administrator_invitations (email, intended_role, token) values ('new-editor@example.org', 'viewer', '')$q$, 'duplicate pending invitation is rejected');
select pg_temp.expect_error($q$insert into public.administrator_invitations (email, intended_role, token) values ('demo-editor@example.com', 'viewer', '')$q$, 'inviting an existing user is rejected');
update public.profiles set status = 'suspended' where id = (select viewer_id from _ids);
select pg_temp.check((select status from public.profiles where id = (select viewer_id from _ids)) = 'suspended', 'admin can suspend a viewer');
select pg_temp.check(exists (select 1 from public.audit_logs where action = 'user.suspended'), 'suspension is audited');
reset role;

-- ── Suspended users lose everything ──────────────────────────────────
select pg_temp.act_as((select viewer_id from _ids));
select pg_temp.check(not exists (select 1 from public.events where status <> 'published'), 'suspended viewer sees only public data');
reset role;

-- ── Super admin ──────────────────────────────────────────────────────
select pg_temp.act_as((select super_id from _ids));
select pg_temp.expect_error($q$update public.profiles set role = 'admin' where id = (select super_id from _ids)$q$, 'super admin cannot change own role');
update public.profiles set role = 'admin' where id = (select editor_id from _ids);
select pg_temp.check((select role from public.profiles where id = (select editor_id from _ids)) = 'admin', 'super admin can promote');
select pg_temp.check(exists (select 1 from public.audit_logs where action = 'user.role_changed'), 'role change is audited');
select pg_temp.check(exists (select 1 from public.audit_logs where action = 'user.login' and user_id = (select editor_id from _ids)), 'login is audited');
reset role;

-- Server-side values the client tried to choose.
select pg_temp.check((select token <> 'client-chosen' and length(token) = 64 and invited_by = (select admin_id from _ids)
  from public.administrator_invitations where email = 'new-editor@example.org'), 'invitation token and inviter are server-generated');

-- Last super admin protection holds even without a user context (SQL editor / service role).
select set_config('request.jwt.claims', '', true);
select pg_temp.expect_error($q$delete from public.profiles where id = (select super_id from _ids)$q$, 'last active super admin cannot be removed, even by service role');

select 'ALL SECURITY CHECKS PASSED' as result;
rollback;
