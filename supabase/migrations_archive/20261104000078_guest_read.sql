-- Stage A / Task 3 — guests (anon) see the live 24 hours.
-- Events: only through published_events (the events table stays closed to anon, so internal
-- columns never leak). Plus media of those events, ships, control areas, Lebanon communities.
-- wadi_lines stays members-only.

create or replace function public.event_is_recent(p_event uuid)
returns boolean language sql stable security definer set search_path to '' as $$
  select exists (select 1 from public.events e where e.id = p_event and e.status = 'published'
                 and e.deleted_at is null and e.occurred_at > now() - interval '24 hours');
$$;
grant execute on function public.event_is_recent(uuid) to anon, authenticated;

create or replace view public.published_events as
 SELECT e.id, e.title, e.description, e.severity, e.latitude, e.longitude, e.location_name,
    e.country, e.region, e.city, e.source_name, e.source_url, e.source_type, e.occurred_at,
    e.published_at, e.updated_at, e.is_breaking, e.is_verified, e.translations, e.category_id,
    c.slug AS category_slug, c.name AS category_name, c.icon AS category_icon, c.color AS category_color,
    c.marker_color AS category_marker_color, e.location_precision, e.sources, e.locations,
    e.location_name_he, e.location_name_en, public.event_media_kinds(e.id) AS media_kinds,
    COALESCE((e.ai_suggestions ->> 'split_from'::text),
        CASE WHEN (jsonb_typeof((e.ai_suggestions -> 'split_into'::text)) = 'array'::text) THEN (e.id)::text ELSE NULL::text END) AS report_group
   FROM (public.events e
     LEFT JOIN public.event_categories c ON (((c.id = e.category_id) AND c.is_active)))
  WHERE ((e.status = 'published'::public.event_status) AND (e.deleted_at IS NULL) AND (cardinality(e.hfc_areas) = 0)
    AND (( SELECT public.is_member() AS is_member) OR e.occurred_at > now() - interval '24 hours'));
grant select on public.published_events to anon;

drop policy if exists "event_media: public reads published" on public.event_media;
create policy "event_media: public reads published" on public.event_media for select to anon, authenticated
  using (ready and public.event_is_public(event_id) and ((select public.is_member()) or public.event_is_recent(event_id)));
grant select on public.event_media to anon;

drop policy if exists "ais: anyone reads" on public.ais_vessels;
create policy "ais: anyone reads" on public.ais_vessels for select to anon using (true);
drop policy if exists "control: anyone reads" on public.control_areas;
create policy "control: anyone reads" on public.control_areas for select to anon using (true);
drop policy if exists "sects: anyone reads" on public.lebanon_sects;
create policy "sects: anyone reads" on public.lebanon_sects for select to anon using (true);
drop policy if exists "layer sync: anyone reads" on public.layer_sync;
create policy "layer sync: anyone reads" on public.layer_sync for select to anon using (true);
grant select on public.ais_vessels, public.control_areas, public.lebanon_sects, public.layer_sync to anon;

-- Helpers used by the view and policies above, evaluated as the guest (all return false/empty for anon).
grant execute on function public.is_member() to anon;
grant execute on function public.event_is_public(uuid) to anon;
grant execute on function public.event_media_kinds(uuid) to anon;
