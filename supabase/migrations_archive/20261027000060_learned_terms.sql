-- ════════════════════════════════════════════════════════════════════
-- Osintfront · Migration 60 — learned terms (translation corrections)
-- Staff teach the editor a term on the "Learning" page: the source word, the right
-- Hebrew and English, and wrong renderings to avoid. Every editing / translation
-- prompt gets the list, and the wrong renderings are replaced in the output
-- (also in free machine translations). First lesson: ירי סריקה = automatic fire.
-- ════════════════════════════════════════════════════════════════════
create table if not exists public.learned_terms (
  id          bigserial primary key,
  term        text not null check (length(btrim(term)) between 2 and 120),
  he          text check (he is null or length(he) <= 120),
  en          text check (en is null or length(en) <= 120),
  avoid       text[] not null default '{}',
  note        text check (note is null or length(note) <= 300),
  created_by  uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at  timestamptz not null default now(),
  check (he is not null or en is not null)
);
create unique index if not exists learned_terms_term_idx on public.learned_terms (lower(btrim(term)));

alter table public.learned_terms enable row level security;
revoke all on public.learned_terms from anon, authenticated;
revoke all on sequence public.learned_terms_id_seq from anon;
grant select, insert, update, delete on public.learned_terms to authenticated;
grant usage on sequence public.learned_terms_id_seq to authenticated;
drop policy if exists "learned terms: staff read" on public.learned_terms;
create policy "learned terms: staff read" on public.learned_terms for select to authenticated
  using ((select public.has_permission('dashboard.view')));
drop policy if exists "learned terms: managers write" on public.learned_terms;
create policy "learned terms: managers write" on public.learned_terms for insert to authenticated
  with check ((select public.has_permission('settings.manage')));
drop policy if exists "learned terms: managers update" on public.learned_terms;
create policy "learned terms: managers update" on public.learned_terms for update to authenticated
  using ((select public.has_permission('settings.manage'))) with check ((select public.has_permission('settings.manage')));
drop policy if exists "learned terms: managers delete" on public.learned_terms;
create policy "learned terms: managers delete" on public.learned_terms for delete to authenticated
  using ((select public.has_permission('settings.manage')));

insert into public.learned_terms (term, he, en, avoid, note, created_by)
values ('ירי סריקה / تمشيط', 'ירי סריקה', 'automatic fire',
        array['sweep fire', 'sweeping fire', 'sweep-fire', 'scanning fire', 'combing fire', 'reconnaissance fire'],
        'ירי אוטומטי מנשק קל', null)
on conflict do nothing;

update public.event_categories
   set name = replace(name, 'sweep fire', 'automatic fire'),
       description = replace(description, 'sweep fire', 'automatic fire')
 where name like '%sweep fire%' or description like '%sweep fire%';

-- Events already written with "sweep fire" in English.
update public.events
   set translations = regexp_replace(regexp_replace(translations::text,
         '\mSweep fire\M', 'Automatic fire', 'g'), '\msweep fire\M', 'automatic fire', 'g')::jsonb
 where translations::text ~* '\msweep fire\M';
