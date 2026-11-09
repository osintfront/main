-- ════════════════════════════════════════════════════════════════════
-- Osintfront · Migration 15 — schedule the news agents
-- Every 5 minutes pg_cron calls the intel-crawler Edge Function (pg_net,
-- fire-and-forget); the function picks the country agent that is due
-- (07:00–23:00 Israel every 30 min, night every 60 min).
-- Turning app_settings.intel_crawler.enabled off stops the calls.
-- ════════════════════════════════════════════════════════════════════

create or replace function public.intel_crawler_tick()
returns void language plpgsql security definer set search_path = '' as $$
declare v_secret text;
begin
  if not coalesce((select (value->>'enabled')::boolean from public.app_settings where key = 'intel_crawler'), false) then
    return;
  end if;
  select value into v_secret from public.intel_config where key = 'cron_secret';
  perform net.http_post(
    url := 'https://kbfggmvrfevstzneqfzf.supabase.co/functions/v1/intel-crawler',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_secret),
    body := '{}'::jsonb,
    timeout_milliseconds := 5000);
end $$;
revoke all on function public.intel_crawler_tick() from public, anon, authenticated;

select cron.schedule('osintfront-intel-crawler', '*/5 * * * *', $c$select public.intel_crawler_tick()$c$);
