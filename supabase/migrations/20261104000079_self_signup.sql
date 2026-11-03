-- Stage A / Task 4 — self sign-up. A new auth user without a pending invitation gets a free
-- viewer profile; it is 'pending' until the email is confirmed (handle_auth_user_updated then
-- activates it). Google sign-ins arrive confirmed, so they start 'active'. Invitation path unchanged.

create or replace function public.handle_new_auth_user()
returns trigger language plpgsql security definer set search_path to '' as $function$
declare
  v_inv public.administrator_invitations%rowtype;
begin
  select * into v_inv
  from public.administrator_invitations
  where lower(email) = lower(new.email) and status = 'pending' and expires_at > now()
  order by created_at desc
  limit 1
  for update;
  if not found then
    insert into public.profiles (id, full_name, email, role, status, plan)
    values (
      new.id,
      coalesce(nullif(new.raw_user_meta_data ->> 'full_name', ''), nullif(new.raw_user_meta_data ->> 'name', ''), ''),
      lower(new.email),
      'viewer',
      case when new.email_confirmed_at is not null then 'active'::public.user_status else 'pending'::public.user_status end,
      'free'
    )
    on conflict (id) do nothing;
    return new;
  end if;
  insert into public.profiles (id, full_name, email, role, status, invited_by)
  values (
    new.id,
    coalesce(nullif(v_inv.full_name, ''), new.raw_user_meta_data ->> 'full_name', ''),
    lower(new.email),
    v_inv.intended_role,
    case when new.email_confirmed_at is not null then 'active'::public.user_status else 'pending'::public.user_status end,
    v_inv.invited_by
  );
  update public.administrator_invitations
     set status = 'accepted', accepted_at = now()
   where id = v_inv.id;
  perform public.write_audit('user.invitation_accepted', 'user', new.id,
    jsonb_build_object('invitation_id', v_inv.id, 'role', v_inv.intended_role, 'email', lower(new.email)));
  return new;
end;
$function$;
