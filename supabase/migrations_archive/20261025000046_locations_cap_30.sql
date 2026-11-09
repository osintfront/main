-- Detailed reports list up to 30 places (quick compose, ingest before the per-category split).
alter table public.events drop constraint if exists events_locations_is_array;
alter table public.events add constraint events_locations_is_array
  check (jsonb_typeof(locations) = 'array' and jsonb_array_length(locations) <= 30) not valid;
alter table public.events validate constraint events_locations_is_array;
