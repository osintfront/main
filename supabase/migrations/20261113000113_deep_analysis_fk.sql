-- Osintfront · Migration 113 — deep analysis: foreign keys (tidiness only; 112 works without them).
-- Kept apart because it contains "on delete": run by hand in the Supabase SQL editor.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'deep_aliases_entry_fk') then
    alter table public.deep_aliases add constraint deep_aliases_entry_fk
      foreign key (entry_id) references public.deep_entries(id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'event_terms_event_fk') then
    alter table public.event_terms add constraint event_terms_event_fk
      foreign key (event_id) references public.events(id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'deep_entries_created_by_fk') then
    alter table public.deep_entries add constraint deep_entries_created_by_fk
      foreign key (created_by) references auth.users(id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'deep_entries_updated_by_fk') then
    alter table public.deep_entries add constraint deep_entries_updated_by_fk
      foreign key (updated_by) references auth.users(id) on delete set null;
  end if;
end $$;
