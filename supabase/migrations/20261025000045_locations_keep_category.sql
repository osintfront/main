-- Per-place categories survive place resolution (one event per category on ingest),
-- and a report may list up to 30 places.
create or replace function public.resolve_event_locations(p_locations jsonb, p_seed uuid)
returns jsonb language plpgsql stable set search_path = '' as $$
declare
  v_out   jsonb := '[]'::jsonb;
  v_item  jsonb;
  v_lat   numeric;
  v_lng   numeric;
  v_hit   public.place_gazetteer;
  v_name  text;
  v_en    text;
  v_cat   jsonb;
  v_i     int := 0;
begin
  if p_locations is null or jsonb_typeof(p_locations) <> 'array' then return '[]'::jsonb; end if;
  for v_item in select value from jsonb_array_elements(p_locations) loop
    exit when jsonb_array_length(v_out) >= 30;
    continue when jsonb_typeof(v_item) <> 'object';
    v_i := v_i + 1;
    v_name := left(btrim(coalesce(v_item ->> 'name', '')), 120);
    v_en   := left(btrim(coalesce(v_item ->> 'name_en', '')), 120);
    v_cat  := case when coalesce(v_item ->> 'category_slug', '') ~ '^[a-z0-9-]{1,60}$'
                   then jsonb_build_object('category_slug', v_item ->> 'category_slug') else '{}'::jsonb end;
    v_lat := case when jsonb_typeof(v_item -> 'lat') = 'number' then (v_item ->> 'lat')::numeric end;
    v_lng := case when jsonb_typeof(v_item -> 'lng') = 'number' then (v_item ->> 'lng')::numeric end;
    if v_lat between -90 and 90 and v_lng between -180 and 180 then
      v_out := v_out || jsonb_build_array(jsonb_build_object(
        'name', v_name, 'name_en', v_en, 'lat', round(v_lat, 6), 'lng', round(v_lng, 6),
        'precision', coalesce(nullif(v_item ->> 'precision', ''), 'exact')) || v_cat);
      continue;
    end if;
    v_hit := public.lookup_place(v_name);
    if v_hit.id is null and v_en <> '' then v_hit := public.lookup_place(v_en); end if;
    continue when v_hit.id is null or v_hit.kind = 'country';
    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'name', coalesce(nullif(v_name, ''), v_hit.canonical), 'name_en', coalesce(nullif(v_en, ''), v_hit.canonical),
      'lat', round(v_hit.latitude + public.place_jitter(p_seed, v_hit.kind, 10 + v_i), 6),
      'lng', round(v_hit.longitude + public.place_jitter(p_seed, v_hit.kind, 20 + v_i), 6),
      'precision', v_hit.kind) || v_cat);
  end loop;
  return v_out;
end;
$$;
