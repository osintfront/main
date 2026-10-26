-- Events split from one report (one event per category) share a report_group: the id of the
-- original event. The map links them and the details window lists them. Added at the end
-- of the public views (no other column changes).
create or replace view public.published_events as
 SELECT e.id, e.title, e.description, e.severity, e.latitude, e.longitude, e.location_name, e.country, e.region, e.city,
    e.source_name, e.source_url, e.source_type, e.occurred_at, e.published_at, e.updated_at, e.is_breaking, e.is_verified,
    e.translations, e.category_id, c.slug AS category_slug, c.name AS category_name, c.icon AS category_icon,
    c.color AS category_color, c.marker_color AS category_marker_color, e.location_precision, e.sources, e.locations,
    e.location_name_he, e.location_name_en, public.event_media_kinds(e.id) AS media_kinds,
    coalesce(e.ai_suggestions ->> 'split_from', case when jsonb_typeof(e.ai_suggestions -> 'split_into') = 'array' then e.id::text end) AS report_group
   FROM public.events e
     LEFT JOIN public.event_categories c ON c.id = e.category_id AND c.is_active
  WHERE e.status = 'published'::public.event_status AND e.deleted_at IS NULL AND cardinality(e.hfc_areas) = 0
    AND (select public.is_member());

create or replace view public.archived_events as
 SELECT e.id, e.title, e.description, e.severity, e.latitude, e.longitude, e.location_name, e.country, e.region, e.city,
    e.source_name, e.source_url, e.source_type, e.occurred_at, e.published_at, e.updated_at, e.is_breaking, e.is_verified,
    e.translations, e.category_id, c.slug AS category_slug, c.name AS category_name, c.icon AS category_icon,
    c.color AS category_color, c.marker_color AS category_marker_color, e.location_precision, e.expired_at, e.sources,
    e.locations, e.location_name_he, e.location_name_en, public.event_media_kinds(e.id) AS media_kinds,
    coalesce(e.ai_suggestions ->> 'split_from', case when jsonb_typeof(e.ai_suggestions -> 'split_into') = 'array' then e.id::text end) AS report_group
   FROM public.events e
     LEFT JOIN public.event_categories c ON c.id = e.category_id AND c.is_active
  WHERE e.status = 'archived'::public.event_status AND e.expired_at IS NOT NULL AND e.deleted_at IS NULL
    AND (select public.is_member());
