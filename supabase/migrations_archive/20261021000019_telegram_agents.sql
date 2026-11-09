-- Telegram "agents": one per Telegram folder (tab) of the connected user account.
-- Written by whatsapp-ingest when the local Telegram worker (telegram-worker/) reports its folders.
create table if not exists public.telegram_agents (
  folder          text primary key,
  channels        jsonb not null default '[]'::jsonb,
  channel_count   int not null default 0,
  active          boolean not null default true,
  messages        int not null default 0,
  last_sync_at    timestamptz,
  last_message_at timestamptz,
  created_at      timestamptz not null default now()
);
alter table public.telegram_agents enable row level security;
-- No anon/authenticated policies: service role only.

-- The worker has its own ingest token; only its SHA-256 is stored (set by hand, not in git):
--   insert into public.ingest_config (key, value) values ('telegram_worker_token_sha256', '<sha256 hex>');
