-- ════════════════════════════════════════════════════════════════════
-- Osintfront · Migration 27 — keep the editor's English place name
-- GeoNames' "English" names for Arab villages are often French-style
-- transliterations ("Baraachît", "Zaoutar ech Charqîyé"). The place database now
-- gives coordinates and the Hebrew name; the English name comes from the editor
-- (or a name already on the event) and GeoNames only fills it when there is none.
-- ════════════════════════════════════════════════════════════════════
do $$
declare v_def text := pg_get_functiondef('public.events_apply_learned_place'::regproc);
begin
  v_def := replace(v_def,
    $a$new.location_name_en := coalesce(v_geo.name_en, v_geo.name);$a$,
    $a$new.location_name_en := coalesce(nullif(new.ai_suggestions ->> 'place_en', ''),
        case when tg_op = 'UPDATE' and new.location_name is not distinct from old.location_name then new.location_name_en end,
        v_geo.name_en, v_geo.name);$a$);
  v_def := replace(v_def,
    $a$'name_en', coalesce(v_g.name_en, v_item ->> 'name_en', v_g.name));$a$,
    $a$'name_en', coalesce(nullif(v_item ->> 'name_en', ''), v_g.name_en, v_g.name));$a$);
  if v_def not like '%then new.location_name_en end%' or v_def not like '%nullif(v_item ->> ''name_en'', '''')%' then
    raise exception 'events_apply_learned_place: expected text not found';
  end if;
  execute v_def;
end $$;
