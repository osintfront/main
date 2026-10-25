-- ════════════════════════════════════════════════════════════════════
-- Osintfront · Migration 47 — read only the channels pinned in the Telegram tabs
-- Every channel read from the server costs traffic and an AI classification + edit per post.
-- Worker channels are read only when pinned at the top of a Telegram tab (folder).
-- The worker reports pinned channels only (PINNED_ONLY, since 2026-10-21 11:33 UTC), so the
-- tabs it synced after that hold the pinned set. Channels added by hand are not touched.
-- ════════════════════════════════════════════════════════════════════
alter table public.telegram_channels add column if not exists pinned boolean not null default false;

with pinned as (
  select distinct on (lower(x->>'username')) x->>'username' u, coalesce(x->>'title', '') t, a.folder
  from public.telegram_agents a, jsonb_array_elements(a.channels) x
  where a.folder <> '__test' and a.last_sync_at >= '2026-10-21 11:33:11+00'
    and coalesce(x->>'username', '') ~ '^[A-Za-z0-9_]{4,64}$'
  order by lower(x->>'username'), a.last_sync_at desc
)
insert into public.telegram_channels (username, title, active, origin, folder, pinned)
select u, left(t, 200), true, 'worker', folder, true from pinned
on conflict (username) do update set pinned = true,
  title = coalesce(nullif(public.telegram_channels.title, ''), excluded.title);

-- Worker channels: on exactly when pinned.
update public.telegram_channels set active = pinned where origin = 'worker' and active is distinct from pinned;
