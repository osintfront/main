-- Push notifications (also for the site installed as an app): one row per browser/device.
-- filters = the site's filters at the time (null = all events); muted = event types without sound/alert.
create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  filters jsonb,
  muted text[] not null default '{}',
  lang text not null default 'he',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_sent_at timestamptz
);
create index if not exists push_subscriptions_user on public.push_subscriptions (user_id);
alter table public.push_subscriptions enable row level security;
create policy "push: own rows" on public.push_subscriptions for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- Server-only settings (VAPID keys, the sender's cursor and secret). No policies: service role only.
create table if not exists public.push_config (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);
alter table public.push_config enable row level security;
insert into public.push_config (key, value) values ('secret', encode(extensions.gen_random_bytes(24), 'hex'))
  on conflict (key) do nothing;
insert into public.push_config (key, value) values ('cursor', now()::text) on conflict (key) do nothing;
