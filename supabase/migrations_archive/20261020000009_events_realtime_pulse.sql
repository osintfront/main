-- ════════════════════════════════════════════════════════════════════
-- Osintfront · Migration 9 — push updates for the public map
--
-- Every change that affects what the public sees (an event published,
-- edited while published, archived/expired, deleted) bumps a one-row
-- "pulse" table. The site listens to it over Supabase Realtime and
-- refetches at once — no event data travels over the socket, so nothing
-- beyond the public views can leak through it.
-- ════════════════════════════════════════════════════════════════════

create table public.events_pulse (
  id          integer primary key check (id = 1),
  changed_at  timestamptz not null default now()
);
insert into public.events_pulse (id) values (1);

alter table public.events_pulse enable row level security;
revoke all on public.events_pulse from anon, authenticated;
grant select on public.events_pulse to anon, authenticated;
create policy "events pulse: public read" on public.events_pulse for select to anon, authenticated using (true);

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.events_pulse;
  end if;
end $$;

create or replace function public.events_bump_pulse()
returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (tg_op = 'INSERT' and new.status = 'published')
     or (tg_op = 'UPDATE' and (old.status = 'published' or new.status = 'published'
                               or (old.status = 'archived') <> (new.status = 'archived')))
     or (tg_op = 'DELETE' and old.status in ('published', 'archived')) then
    update public.events_pulse set changed_at = now() where id = 1;
  end if;
  return null;
end;
$$;
revoke execute on function public.events_bump_pulse() from public, anon, authenticated;

create trigger events_zz_pulse after insert or update or delete on public.events
  for each row execute function public.events_bump_pulse();
