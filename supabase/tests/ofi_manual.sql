-- OFI manual parameter: only the super admin may set it, within −100..100. Run inside begin; ... rollback;
do $$
declare owner uuid := (select id from public.profiles where role = 'super_admin' limit 1);
        u uuid := gen_random_uuid(); j jsonb;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', owner, 'role', 'authenticated')::text, true);
  set local role authenticated;
  j := public.ofi_admin_manual('iran-direct-confrontation', 40, 'test note', 12);
  assert (j->>'score')::numeric = 0.7, 'score ' || j::text;
  begin perform public.ofi_admin_manual('iran-direct-confrontation', 150, 'x', 12); assert false, 'accepted 150';
  exception when others then assert sqlerrm like '%between -100 and 100%', sqlerrm; end;
  reset role;
  assert (select stale_after_hours from public.insight_signals where key = 'manual_admin') = 12, 'hours not saved';
  insert into auth.users (id, email, aud, role, email_confirmed_at) values (u, 'ofi-m@e2e.test', 'authenticated', 'authenticated', now());
  update public.profiles set status = 'active' where id = u;
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin perform public.ofi_admin_manual('iran-direct-confrontation', 10, 'x', 12); assert false, 'viewer allowed';
  exception when others then assert sqlerrm = 'not allowed', sqlerrm; end;
  reset role;
  assert not has_function_privilege('anon', 'public.ofi_admin_manual(text,int,text,int)', 'execute'), 'anon can call';
end $$;
