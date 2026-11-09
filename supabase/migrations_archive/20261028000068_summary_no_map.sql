-- A report that sums up earlier incidents (e.g. "yesterday's Israeli strikes") is kept as an
-- event with its full text, but never pinned on the map: ai_suggestions.no_map = true.
-- Runs after the location triggers (alphabetical order) and clears whatever they set.
create or replace function public.events_no_map() returns trigger
language plpgsql set search_path = '' as $$
begin
  if coalesce(new.ai_suggestions ->> 'no_map', '') = 'true' then
    new.latitude := null;
    new.longitude := null;
    new.location_precision := null;
    new.geocoding_confidence := null;
    new.locations := '[]'::jsonb;
  end if;
  return new;
end $$;
drop trigger if exists events_zzzz_no_map on public.events;
create trigger events_zzzz_no_map before insert or update on public.events
  for each row execute function public.events_no_map();
