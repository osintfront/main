-- ════════════════════════════════════════════════════════════════════
-- Osintfront · Migration 33 — tidy drafts
-- Drafts the agents created and no person touched are stale after 24 hours (the live
-- map shows 24 hours): they are soft-deleted (still under "Deleted" in the events list,
-- and restorable). Runs hourly.
-- ════════════════════════════════════════════════════════════════════
create or replace function public.cleanup_auto_drafts()
returns integer language sql security definer set search_path = '' as $$
  with gone as (
    update public.events e set deleted_at = now()
     where e.status = 'draft' and e.deleted_at is null
       and coalesce(e.ai_suggestions ->> 'source', '') <> ''
       and e.created_at < now() - interval '24 hours'
       and e.review_requested_at is null
       and not exists (select 1 from public.event_history h where h.event_id = e.id and h.changed_by is not null
                         and h.changed_by <> e.created_by)
    returning 1)
  select count(*)::integer from gone;
$$;
revoke execute on function public.cleanup_auto_drafts() from public, anon, authenticated;
select cron.unschedule(jobid) from cron.job where jobname = 'osintfront-draft-cleanup';
select cron.schedule('osintfront-draft-cleanup', '37 * * * *', $$select public.cleanup_auto_drafts()$$);
