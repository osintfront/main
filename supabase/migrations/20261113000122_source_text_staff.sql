-- "Source text" showed Hebrew instead of the original (bug, Dani — noticed in English): event_source_text only
-- answered for published / archived events, so for an event staff see while it is pending review or a draft
-- it returned nothing and the page fell back to the Hebrew description. It now answers for every event the
-- caller may see under the events read policy (operational staff: anything but drafts; internal: all).
create or replace function public.event_source_text(p_id uuid)
returns text language plpgsql stable security definer set search_path = '' as $function$
begin
  if not public.my_feature('source_link') then raise exception 'not_in_plan'; end if;
  return (select left(coalesce(nullif(e.original_report_text, ''), e.description), 10000)
            from public.events e
           where e.id = p_id and e.deleted_at is null
             and (e.status in ('published', 'archived')
                  or (e.status <> 'draft' and public.has_permission('event.view.operational'))
                  or public.has_permission('event.view.internal')));
end $function$;
