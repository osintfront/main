-- Filter sets (12 Nov 2026): several named filters on the map, each a full filter of its own.
--  · plan_features: new key filter_sets — how many sets a plan may have in force.
--    Guests none (sign-up window), Free 1, Pro / Max / Intel 6. Sets live in the browser only;
--    the limit is applied there. While enforce_plans is false everything is allowed.

insert into public.plan_features (feature_key, plan_id, enabled, limit_value, note) values
  ('filter_sets', 'guest', false, 0, 'filter sets on the map'),
  ('filter_sets', 'free',  true,  1, 'filter sets on the map'),
  ('filter_sets', 'pro',   true,  6, 'filter sets on the map'),
  ('filter_sets', 'max',   true,  6, 'filter sets on the map'),
  ('filter_sets', 'intel', true,  6, 'filter sets on the map')
on conflict (feature_key, plan_id) do update
  set enabled = excluded.enabled, limit_value = excluded.limit_value, note = excluded.note;
