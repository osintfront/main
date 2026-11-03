-- Stage C — ad switches readable by everyone: ads_enabled (off until AdSense approves the site)
-- and ads_feed_every (one ad after every N feed events).
insert into public.app_settings (key, value) values ('ads_enabled', 'false'::jsonb), ('ads_feed_every', '3'::jsonb)
on conflict (key) do nothing;
drop policy if exists "settings: anyone reads plan and terms switches" on public.app_settings;
create policy "settings: anyone reads plan and terms switches" on public.app_settings for select to anon
  using (key = any (array['enforce_plans', 'require_terms', 'terms_version', 'privacy_version', 'ads_enabled', 'ads_feed_every']));
drop policy if exists "settings: members read ad switches" on public.app_settings;
create policy "settings: members read ad switches" on public.app_settings for select to authenticated
  using (key = any (array['ads_enabled', 'ads_feed_every']));
