-- Airfields and ports: plan feature. Run inside begin; ... rollback;
do $$
begin
  assert (select not enabled from public.plan_features where feature_key='airfields_ports' and plan_id='guest'), 'guest airfields_ports must be off';
  assert (select count(*) from public.plan_features where feature_key='airfields_ports' and plan_id in ('free','pro','max','intel') and enabled and limit_value is null) = 4, 'airfields_ports on for free/pro/max/intel';
end $$;
