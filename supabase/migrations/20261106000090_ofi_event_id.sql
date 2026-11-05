-- The id of a published insight, for its readers' own alert rows (Pro and above; nothing else exposed).
create or replace function public.ofi_event_id(p_slug text) returns uuid
language sql stable security definer set search_path = '' as $$
  select e.id from public.insight_events e
  where e.slug = p_slug and e.is_published and e.status <> 'draft' and public.ofi_tier() >= 2;
$$;
revoke all on function public.ofi_event_id(text) from public, anon;
grant execute on function public.ofi_event_id(text) to authenticated;
