-- Stage A / Task 7: guests see the live red alerts (same as free).
set local role anon;
do $$ begin
  perform count(*) from public.active_hfc_alerts;
  perform count(*) from public.active_hfc_shapes();
end $$;
reset role;
