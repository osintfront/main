-- Airfields and ports layer: for registered users (Free and up).
insert into public.plan_features (feature_key, plan_id, enabled, limit_value, note) values
  ('airfields_ports', 'guest', false, null, 'airfields and ports layer'),
  ('airfields_ports', 'free',  true,  null, 'airfields and ports layer'),
  ('airfields_ports', 'pro',   true,  null, 'airfields and ports layer'),
  ('airfields_ports', 'max',   true,  null, 'airfields and ports layer'),
  ('airfields_ports', 'intel', true,  null, 'airfields and ports layer')
on conflict (feature_key, plan_id) do update
  set enabled = excluded.enabled, limit_value = excluded.limit_value, note = excluded.note;
