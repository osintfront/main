-- Places the editor names in Arabic too (name_ar, as written in the report): GeoNames knows
-- many small Lebanese villages only by their Arabic name ("المنصوري", "زوطر الشرقية").
-- resolve_event_locations keeps name_ar on a place it cannot pin; events_apply_learned_place
-- tries it (and a few spelling variants) before giving the place up.

-- Spellings to try for an Arabic place name: as written; "كفرتبنيت" → "كفر تبنيت";
-- "وادي/سهل/أطراف/خراج/محيط X" → X (the area around a village is pinned at the village).
create or replace function public.arabic_place_variants(p_name text)
returns text[] language sql immutable set search_path = '' as $$
  select array_remove(array[
    nullif(btrim(p_name), ''),
    case when btrim(p_name) ~ '^(كفر|عين|بيت|دير|تل|بير|جبل)[^ ]{2,}$'
         then regexp_replace(btrim(p_name), '^(كفر|عين|بيت|دير|تل|بير|جبل)', '\1 ') end,
    case when btrim(p_name) ~ '^(وادي|سهل|أطراف|اطراف|خراج|محيط|تلة|جبل) .{2,}'
         then regexp_replace(btrim(p_name), '^(وادي|سهل|أطراف|اطراف|خراج|محيط|تلة|جبل) ', '') end
  ], null)
$$;

do $m$
declare v_def text;
begin
  -- 1. Keep name_ar on a place that waits for the GeoNames lookup.
  v_def := pg_get_functiondef('public.resolve_event_locations(jsonb,uuid)'::regprocedure);
  v_def := replace(v_def,
    $a$v_out := v_out || jsonb_build_array(jsonb_build_object('name', v_name, 'name_en', v_en, 'lat', null, 'lng', null) || v_cat);$a$,
    $b$v_out := v_out || jsonb_build_array(jsonb_build_object('name', v_name, 'name_en', v_en, 'lat', null, 'lng', null) || v_cat
        || case when coalesce(v_item ->> 'name_ar', '') <> '' then jsonb_build_object('name_ar', left(v_item ->> 'name_ar', 120)) else '{}'::jsonb end);$b$);
  if position('name_ar' in v_def) = 0 then raise exception 'resolve_event_locations: anchor not found'; end if;
  execute v_def;

  -- 2. Try the Arabic spellings when the Hebrew and English names found nothing.
  v_def := pg_get_functiondef('public.events_apply_learned_place()'::regprocedure);
  v_def := replace(v_def,
    $a$        if v_g.geonameid is not null then
          v_item := v_item || jsonb_build_object($a$,
    $b$        if v_g.geonameid is null and coalesce(v_item ->> 'name_ar', '') <> '' then
          select g.* into v_g from unnest(public.arabic_place_variants(v_item ->> 'name_ar')) as v(n)
            cross join lateral (select (public.geo_lookup(v.n, new.country)).*) g
          where g.geonameid is not null limit 1;
        end if;
        if v_g.geonameid is not null then
          v_item := (v_item - 'name_ar') || jsonb_build_object($b$);
  if position('arabic_place_variants' in v_def) = 0 then raise exception 'events_apply_learned_place: anchor not found'; end if;
  execute v_def;
end $m$;
