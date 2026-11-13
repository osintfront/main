-- An event whose pin is inside the Gaza Strip is in Palestine, even when the AI named the attacker's
-- country ("Israel"). Automatic writes only (no signed-in user): a staff member's choice stays. Statements
-- keep the speaker's country. The polygon is the one the map's area filter uses (src/lib/eventFilters.ts).
create or replace function public.events_gaza_country()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is not null or new.latitude is null or new.longitude is null then return new; end if;
  if lower(coalesce(new.country, '')) not in ('israel', 'ישראל') then return new; end if;
  if exists (select 1 from public.event_categories c where c.id = new.category_id and c.slug = 'statements') then return new; end if;
  if extensions.st_contains(
       extensions.st_geomfromtext('POLYGON((34.2166 31.3236, 34.267 31.22, 34.356 31.289, 34.382 31.356, 34.44 31.43, 34.472 31.468, 34.505 31.5, 34.545 31.53, 34.5664 31.5586, 34.53 31.564, 34.49 31.596, 34.2166 31.3236))', 4326),
       extensions.st_setsrid(extensions.st_makepoint(new.longitude, new.latitude), 4326)) then
    new.country := 'Palestine';
  end if;
  return new;
end $$;
revoke execute on function public.events_gaza_country() from public, anon, authenticated;

create trigger events_zzzzzz_gaza_country before insert or update of country, latitude, longitude, category_id on public.events
  for each row execute function public.events_gaza_country();
