-- Who used which licence (super admin only).
-- The Users page shows each user's licence and how long it runs; the Licences panel
-- shows, for every key, who redeemed it and when.
create or replace function public.admin_license_redemptions()
returns table (
  key text,
  plan text,
  duration_days int,
  note text,
  revoked boolean,
  user_id uuid,
  full_name text,
  email text,
  redeemed_at timestamptz,
  user_plan text,
  user_plan_expires_at timestamptz,
  user_status text
) language plpgsql stable security definer set search_path to '' as $$
begin
  if not public.is_super_admin() then raise exception 'not allowed'; end if;
  return query
    select r.key, k.plan, k.duration_days, k.note, k.revoked,
           r.user_id, p.full_name, p.email, r.at,
           p.plan::text, p.plan_expires_at, p.status::text
      from public.license_redemptions r
      join public.license_keys k on k.key = r.key
      left join public.profiles p on p.id = r.user_id
     order by r.at desc
     limit 2000;
end $$;
revoke all on function public.admin_license_redemptions() from public, anon;
grant execute on function public.admin_license_redemptions() to authenticated;

-- 10 Nov: copying event text is open to every plan (the limit was dropped).
update public.plan_features set enabled = true, note = 'copy event text (open to all)' where feature_key = 'copy_text';

-- 10 Nov: sharing open to every plan, no daily limit (guest shares preview as a blurred card).
update public.plan_features set enabled = true, limit_value = null, note = 'sharing open to all (guest: blurred preview)' where feature_key = 'share_daily';
