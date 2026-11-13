-- Changing an event's location did not change the place shown (bug, Dani): a manager moved an event from
-- Gaza to Lebanon and the card still said Gaza. move_event_pin / the editor save write location_name and the
-- coordinates, but the card shows location_name_he / location_name_en (and the country line), which nothing
-- refreshed. Worse, events_learn_from_correction then learned the old name at the new spot ("pin moved, same
-- name → that name lives here").
--
-- events_staff_location (staff edits only, i.e. a signed-in user):
--  · pin moved more than ~5 km and the name not changed → the place there takes over: location_name,
--    _he, _en, city from the nearest place in the database (within 15 km), country from its country code;
--    no place nearby → the old names are cleared rather than left wrong. A small move (a correction inside the
--    same town) keeps its names.
--  · name changed → that name goes into its own language's column; the other language comes from the
--    nearest place within 5 km, or is cleared.
--  · location_resolution points at the new place (or drops the old geonameid), so the learning trigger never
--    writes the new names onto the old place's row.
--  · the event's own entry in `locations` (at the new point) takes the new names.
-- A typed name equal to one of the old names (the same place in another language) does not count as a rename.

create or replace function public.country_name_from_code(p_code text)
returns text language sql immutable parallel safe set search_path = '' as $$
  select case upper(coalesce(p_code, ''))
    when 'IL' then 'Israel' when 'PS' then 'Palestine' when 'LB' then 'Lebanon' when 'SY' then 'Syria'
    when 'IQ' then 'Iraq' when 'IR' then 'Iran' when 'YE' then 'Yemen' when 'SA' then 'Saudi Arabia'
    when 'JO' then 'Jordan' when 'EG' then 'Egypt' when 'TR' then 'Turkey' when 'CY' then 'Cyprus' end;
$$;

create or replace function public.events_staff_location()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_pt     extensions.geometry;
  v_far    boolean;
  v_name   text := btrim(coalesce(new.location_name, ''));
  v_rename boolean;
  v_he     boolean;
  v_lat    boolean;
  p        record;
  v_cc     text;
begin
  if auth.uid() is null or tg_op <> 'UPDATE' or new.latitude is null or new.longitude is null then return new; end if;
  -- Staff wrote the translated names themselves in this same update: theirs stand.
  if new.location_name_he is distinct from old.location_name_he or new.location_name_en is distinct from old.location_name_en then
    return new;
  end if;

  v_far := old.latitude is null or old.longitude is null
    or extensions.st_distance(
         extensions.st_setsrid(extensions.st_makepoint(old.longitude, old.latitude), 4326)::extensions.geography,
         extensions.st_setsrid(extensions.st_makepoint(new.longitude, new.latitude), 4326)::extensions.geography) > 5000;
  v_rename := new.location_name is distinct from old.location_name and v_name <> ''
    and public.normalize_place(v_name) is distinct from public.normalize_place(old.location_name)
    and public.normalize_place(v_name) is distinct from public.normalize_place(old.location_name_he)
    and public.normalize_place(v_name) is distinct from public.normalize_place(old.location_name_en);
  if not v_far and not v_rename then return new; end if;

  v_pt := extensions.st_setsrid(extensions.st_makepoint(new.longitude, new.latitude), 4326);
  select g.geonameid, g.name, g.name_he, g.name_en, g.country_code,
         extensions.st_distance(g.geom::extensions.geography, v_pt::extensions.geography) / 1000 as km
    into p
    from public.geo_places g
   where g.geom operator(extensions.&&) extensions.st_expand(v_pt, 0.2)
     and extensions.st_dwithin(g.geom::extensions.geography, v_pt::extensions.geography, 15000)
   order by (g.feature_class is distinct from 'P'), g.geom operator(extensions.<->) v_pt
   limit 1;

  if v_rename then
    v_he := public.has_hebrew(v_name);
    v_lat := v_name ~ '^[A-Za-z0-9À-ɏ ''’.,()/-]+$';
    new.location_name_he := case when v_he then left(v_name, 200) when p.km <= 5 then p.name_he end;
    new.location_name_en := case when v_lat then left(v_name, 200) when p.km <= 5 then coalesce(p.name_en, p.name) end;
  elsif p.geonameid is not null then
    new.location_name := left(coalesce(p.name, p.name_en, ''), 200);
    new.location_name_he := p.name_he;
    new.location_name_en := coalesce(p.name_en, p.name);
    if new.city is not distinct from old.city then new.city := p.name; end if;
  else
    -- Nothing in the place database near the new spot: no name is better than the old, wrong one.
    new.location_name := '';
    new.location_name_he := null;
    new.location_name_en := null;
    if new.city is not distinct from old.city then new.city := ''; end if;
  end if;

  -- Country follows a real move, unless staff set it in this same update.
  if v_far and new.country is not distinct from old.country then
    v_cc := public.country_name_from_code(p.country_code);
    if v_cc is not null and v_cc is distinct from old.country then
      new.country := v_cc;
      if new.region is not distinct from old.region then new.region := ''; end if;
    end if;
  end if;

  -- The learning trigger reads location_resolution.geonameid: point it at the new place (renamed or not near
  -- any place → no geonameid), never at the old one.
  new.ai_suggestions := coalesce(new.ai_suggestions, '{}'::jsonb) || jsonb_build_object(
    'location_resolution', jsonb_strip_nulls(jsonb_build_object(
      'method', 'staff_move',
      'geonameid', case when not v_rename and p.geonameid is not null then p.geonameid end,
      'place', coalesce(p.name_en, p.name),
      'resolved_at', now())));

  -- The event's own entry in `locations` (the one at the new point) takes the new names.
  if jsonb_typeof(new.locations) = 'array' then
    new.locations := (
      select coalesce(jsonb_agg(case
               when jsonb_typeof(x -> 'lat') = 'number' and jsonb_typeof(x -> 'lng') = 'number'
                    and abs((x ->> 'lat')::float8 - new.latitude) < 0.0005 and abs((x ->> 'lng')::float8 - new.longitude) < 0.0005
               then (x - 'geonameid') || jsonb_strip_nulls(jsonb_build_object(
                      'name', coalesce(new.location_name_he, nullif(new.location_name, '')),
                      'name_en', new.location_name_en))
               else x end order by i), '[]'::jsonb)
        from jsonb_array_elements(new.locations) with ordinality as t(x, i));
  end if;
  return new;
end $$;
revoke execute on function public.events_staff_location() from public, anon, authenticated;

drop trigger if exists events_ab_staff_location on public.events;
-- Runs after events_a_resolve_location and events_aa_editor_review (BEFORE triggers fire in name order).
create trigger events_ab_staff_location before update of latitude, longitude, location_name on public.events
  for each row execute function public.events_staff_location();
