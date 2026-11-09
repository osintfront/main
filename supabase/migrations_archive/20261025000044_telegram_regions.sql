-- ════════════════════════════════════════════════════════════════════
-- Osintfront · Migration 44 — public Telegram channels by region
-- The public channels known from the Telegram worker's folders (telegram_agents.channels)
-- join the news agents' channel list, each with a region (country / area it reports on).
-- They are added switched OFF: the worker already reads them; switching one on also reads
-- it from the server (every post costs an AI classification + edit).
-- Regions: from the folder when it names a country, otherwise set by the event-agent
-- {action:"classify_channels"} (a cheap model reads the title and username).
-- ════════════════════════════════════════════════════════════════════
alter table public.telegram_channels
  add column if not exists region text,
  add column if not exists folder text,
  add column if not exists origin text not null default 'manual';

insert into public.telegram_channels (username, title, active, origin, folder, region)
select distinct on (lower(u)) u, left(t, 200), false, 'worker', folder,
  case folder when 'לבנון' then 'lebanon' when 'סוריה' then 'syria' when 'תימן' then 'yemen' when 'איראן' then 'iran'
              when 'ירדן' then 'jordan' when 'פלסטינים' then 'palestine' when 'ישראליים' then 'israel' when 'כתבים ישראל' then 'israel' end
from (
  select a.folder, x->>'username' u, coalesce(x->>'title', '') t
  from public.telegram_agents a, jsonb_array_elements(a.channels) x
  where coalesce(x->>'username', '') ~ '^[A-Za-z0-9_]{4,64}$' and a.folder <> '__test'
) c
order by lower(u), (folder = 'Unread')
on conflict (username) do update set
  title = coalesce(nullif(public.telegram_channels.title, ''), excluded.title),
  folder = coalesce(public.telegram_channels.folder, excluded.folder),
  region = coalesce(public.telegram_channels.region, excluded.region);
