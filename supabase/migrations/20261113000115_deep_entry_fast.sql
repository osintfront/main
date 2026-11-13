-- Deep analysis: an entry's own events are found from its related ids and the event_terms index first,
-- then only those events are read (it used to scan every published event). Same answer, same function.
create or replace function public.deep_entry(p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare d record; v_aliases text[]; v_events uuid[];
begin
  if not public.my_feature('deep_analysis') then return null; end if;
  select * into d from public.deep_entries where id = p_id;
  if d.id is null then return null; end if;
  select coalesce(array_agg(alias order by alias), '{}') into v_aliases from public.deep_aliases where entry_id = p_id;
  select coalesce(array_agg(x.id order by x.occurred_at desc), '{}') into v_events from (
    select ev.id, ev.occurred_at from public.events ev
    where ev.id in (
        select unnest(coalesce(d.related_event_ids, '{}'::uuid[]))
        union
        select t.event_id from public.event_terms t where t.keys && v_aliases)
      and ev.status in ('published', 'archived') and ev.deleted_at is null
    order by ev.occurred_at desc limit 12
  ) x;
  return jsonb_build_object(
    'id', d.id, 'kind', d.kind, 'name_he', d.name_he, 'name_en', d.name_en, 'name_orig', d.name_orig,
    'summary_he', d.summary_he, 'summary_en', d.summary_en, 'sections', d.sections, 'sources', d.sources,
    'image', d.image, 'version', d.version, 'created_at', d.created_at, 'updated_at', d.updated_at, 'edited_at', d.edited_at,
    'aliases', to_jsonb(v_aliases), 'events', to_jsonb(v_events));
end $$;
