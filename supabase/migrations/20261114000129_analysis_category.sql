-- Osintfront · Migration 129 — category "Analyses & summaries" (analysis).
-- Analyses / assessments of military activity (drone or aircraft routes, ISR, flight tracking,
-- intelligence assessments) and summaries of earlier incidents. Feed only (no pin, see
-- ai_suggestions.no_map). The ingest writes the whole text translated to translations.<lang>.full.
-- Who reads what: guest = headline (event_summary off, unchanged), Free = the first paragraph
-- of the analysis, Pro / Max / Intel = all of it (plan feature analysis_full). "Expand" is unchanged.

insert into public.event_categories (slug, name, description, icon, color, marker_color, sort_order, translations)
values ('analysis', 'Analyses & summaries',
        'Analyses and assessments of military activity, and summaries of earlier incidents. Feed only, no map pin.',
        'ScrollText', '#475569', '#475569', 900, '{"he":"ניתוחים וסיכומים"}')
on conflict (slug) do update set name = excluded.name, description = excluded.description, icon = excluded.icon,
  color = excluded.color, marker_color = excluded.marker_color, sort_order = excluded.sort_order,
  translations = excluded.translations, is_active = true;

insert into public.plan_features (feature_key, plan_id, enabled, limit_value, note)
select 'analysis_full', p, p in ('pro', 'max', 'intel'), null, 'Whole text of analyses & summaries (Free: first paragraph)'
from unnest(array['guest', 'free', 'pro', 'max', 'intel']) p
on conflict (feature_key, plan_id) do update set enabled = excluded.enabled, note = excluded.note;

-- Without analysis_full, every translations.<lang>.full of an analysis is cut to its first
-- paragraph (the opening lines up to the first one of 60+ characters; a date line alone is not
-- a paragraph; lines, since translations often keep one line per paragraph) and flagged full_cut, so the site shows the upgrade window. The cut happens here,
-- in the database, so the rest never reaches a Free browser.
create or replace function public.analysis_gate(p_tr jsonb, p_slug text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  k text;
  v jsonb;
  out_ jsonb := p_tr;
  cut text;
begin
  if p_slug is distinct from 'analysis' or jsonb_typeof(p_tr) is distinct from 'object' or public.my_feature('analysis_full') then
    return p_tr;
  end if;
  for k, v in select * from jsonb_each(p_tr) loop
    if jsonb_typeof(v) = 'object' and jsonb_typeof(v -> 'full') = 'string' then
      with parts as (
        select btrim(p) p, n from regexp_split_to_table(v ->> 'full', '\n') with ordinality t(p, n) where btrim(p) <> ''
      )
      select string_agg(p, E'\n' order by n) into cut from parts
      where n <= coalesce((select min(n) from parts where length(p) >= 60), (select min(n) from parts));
      out_ := jsonb_set(out_, array[k], (v - 'full') || jsonb_build_object('full', coalesce(cut, ''), 'full_cut', true));
    end if;
  end loop;
  return out_;
end $$;
grant execute on function public.analysis_gate(jsonb, text) to anon, authenticated;

create or replace view public.published_events with (security_invoker = false) as
SELECT e.id, e.title,
    CASE WHEN (SELECT public.my_feature('event_summary'::text)) THEN e.description ELSE NULL::text END AS description,
    e.severity, e.latitude, e.longitude, e.location_name, e.country, e.region, e.city,
    CASE WHEN ((SELECT public.my_plan()) = 'guest'::text) AND (SELECT public.plans_enforced()) THEN NULL::text ELSE e.source_name END AS source_name,
    CASE WHEN (SELECT public.my_feature('source_link'::text)) THEN e.source_url ELSE NULL::text END AS source_url,
    e.source_type, e.occurred_at, e.published_at, e.updated_at, e.is_breaking, e.is_verified,
    public.analysis_gate(
      CASE WHEN (SELECT public.my_feature('event_summary'::text))
        THEN e.translations #- '{he,details}' #- '{he,religious}' #- '{he,implications}' #- '{en,details}' #- '{en,religious}' #- '{en,implications}'
        ELSE COALESCE((SELECT jsonb_object_agg(k.key, jsonb_build_object('title', k.value -> 'title'))
               FROM jsonb_each(CASE WHEN jsonb_typeof(e.translations) = 'object' THEN e.translations ELSE '{}'::jsonb END) k(key, value)
              WHERE jsonb_typeof(k.value) = 'object'), '{}'::jsonb)
      END, c.slug) AS translations,
    e.category_id, c.slug AS category_slug, c.name AS category_name, c.icon AS category_icon, c.color AS category_color, c.marker_color AS category_marker_color,
    e.location_precision,
    CASE WHEN NOT (SELECT public.my_feature('sources_detail'::text)) THEN '[]'::jsonb
         WHEN (SELECT public.my_feature_limit('sources_detail'::text)) = 1 AND jsonb_typeof(e.sources) = 'array'
           THEN COALESCE((SELECT jsonb_agg(s.value - 'url') FROM jsonb_array_elements(e.sources) s(value)), '[]'::jsonb)
         ELSE e.sources END AS sources,
    e.locations, e.location_name_he, e.location_name_en, public.event_media_kinds(e.id) AS media_kinds,
    COALESCE(e.ai_suggestions ->> 'split_from', CASE WHEN jsonb_typeof(e.ai_suggestions -> 'split_into') = 'array' THEN e.id::text ELSE NULL::text END) AS report_group,
    CASE WHEN jsonb_typeof(e.sources) = 'array' THEN jsonb_array_length(e.sources) ELSE 0 END AS source_count,
    e.secondary_categories
   FROM public.events e
     LEFT JOIN public.event_categories c ON c.id = e.category_id AND c.is_active
  WHERE e.status = 'published'::public.event_status AND e.deleted_at IS NULL AND cardinality(e.hfc_areas) = 0
    AND ((SELECT public.is_member()) OR e.occurred_at > (now() - '24:00:00'::interval))
    AND COALESCE(e.published_at, e.occurred_at) <= (now() - make_interval(mins => COALESCE((SELECT public.my_feature_limit('feed_delay_min'::text)), 0)));

create or replace view public.archived_events with (security_invoker = false) as
SELECT e.id, e.title,
    CASE WHEN (SELECT public.my_feature('event_summary'::text)) THEN e.description ELSE NULL::text END AS description,
    e.severity, e.latitude, e.longitude, e.location_name, e.country, e.region, e.city, e.source_name,
    CASE WHEN (SELECT public.my_feature('source_link'::text)) THEN e.source_url ELSE NULL::text END AS source_url,
    e.source_type, e.occurred_at, e.published_at, e.updated_at, e.is_breaking, e.is_verified,
    public.analysis_gate(e.translations #- '{he,details}' #- '{he,religious}' #- '{he,implications}' #- '{en,details}' #- '{en,religious}' #- '{en,implications}', c.slug) AS translations,
    e.category_id, c.slug AS category_slug, c.name AS category_name, c.icon AS category_icon, c.color AS category_color, c.marker_color AS category_marker_color,
    e.location_precision, e.expired_at,
    CASE WHEN NOT (SELECT public.my_feature('sources_detail'::text)) THEN '[]'::jsonb
         WHEN (SELECT public.my_feature_limit('sources_detail'::text)) = 1 AND jsonb_typeof(e.sources) = 'array'
           THEN COALESCE((SELECT jsonb_agg(s.value - 'url') FROM jsonb_array_elements(e.sources) s(value)), '[]'::jsonb)
         ELSE e.sources END AS sources,
    e.locations, e.location_name_he, e.location_name_en, public.event_media_kinds(e.id) AS media_kinds,
    COALESCE(e.ai_suggestions ->> 'split_from', CASE WHEN jsonb_typeof(e.ai_suggestions -> 'split_into') = 'array' THEN e.id::text ELSE NULL::text END) AS report_group,
    CASE WHEN jsonb_typeof(e.sources) = 'array' THEN jsonb_array_length(e.sources) ELSE 0 END AS source_count,
    e.secondary_categories
   FROM public.events e
     LEFT JOIN public.event_categories c ON c.id = e.category_id AND c.is_active
  WHERE e.status = 'archived'::public.event_status AND e.expired_at IS NOT NULL AND e.deleted_at IS NULL AND (SELECT public.is_member())
    AND ((SELECT public.my_archive_days()) IS NULL OR e.occurred_at > (now() - make_interval(days => (SELECT public.my_archive_days()))));

-- The Nachshon / IntelSky analysis of 13 Nov (rodwan313/257904), published before the category existed.
update public.events e set
  category_id = (select id from public.event_categories where slug = 'analysis'),
  secondary_categories = array['military-activity'],
  ai_suggestions = e.ai_suggestions || jsonb_build_object('pre_analysis_category', 'military-activity')
where e.id = '8d4589ee-d77e-4a39-9e65-4f50d83646f7';
