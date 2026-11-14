-- Osintfront · Migration 130 — statistics dashboard cleanup: builds are kept 30 days, then removed
-- by a daily job (04:23). Kept apart from migration 129 (repo rule: removals in their own file).
-- Spec: docs/superpowers/specs/2026-11-14-ask-map-dashboard-design.md

create or replace function public.ai_dashboards_cleanup()
returns integer language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  delete from public.ai_dashboards where created_at < now() - interval '30 days';
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.ai_dashboards_cleanup() from public, anon, authenticated;

select cron.unschedule('osintfront-ai-dashboards-trim') where exists (select 1 from cron.job where jobname = 'osintfront-ai-dashboards-trim');
select cron.schedule('osintfront-ai-dashboards-trim', '23 4 * * *', $c$select public.ai_dashboards_cleanup()$c$);
