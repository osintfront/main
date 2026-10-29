-- Social search cost control. ONE config place: app_settings.social_config
--   x_enabled              false → no code calls the X API, even if X_BEARER_TOKEN exists
--   apify_daily_budget_usd 1     → when today's Apify spend reaches it, provider searches stop (logged in runs as "daily_budget")
--   cache_minutes          60    → the same places + words are not searched again within this time
--   schedule               off   → {enabled, per_day (max 6), areas:[{name, polygon:[[lat,lng],…], hours, terms}]}
insert into public.app_settings (key, value) values ('social_config', '{
  "x_enabled": false,
  "apify_daily_budget_usd": 1,
  "cache_minutes": 60,
  "schedule": {"enabled": false, "per_day": 3, "areas": []}
}'::jsonb) on conflict (key) do nothing;

alter table public.social_searches add column if not exists cache_key text;
alter table public.social_searches add column if not exists scheduled_area text;
create index if not exists social_searches_cache on public.social_searches (cache_key, created_at desc);
create index if not exists social_searches_area on public.social_searches (scheduled_area, created_at desc) where scheduled_area is not null;

-- Hourly tick. Costs nothing while schedule.enabled is false (the function returns at once).
select cron.schedule('osintfront-social-schedule', '23 * * * *', $$
select net.http_post(
  url := 'https://kbfggmvrfevstzneqfzf.supabase.co/functions/v1/social-search',
  headers := jsonb_build_object('Content-Type','application/json','x-cron-secret',(select value from public.intel_config where key='cron_secret')),
  body := '{"action":"scheduled"}'::jsonb,
  timeout_milliseconds := 60000)
$$);
