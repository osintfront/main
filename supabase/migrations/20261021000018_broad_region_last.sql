-- "Middle East" as a region is too broad to pin: it put US / Lebanon stories in
-- the Iraqi–Saudi desert. Try every other candidate (place, city, region,
-- country) first; fall back to a broad region only when nothing else matches.
create or replace function public.resolve_event_place(p_location_name text, p_city text, p_region text, p_country text)
returns table(place_id uuid, matched_on text)
language plpgsql
stable
set search_path to ''
as $function$
declare
  v_candidates text[] := '{}';
  v_part text;
  v_hit public.place_gazetteer;
  v_broad_id uuid;
  v_broad_on text;
begin
  v_candidates := v_candidates || coalesce(p_location_name, '');
  foreach v_part in array regexp_split_to_array(coalesce(p_location_name, ''), '\s*[,،;|]\s*|\s+[-–—]\s+') loop
    v_candidates := v_candidates || v_part;
  end loop;
  v_candidates := v_candidates || coalesce(p_city, '') || coalesce(p_region, '');
  foreach v_part in array regexp_split_to_array(coalesce(p_country, ''), '\s*[/,]\s*') loop
    v_candidates := v_candidates || v_part;
  end loop;
  foreach v_part in array v_candidates loop
    continue when btrim(v_part) = '';
    v_hit := public.lookup_place(v_part);
    continue when v_hit.id is null;
    if v_hit.canonical in ('Middle East') then
      if v_broad_id is null then v_broad_id := v_hit.id; v_broad_on := v_part; end if;
      continue;
    end if;
    place_id := v_hit.id;
    matched_on := v_part;
    return next;
    return;
  end loop;
  if v_broad_id is not null then
    place_id := v_broad_id;
    matched_on := v_broad_on;
    return next;
  end if;
end;
$function$;

-- Re-pin events that landed on the broad region (the trigger re-resolves when lat/lng are cleared).
update public.events
set latitude = null, longitude = null, location_precision = null
where deleted_at is null
  and ai_suggestions -> 'location_resolution' ->> 'place' = 'Middle East';
