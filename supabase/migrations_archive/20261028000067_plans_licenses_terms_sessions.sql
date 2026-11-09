-- Plans (Free / Pro / Max), eval license keys, terms acceptance, single active session.
-- Nothing is enforced yet: app_settings.enforce_plans = false → everyone keeps full access.

create or replace function public.is_super_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'super_admin' and p.status = 'active');
$$;
revoke all on function public.is_super_admin() from public, anon;
grant execute on function public.is_super_admin() to authenticated;

-- ── Plans and their features (limits are data, not code) ─────────────────────────
create table if not exists public.plans (
  id text primary key check (id in ('free', 'pro', 'max')),
  name text not null,
  sort int not null,
  monthly_price numeric,
  yearly_price numeric
);
insert into public.plans (id, name, sort) values ('free', 'Free', 1), ('pro', 'Pro', 2), ('max', 'Max', 3)
  on conflict (id) do nothing;

create table if not exists public.plan_features (
  feature_key text not null,
  plan_id text not null references public.plans(id) on delete cascade,
  enabled boolean not null default true,
  limit_value int,          -- e.g. AI uses per day, archive days, lowest push severity rank (null = unlimited)
  note text,
  primary key (feature_key, plan_id)
);
insert into public.plan_features (feature_key, plan_id, enabled, limit_value, note) values
  ('live_map','free',true,null,null), ('live_map','pro',true,null,null), ('live_map','max',true,null,null),
  ('feed','free',true,null,null), ('feed','pro',true,null,null), ('feed','max',true,null,null),
  ('hfc_alerts','free',true,null,null), ('hfc_alerts','pro',true,null,null), ('hfc_alerts','max',true,null,null),
  ('translation_he','free',true,null,null), ('translation_he','pro',true,null,null), ('translation_he','max',true,null,null),
  ('push','free',true,3,'lowest severity rank: 3 = high'), ('push','pro',true,1,'all levels'), ('push','max',true,1,'all levels'),
  ('archive_days','free',true,1,'days back'), ('archive_days','pro',true,30,'days back'), ('archive_days','max',true,null,'full archive'),
  ('ships_aircraft','free',false,null,null), ('ships_aircraft','pro',true,null,null), ('ships_aircraft','max',true,null,null),
  ('satellite','free',false,null,null), ('satellite','pro',true,null,null), ('satellite','max',true,null,null),
  ('ai_expand_ask','free',false,0,'per day'), ('ai_expand_ask','pro',true,20,'per day'), ('ai_expand_ask','max',true,100,'per day'),
  ('insights','free',false,null,null), ('insights','pro',false,null,null), ('insights','max',true,null,null),
  ('data_export','free',false,null,null), ('data_export','pro',false,null,null), ('data_export','max',true,null,null)
on conflict do nothing;

alter table public.plans enable row level security;
alter table public.plan_features enable row level security;
create policy "plans: members read" on public.plans for select to authenticated using (true);
create policy "plans: super admin writes" on public.plans for all to authenticated using (public.is_super_admin()) with check (public.is_super_admin());
create policy "plan features: members read" on public.plan_features for select to authenticated using (true);
create policy "plan features: super admin writes" on public.plan_features for all to authenticated using (public.is_super_admin()) with check (public.is_super_admin());

insert into public.app_settings (key, value) values ('enforce_plans', 'false'::jsonb) on conflict (key) do nothing;

-- ── The user's plan ──────────────────────────────────────────────────────────────
alter table public.profiles
  add column if not exists plan text not null default 'free' check (plan in ('free', 'pro', 'max')),
  add column if not exists plan_source text not null default 'default' check (plan_source in ('default', 'eval', 'paid')),
  add column if not exists plan_expires_at timestamptz,
  add column if not exists billing_period text check (billing_period in ('monthly', 'yearly')),
  add column if not exists must_change_password boolean not null default false;

-- Only the plan functions below (or a super admin) may change plan columns.
create or replace function public.profiles_plan_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (new.plan, new.plan_source, new.plan_expires_at, new.billing_period) is distinct from
     (old.plan, old.plan_source, old.plan_expires_at, old.billing_period)
     and coalesce(current_setting('osf.plan_ok', true), '') <> '1'
     and coalesce(auth.role(), '') <> 'service_role'
     and auth.uid() is not null
     and not public.is_super_admin() then
    raise exception 'not allowed';
  end if;
  return new;
end $$;
drop trigger if exists profiles_plan_guard on public.profiles;
create trigger profiles_plan_guard before update on public.profiles for each row execute function public.profiles_plan_guard();

-- ── Audit ────────────────────────────────────────────────────────────────────────
create table if not exists public.plan_audit (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  actor uuid,
  target_user uuid,
  action text not null,
  details jsonb not null default '{}'
);
alter table public.plan_audit enable row level security;
create policy "plan audit: super admin reads" on public.plan_audit for select to authenticated using (public.is_super_admin());
create index if not exists plan_audit_at on public.plan_audit (at desc);

create or replace function public._plan_set(p_user uuid, p_plan text, p_source text, p_expires timestamptz, p_action text, p_details jsonb)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform set_config('osf.plan_ok', '1', true);
  update public.profiles set plan = p_plan, plan_source = p_source, plan_expires_at = p_expires where id = p_user;
  perform set_config('osf.plan_ok', '', true);
  insert into public.plan_audit (actor, target_user, action, details)
  values (auth.uid(), p_user, p_action, coalesce(p_details, '{}') || jsonb_build_object('plan', p_plan, 'source', p_source, 'expires', p_expires));
end $$;
revoke all on function public._plan_set(uuid, text, text, timestamptz, text, jsonb) from public, anon, authenticated;

-- Super admin: change plan / extend eval / back to Free (one click each).
create or replace function public.admin_set_plan(p_user uuid, p_plan text, p_source text default 'paid', p_expires timestamptz default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_super_admin() then raise exception 'not allowed'; end if;
  if p_plan not in ('free', 'pro', 'max') or p_source not in ('default', 'eval', 'paid') then raise exception 'bad plan'; end if;
  perform public._plan_set(p_user, p_plan, case when p_plan = 'free' then 'default' else p_source end,
    case when p_plan = 'free' then null else p_expires end, 'admin_set_plan', '{}');
end $$;

create or replace function public.admin_extend_eval(p_user uuid, p_days int)
returns void language plpgsql security definer set search_path = '' as $$
declare p record;
begin
  if not public.is_super_admin() then raise exception 'not allowed'; end if;
  if p_days not between 1 and 365 then raise exception 'bad days'; end if;
  select plan, plan_expires_at into p from public.profiles where id = p_user;
  if p.plan = 'free' then raise exception 'no plan to extend'; end if;
  perform public._plan_set(p_user, p.plan, 'eval', greatest(coalesce(p.plan_expires_at, now()), now()) + make_interval(days => p_days),
    'admin_extend_eval', jsonb_build_object('days', p_days));
end $$;

create or replace function public.admin_remove_plan(p_user uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_super_admin() then raise exception 'not allowed'; end if;
  perform public._plan_set(p_user, 'free', 'default', null, 'admin_remove_plan', '{}');
end $$;

-- Auto-expiry (hourly): a plan whose time is up goes back to Free.
create or replace function public.expire_plans() returns int
language plpgsql security definer set search_path = '' as $$
declare r record; n int := 0;
begin
  for r in select id, plan from public.profiles where plan <> 'free' and plan_expires_at is not null and plan_expires_at < now() loop
    perform public._plan_set(r.id, 'free', 'default', null, 'expired', jsonb_build_object('was', r.plan));
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.expire_plans() from public, anon, authenticated;

-- ── Eval license keys ────────────────────────────────────────────────────────────
create table if not exists public.license_keys (
  key text primary key,
  plan text not null check (plan in ('pro', 'max')),
  duration_days int not null check (duration_days in (7, 14, 30)),
  max_uses int not null default 1 check (max_uses between 1 and 1000),
  uses int not null default 0,
  note text,
  created_by uuid,
  created_at timestamptz not null default now(),
  redeem_by timestamptz not null default now() + interval '30 days',
  revoked boolean not null default false,
  revoked_at timestamptz,
  revoked_by uuid
);
alter table public.license_keys enable row level security;
create policy "license keys: super admin reads" on public.license_keys for select to authenticated using (public.is_super_admin());

create table if not exists public.license_redemptions (
  id bigint generated always as identity primary key,
  key text not null references public.license_keys(key),
  user_id uuid not null,
  at timestamptz not null default now()
);
alter table public.license_redemptions enable row level security;
create policy "license redemptions: super admin reads" on public.license_redemptions for select to authenticated using (public.is_super_admin());

create table if not exists public.license_attempts (
  user_id uuid not null,
  at timestamptz not null default now(),
  ok boolean not null
);
create index if not exists license_attempts_user on public.license_attempts (user_id, at desc);
alter table public.license_attempts enable row level security; -- server only

create or replace function public.admin_create_license(p_plan text, p_days int, p_note text default null, p_max_uses int default 1)
returns text language plpgsql security definer set search_path = '' as $$
declare
  abc constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; -- no 0/O/1/I
  b bytea; part text := ''; k text; i int;
begin
  if not public.is_super_admin() then raise exception 'not allowed'; end if;
  if p_plan not in ('pro', 'max') or p_days not in (7, 14, 30) then raise exception 'bad plan or days'; end if;
  loop
    b := extensions.gen_random_bytes(8); -- cryptographically secure
    part := '';
    for i in 0..7 loop part := part || substr(abc, (get_byte(b, i) % 32) + 1, 1); end loop;
    k := format('OSF-%s-%s-%s-%s', upper(p_plan), p_days, substr(part, 1, 4), substr(part, 5, 4));
    exit when not exists (select 1 from public.license_keys where key = k);
  end loop;
  insert into public.license_keys (key, plan, duration_days, max_uses, note, created_by)
  values (k, p_plan, p_days, greatest(1, least(coalesce(p_max_uses, 1), 1000)), nullif(left(trim(p_note), 200), ''), auth.uid());
  insert into public.plan_audit (actor, action, details) values (auth.uid(), 'license_created', jsonb_build_object('key', k, 'plan', p_plan, 'days', p_days, 'note', p_note, 'max_uses', p_max_uses));
  return k;
end $$;

create or replace function public.admin_revoke_license(p_key text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_super_admin() then raise exception 'not allowed'; end if;
  update public.license_keys set revoked = true, revoked_at = now(), revoked_by = auth.uid() where key = p_key and not revoked;
  insert into public.plan_audit (actor, action, details) values (auth.uid(), 'license_revoked', jsonb_build_object('key', p_key));
end $$;

-- A member redeems a key: checked only against the database (plan and days come from the row).
create or replace function public.redeem_license(p_key text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare k record; me record; v text := upper(trim(p_key)); until_at timestamptz;
begin
  if auth.uid() is null or not public.is_member() then raise exception 'not allowed'; end if;
  if (select count(*) from public.license_attempts where user_id = auth.uid() and at > now() - interval '15 minutes' and not ok) >= 5 then
    return jsonb_build_object('ok', false, 'error', 'rate_limited');
  end if;
  select * into k from public.license_keys where key = v for update;
  if k is null or k.revoked or k.uses >= k.max_uses or k.redeem_by < now()
     or exists (select 1 from public.license_redemptions r where r.key = v and r.user_id = auth.uid()) then
    insert into public.license_attempts (user_id, ok) values (auth.uid(), false);
    return jsonb_build_object('ok', false, 'error', 'invalid');
  end if;
  select plan, plan_expires_at into me from public.profiles where id = auth.uid();
  until_at := (case when me.plan = k.plan then greatest(coalesce(me.plan_expires_at, now()), now()) else now() end) + make_interval(days => k.duration_days);
  update public.license_keys set uses = uses + 1 where key = v;
  insert into public.license_redemptions (key, user_id) values (v, auth.uid());
  insert into public.license_attempts (user_id, ok) values (auth.uid(), true);
  perform public._plan_set(auth.uid(), k.plan, 'eval', until_at, 'license_redeemed', jsonb_build_object('key', v));
  return jsonb_build_object('ok', true, 'plan', k.plan, 'expires_at', until_at);
end $$;

revoke all on function public.admin_set_plan(uuid, text, text, timestamptz), public.admin_extend_eval(uuid, int), public.admin_remove_plan(uuid),
  public.admin_create_license(text, int, text, int), public.admin_revoke_license(text), public.redeem_license(text) from public, anon;
grant execute on function public.admin_set_plan(uuid, text, text, timestamptz), public.admin_extend_eval(uuid, int), public.admin_remove_plan(uuid),
  public.admin_create_license(text, int, text, int), public.admin_revoke_license(text), public.redeem_license(text) to authenticated;

-- ── Terms acceptance (screen disabled until require_terms = true) ────────────────
create table if not exists public.terms_acceptances (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  terms_version text not null,
  privacy_version text not null,
  accepted_at timestamptz not null default now(),
  ip inet
);
alter table public.terms_acceptances enable row level security;
create policy "terms: own rows read" on public.terms_acceptances for select to authenticated using (user_id = (select auth.uid()) or public.is_super_admin());
insert into public.app_settings (key, value) values
  ('terms_version', '"0"'::jsonb), ('privacy_version', '"0"'::jsonb), ('require_terms', 'false'::jsonb)
on conflict (key) do nothing;

create or replace function public.accept_terms(p_terms text, p_privacy text)
returns void language plpgsql security definer set search_path = '' as $$
declare ip text;
begin
  if auth.uid() is null then raise exception 'not allowed'; end if;
  ip := split_part(coalesce(current_setting('request.headers', true)::json ->> 'x-forwarded-for', ''), ',', 1);
  insert into public.terms_acceptances (user_id, terms_version, privacy_version, ip)
  values (auth.uid(), left(p_terms, 40), left(p_privacy, 40), nullif(trim(ip), '')::inet);
end $$;
revoke all on function public.accept_terms(text, text) from public, anon;
grant execute on function public.accept_terms(text, text) to authenticated;

-- ── Sessions: one active session per user (super admin exempt) ──────────────────
create table if not exists public.user_sessions (
  session_id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  device_type text,
  browser text,
  created_at timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  ended_at timestamptz,
  ended_reason text
);
create index if not exists user_sessions_user on public.user_sessions (user_id, last_seen desc);
alter table public.user_sessions enable row level security;
create policy "sessions: own or admin read" on public.user_sessions for select to authenticated
  using (user_id = (select auth.uid()) or (select public.has_permission('user.manage')));

-- Called right after sign-in (and now and then): records this session; for everyone except a
-- super admin, ends every other session of the user (their refresh tokens are deleted).
create or replace function public.register_session(p_device text, p_browser text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare sid uuid := nullif(auth.jwt() ->> 'session_id', '')::uuid; ended int := 0;
begin
  if auth.uid() is null or sid is null then raise exception 'not allowed'; end if;
  insert into public.user_sessions (session_id, user_id, device_type, browser)
  values (sid, auth.uid(), left(p_device, 40), left(p_browser, 60))
  on conflict (session_id) do update set last_seen = now(), device_type = excluded.device_type, browser = excluded.browser;
  if not public.is_super_admin() then
    update public.user_sessions set ended_at = now(), ended_reason = 'signed_in_elsewhere'
      where user_id = auth.uid() and session_id <> sid and ended_at is null;
    delete from auth.sessions where user_id = auth.uid() and id <> sid;
    get diagnostics ended = row_count;
  end if;
  return jsonb_build_object('ok', true, 'ended', ended);
end $$;

-- Is this session still the active one? (false → the device shows "signed in elsewhere")
create or replace function public.session_active()
returns boolean language plpgsql security definer set search_path = '' as $$
declare sid uuid := nullif(auth.jwt() ->> 'session_id', '')::uuid;
begin
  if auth.uid() is null or sid is null then return true; end if;
  update public.user_sessions set last_seen = now() where session_id = sid and ended_at is null;
  return not exists (select 1 from public.user_sessions where session_id = sid and ended_at is not null)
     and exists (select 1 from auth.sessions where id = sid);
end $$;
revoke all on function public.register_session(text, text), public.session_active() from public, anon;
grant execute on function public.register_session(text, text), public.session_active() to authenticated;

-- First sign-in with a temporary password: the user clears the flag after choosing a new one.
create or replace function public.password_changed() returns void language sql security definer set search_path = '' as $$
  update public.profiles set must_change_password = false where id = auth.uid();
$$;
revoke all on function public.password_changed() from public, anon;
grant execute on function public.password_changed() to authenticated;
-- Hourly: plans whose time is up go back to Free.
-- select cron.schedule('osintfront-expire-plans', '11 * * * *', 'select public.expire_plans()');
-- Members read the plan / terms switches (they decide what the site asks of them).
create policy "settings: members read plan and terms switches" on public.app_settings for select to authenticated
  using (key in ('enforce_plans', 'require_terms', 'terms_version', 'privacy_version') and (select public.is_member()));
-- Delete a license row (revokes it first; the audit log keeps the record).
create or replace function public.admin_delete_license(p_key text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_super_admin() then raise exception 'not allowed'; end if;
  update public.license_keys set revoked = true, revoked_at = now(), revoked_by = auth.uid() where key = p_key;
  delete from public.license_redemptions where key = p_key;
  delete from public.license_keys where key = p_key;
  insert into public.plan_audit (actor, action, details) values (auth.uid(), 'license_deleted', jsonb_build_object('key', p_key));
end $$;
revoke all on function public.admin_delete_license(text) from public, anon;
grant execute on function public.admin_delete_license(text) to authenticated;
-- Staff (super admin, admin) are on Max.
update public.profiles set plan = 'max', plan_source = 'default', plan_expires_at = null where role in ('super_admin', 'admin');
