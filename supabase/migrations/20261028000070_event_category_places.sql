-- Changing an event's category also changes its places that had the old category, so every
-- icon of the event shows the new kind. (A place with a different kind of its own keeps it.)
create or replace function public.set_event_category(p_id uuid, p_slug text)
returns void language plpgsql security definer set search_path to '' as $function$
declare v_cat uuid; v_owner uuid; v_old text;
begin
  select e.created_by, c.slug into v_owner, v_old from public.events e left join public.event_categories c on c.id = e.category_id
   where e.id = p_id and e.deleted_at is null;
  if not found then raise exception 'Event not found.' using errcode = 'P0002'; end if;
  if auth.uid() is null or not (public.has_permission('event.edit.any')
       or (public.has_permission('event.edit.own') and v_owner = auth.uid())) then
    raise exception 'You do not have permission to edit this event.' using errcode = '42501';
  end if;
  select id into v_cat from public.event_categories where slug = p_slug and is_active;
  if v_cat is null then raise exception 'Unknown category.' using errcode = '22023'; end if;
  update public.events
     set category_id = v_cat,
         locations = case when jsonb_typeof(locations) = 'array' then (
           select coalesce(jsonb_agg(case when l->>'category_slug' = v_old then l || jsonb_build_object('category_slug', p_slug) else l end order by o), '[]'::jsonb)
             from jsonb_array_elements(locations) with ordinality as t(l, o)) else locations end
   where id = p_id;
end;
$function$;
