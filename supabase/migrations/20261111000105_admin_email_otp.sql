-- Email-OTP second step for chosen accounts (starting with the founder's).
-- Flow: password sign-in -> otp_begin() (remembers that session) -> Supabase emails a 6-digit code ->
-- verifyOtp gives a NEW session -> otp_confirm(old session id) marks the new session as verified.
-- Both factors are required: a code alone (no password session) or a password alone is not enough.
create table if not exists public.two_factor_users (email text primary key);
insert into public.two_factor_users (email) values ('osintfront@gmail.com') on conflict do nothing;

create table if not exists public.otp_pending (session_id uuid primary key, user_id uuid not null, created_at timestamptz not null default now());
create table if not exists public.otp_verified (session_id uuid primary key, user_id uuid not null, verified_at timestamptz not null default now());
alter table public.two_factor_users enable row level security;
alter table public.otp_pending enable row level security;
alter table public.otp_verified enable row level security;
revoke all on public.two_factor_users, public.otp_pending, public.otp_verified from anon, authenticated;

create or replace function public._jwt_sid() returns uuid language sql stable set search_path = '' as
$$ select nullif(auth.jwt() ->> 'session_id', '')::uuid $$;

-- Did this session come from an emailed code?
create or replace function public._jwt_via_otp() returns boolean language sql stable set search_path = '' as
$$ select exists (select 1 from jsonb_array_elements(coalesce(auth.jwt() -> 'amr', '[]'::jsonb)) a where a ->> 'method' in ('otp', 'magiclink')) $$;

create or replace function public.otp_required() returns boolean language sql stable security definer set search_path = '' as
$$ select exists (select 1 from public.two_factor_users t join auth.users u on lower(u.email) = lower(t.email) where u.id = auth.uid()) $$;

create or replace function public.otp_ok() returns boolean language sql stable security definer set search_path = '' as
$$ select not public.otp_required()
       or exists (select 1 from public.otp_verified v where v.session_id = public._jwt_sid() and v.user_id = auth.uid()) $$;

create or replace function public.otp_status() returns jsonb language sql stable security definer set search_path = '' as
$$ select jsonb_build_object('required', public.otp_required(), 'verified', public.otp_ok()) $$;

-- Step 1 (password session): remember it so the code step can be tied to it.
create or replace function public.otp_begin() returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or not public.otp_required() then raise exception 'not_required'; end if;
  if public._jwt_via_otp() then raise exception 'password_first'; end if;
  insert into public.otp_pending (session_id, user_id) values (public._jwt_sid(), auth.uid())
    on conflict (session_id) do update set created_at = now();
  delete from public.otp_pending where created_at < now() - interval '1 day';
end $$;

-- Step 2 (session created by the verified code): needs the password session from step 1.
create or replace function public.otp_confirm(p_prev uuid) returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or not public._jwt_via_otp() then raise exception 'not_allowed'; end if;
  delete from public.otp_pending where session_id = p_prev and user_id = auth.uid() and created_at > now() - interval '15 minutes';
  if not found then raise exception 'not_allowed'; end if;
  insert into public.otp_verified (session_id, user_id) values (public._jwt_sid(), auth.uid()) on conflict do nothing;
  delete from public.otp_verified where verified_at < now() - interval '60 days';
end $$;

revoke all on function public.otp_required(), public.otp_ok(), public.otp_status(), public.otp_begin(), public.otp_confirm(uuid) from public, anon;
grant execute on function public.otp_required(), public.otp_ok(), public.otp_status(), public.otp_begin(), public.otp_confirm(uuid) to authenticated;
revoke all on function public._jwt_sid(), public._jwt_via_otp() from public, anon;
grant execute on function public._jwt_sid(), public._jwt_via_otp() to authenticated;

-- Server-side enforcement of the back office, behind a switch (off until the emailed code is confirmed to arrive).
insert into public.app_settings (key, value) values ('enforce_admin_otp', 'false'::jsonb) on conflict (key) do nothing;

create or replace function public.has_permission(p_permission text) returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles pr
    where pr.id = auth.uid() and pr.status = 'active'
      and (
        p_permission = any (public.role_permissions(pr.role))
        or (p_permission = 'event.publish' and pr.can_publish and pr.role = 'analyst')
      )
  ) and (public.otp_ok() or not coalesce((select s.value = 'true'::jsonb from public.app_settings s where s.key = 'enforce_admin_otp'), false));
$$;

create or replace function public.is_super_admin() returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'super_admin' and p.status = 'active')
     and (public.otp_ok() or not coalesce((select s.value = 'true'::jsonb from public.app_settings s where s.key = 'enforce_admin_otp'), false));
$$;
