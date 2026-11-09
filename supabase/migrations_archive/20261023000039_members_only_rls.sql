-- ════════════════════════════════════════════════════════════════════
-- Osintfront · Migration 39 — members only, also for self-registered accounts
-- Supabase Auth still accepts self sign-ups (Dashboard → Authentication → "Allow new users
-- to sign up"); such an account has no profile. Event data is readable only by an
-- active member (a profile created by an admin), so a self-registered account sees nothing.
-- ════════════════════════════════════════════════════════════════════
create or replace function public.is_member()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles pr where pr.id = auth.uid() and pr.status = 'active');
$$;
revoke execute on function public.is_member() from public, anon;
grant execute on function public.is_member() to authenticated;

create or replace view public.published_events as
 SELECT e.id, e.title, e.description, e.severity, e.latitude, e.longitude, e.location_name, e.country, e.region, e.city,
    e.source_name, e.source_url, e.source_type, e.occurred_at, e.published_at, e.updated_at, e.is_breaking, e.is_verified,
    e.translations, e.category_id, c.slug AS category_slug, c.name AS category_name, c.icon AS category_icon,
    c.color AS category_color, c.marker_color AS category_marker_color, e.location_precision, e.sources, e.locations,
    e.location_name_he, e.location_name_en, public.event_media_kinds(e.id) AS media_kinds
   FROM public.events e
     LEFT JOIN public.event_categories c ON c.id = e.category_id AND c.is_active
  WHERE e.status = 'published'::public.event_status AND e.deleted_at IS NULL AND cardinality(e.hfc_areas) = 0
    AND (select public.is_member());

create or replace view public.archived_events as
 SELECT e.id, e.title, e.description, e.severity, e.latitude, e.longitude, e.location_name, e.country, e.region, e.city,
    e.source_name, e.source_url, e.source_type, e.occurred_at, e.published_at, e.updated_at, e.is_breaking, e.is_verified,
    e.translations, e.category_id, c.slug AS category_slug, c.name AS category_name, c.icon AS category_icon,
    c.color AS category_color, c.marker_color AS category_marker_color, e.location_precision, e.expired_at, e.sources,
    e.locations, e.location_name_he, e.location_name_en, public.event_media_kinds(e.id) AS media_kinds
   FROM public.events e
     LEFT JOIN public.event_categories c ON c.id = e.category_id AND c.is_active
  WHERE e.status = 'archived'::public.event_status AND e.expired_at IS NOT NULL AND e.deleted_at IS NULL
    AND (select public.is_member());

alter policy "events: staff read" on public.events using (
  (((status = 'published'::public.event_status) AND (deleted_at IS NULL)) AND (select public.is_member()))
  OR (select public.has_permission('event.view.internal'))
  OR ((deleted_at IS NULL) AND (created_by = (select auth.uid())) AND (select public.has_permission('event.edit.own')))
  OR ((deleted_at IS NULL) AND (status <> 'draft'::public.event_status) AND (select public.has_permission('event.view.operational')))
);
alter policy "events: public archive" on public.events using (
  (status = 'archived'::public.event_status) AND (expired_at IS NOT NULL) AND (deleted_at IS NULL) AND (select public.is_member())
);
alter policy "event_media: public reads published" on public.event_media using (
  ready AND (select public.is_member()) AND EXISTS (
    SELECT 1 FROM public.events e WHERE e.id = event_media.event_id AND e.status = 'published'::public.event_status AND e.deleted_at IS NULL)
);
