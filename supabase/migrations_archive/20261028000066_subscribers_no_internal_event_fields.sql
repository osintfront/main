-- Realtime: only the pulse tables (full event rows no longer go over the WebSocket).
alter publication supabase_realtime drop table if exists public.events;
-- Subscribers (role "viewer") read events only through the public views (published_events,
-- archived_events: public columns only). The events table itself — AI notes, raw source text,
-- internal metadata — is for staff only. The site shows exactly the same as before.
create or replace function public.event_is_public(p_event uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.events e where e.id = p_event and e.status = 'published' and e.deleted_at is null);
$$;
revoke all on function public.event_is_public(uuid) from public, anon;
grant execute on function public.event_is_public(uuid) to authenticated;
alter policy "event_media: public reads published" on public.event_media
  using (ready and (select public.is_member()) and public.event_is_public(event_id));
alter policy "events: staff read" on public.events using (
  (select public.has_permission('event.view.internal'))
  or (deleted_at is null and created_by = (select auth.uid()) and (select public.has_permission('event.edit.own')))
  or (deleted_at is null and status <> 'draft' and (select public.has_permission('event.view.operational')))
);
alter policy "events: public archive" on public.events using (
  status = 'archived' and expired_at is not null and deleted_at is null and (select public.has_permission('event.view.operational'))
);
alter policy "events: public reads published" on public.events using (false);
