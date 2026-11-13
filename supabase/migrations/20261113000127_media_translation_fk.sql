-- Osintfront · Migration 127 — media translation: foreign keys (tidiness only; 126 works without them).
-- Kept apart because it contains "on delete": run by hand in the Supabase SQL editor.
-- When an event or a media row is removed, its saved readings and its job row go with it.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'media_readings_media_fk') then
    alter table public.media_readings add constraint media_readings_media_fk
      foreign key (media_id) references public.event_media(id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'media_readings_event_fk') then
    alter table public.media_readings add constraint media_readings_event_fk
      foreign key (event_id) references public.events(id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'media_jobs_event_fk') then
    alter table public.media_jobs add constraint media_jobs_event_fk
      foreign key (event_id) references public.events(id) on delete cascade;
  end if;
end $$;
