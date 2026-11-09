-- Stage A / Task 1 — guest plan, daily limits for free, ships/aircraft for all,
-- invited viewers move to Pro (no expiry; admins can change it later), guests can read plan config.

-- 'guest' is a plan row only (limits for signed-out visitors), never a profile's plan.
alter table public.plans drop constraint if exists plans_id_check;
alter table public.plans add constraint plans_id_check check (id = any (array['guest', 'free', 'pro', 'max', 'intel']));

insert into public.plans (id, name, sort) values ('guest', 'Guest', 0)
  on conflict (id) do update set name = excluded.name, sort = excluded.sort;

-- Every feature known for free also exists for guest (copied, then adjusted below).
insert into public.plan_features (feature_key, plan_id, enabled, limit_value, note)
select feature_key, 'guest', enabled, limit_value, note from public.plan_features where plan_id = 'free'
on conflict (feature_key, plan_id) do nothing;

-- Daily uses: limit_value = uses per day (Asia/Jerusalem), null = unlimited.
insert into public.plan_features (feature_key, plan_id, enabled, limit_value, note) values
  ('expand_daily', 'guest', false, 0,    'expand uses per day'),
  ('expand_daily', 'free',  true,  3,    'expand uses per day'),
  ('expand_daily', 'pro',   true,  null, 'expand uses per day'),
  ('expand_daily', 'max',   true,  null, 'expand uses per day'),
  ('expand_daily', 'intel', true,  null, 'expand uses per day'),
  ('satellite',    'guest', false, 0,    'satellite turn-ons per day'),
  ('satellite',    'free',  true,  3,    'satellite turn-ons per day'),
  ('satellite',    'pro',   true,  null, 'satellite turn-ons per day'),
  ('satellite',    'max',   true,  null, 'satellite turn-ons per day'),
  ('satellite',    'intel', true,  null, 'satellite turn-ons per day'),
  ('archive_days', 'guest', true,  0,    'days back (live 24 h only)'),
  ('push',         'guest', false, null, 'sign up for push')
on conflict (feature_key, plan_id) do update
  set enabled = excluded.enabled, limit_value = excluded.limit_value, note = excluded.note;

update public.plan_features set enabled = true where feature_key = 'ships_aircraft';
update public.plan_features set enabled = false where plan_id = 'guest' and feature_key in ('ai_expand_ask', 'insights', 'data_export');

-- The invited viewers keep full access: Pro with no expiry.
update public.profiles set plan = 'pro', plan_expires_at = null where role = 'viewer' and plan = 'free';

-- Guests read the plan configuration (no secrets in these tables / keys).
drop policy if exists "plans: anyone reads" on public.plans;
create policy "plans: anyone reads" on public.plans for select to anon using (true);
drop policy if exists "plan features: anyone reads" on public.plan_features;
create policy "plan features: anyone reads" on public.plan_features for select to anon using (true);
drop policy if exists "settings: anyone reads plan and terms switches" on public.app_settings;
create policy "settings: anyone reads plan and terms switches" on public.app_settings for select to anon
  using (key = any (array['enforce_plans', 'require_terms', 'terms_version', 'privacy_version']));
grant select on public.plans, public.plan_features, public.app_settings to anon;
