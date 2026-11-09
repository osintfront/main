-- ════════════════════════════════════════════════════════════════════
-- Osintfront · Migration 14 — news agents (per-country crawlers + editor)
--
--   intel_sources  the Intelligence source list (one row per site), grouped
--                  by agent: lebanon, yemen, syria, iran, international, research
--   intel_items    every article an agent has seen (dedupe + audit trail)
--   intel_agents   per-agent run state
--   intel_config   private config (cron secret) — no API access at all
--
-- The `intel-crawler` Edge Function is called every 5 minutes by pg_cron
-- (pg_net, fire-and-forget). Each call runs the agent that is most overdue:
-- daytime (07:00–23:00 Israel) every 30 minutes, night every 60 minutes.
-- Relevant articles go through the editor agent and are published.
-- ════════════════════════════════════════════════════════════════════

create extension if not exists pg_net;

insert into public.app_settings (key, value) values
  ('intel_crawler', '{"enabled": true, "day_start_hour": 7, "day_end_hour": 23, "day_interval_min": 30,
                      "night_interval_min": 60, "max_events_per_run": 5, "max_age_hours": 6}')
on conflict (key) do nothing;

-- WhatsApp-ready version of an edited report (staff only; not granted to anon).
alter table public.events add column whatsapp_text text check (char_length(whatsapp_text) <= 8000);

create table public.intel_agents (
  agent        text primary key check (agent in ('lebanon', 'yemen', 'syria', 'iran', 'international', 'research')),
  label_he     text not null,
  sort_order   integer not null default 0,
  last_run_at  timestamptz,
  last_result  jsonb not null default '{}'::jsonb
);
insert into public.intel_agents (agent, label_he, sort_order) values
  ('lebanon', 'לבנון', 1), ('yemen', 'תימן', 2), ('syria', 'סוריה', 3),
  ('iran', 'איראן', 4), ('international', 'בינלאומי', 5), ('research', 'מכוני מחקר', 6);

create table public.intel_sources (
  id                    uuid primary key default gen_random_uuid(),
  agent                 text not null references public.intel_agents (agent) on delete cascade,
  url                   text not null unique check (url ~ '^https?://'),
  name                  text not null default '',
  feed_url              text check (feed_url is null or feed_url ~ '^https?://'),
  feed_checked_at       timestamptz,
  active                boolean not null default true,
  baseline_done         boolean not null default false,
  last_run_at           timestamptz,
  last_ok_at            timestamptz,
  last_error            text,
  consecutive_failures  integer not null default 0,
  items_found           integer not null default 0,
  events_created        integer not null default 0,
  created_at            timestamptz not null default now()
);
create index intel_sources_agent_idx on public.intel_sources (agent) where active;

create table public.intel_items (
  id            bigserial primary key,
  source_id     uuid references public.intel_sources (id) on delete set null,
  agent         text,
  url           text not null unique,
  title         text not null default '',
  published_at  timestamptz,
  status        text not null check (status in ('baseline', 'old', 'irrelevant', 'published', 'duplicate', 'error', 'skipped')),
  event_id      uuid references public.events (id) on delete set null,
  reason        text,
  created_at    timestamptz not null default now()
);
create index intel_items_created_idx on public.intel_items (created_at desc);

create table public.intel_config (
  key    text primary key,
  value  text not null
);
insert into public.intel_config (key, value)
values ('cron_secret', encode(extensions.gen_random_bytes(24), 'hex'));

-- ─── Access ────────────────────────────────────────────────────────
alter table public.intel_agents  enable row level security;
alter table public.intel_sources enable row level security;
alter table public.intel_items   enable row level security;
alter table public.intel_config  enable row level security;
revoke all on public.intel_agents, public.intel_sources, public.intel_items, public.intel_config from anon, authenticated;

grant select on public.intel_agents, public.intel_items to authenticated;
grant select, insert, update, delete on public.intel_sources to authenticated;
create policy "intel agents: staff read" on public.intel_agents for select to authenticated
  using ((select public.has_permission('dashboard.view')));
create policy "intel items: staff read" on public.intel_items for select to authenticated
  using ((select public.has_permission('dashboard.view')));
create policy "intel sources: staff read" on public.intel_sources for select to authenticated
  using ((select public.has_permission('dashboard.view')));
create policy "intel sources: managers insert" on public.intel_sources for insert to authenticated
  with check ((select public.has_permission('settings.manage')));
create policy "intel sources: managers update" on public.intel_sources for update to authenticated
  using ((select public.has_permission('settings.manage'))) with check ((select public.has_permission('settings.manage')));
create policy "intel sources: managers delete" on public.intel_sources for delete to authenticated
  using ((select public.has_permission('settings.manage')));
-- intel_config: no policies, no grants — only the service role (Edge Functions) and cron read it.

-- ─── The Intelligence source list ──────────────────────────────────
insert into public.intel_sources (agent, url, name) values
  -- לבנון
  ('lebanon', 'https://trends24.in/lebanon/', 'Trends24 Lebanon'),
  ('lebanon', 'https://www.aljazeera.com/tag/lebanon', 'Al Jazeera – Lebanon'),
  ('lebanon', 'https://english.alarabiya.net/tag/lebanon', 'Al Arabiya – Lebanon'),
  ('lebanon', 'https://www.newarab.com/tag/lebanon', 'The New Arab – Lebanon'),
  ('lebanon', 'https://www.mtv.com.lb/', 'MTV Lebanon'),
  ('lebanon', 'https://www.lbcgroup.tv/news/en', 'LBCI (English)'),
  ('lebanon', 'https://www.annahar.com/english', 'Annahar (English)'),
  ('lebanon', 'https://today.lorientlejour.com/', 'L''Orient Today'),
  ('lebanon', 'https://www.naharnet.com/', 'Naharnet'),
  ('lebanon', 'https://the961.com/', 'The961'),
  ('lebanon', 'https://nna-leb.gov.lb/en', 'NNA Lebanon'),
  ('lebanon', 'https://www.annahar.com/', 'Annahar'),
  ('lebanon', 'https://www.lbcgroup.tv/', 'LBCI'),
  ('lebanon', 'https://al-akhbar.com/', 'Al-Akhbar'),
  ('lebanon', 'https://janoubia.com/', 'Janoubia'),
  ('lebanon', 'https://www.lebanonfiles.com/', 'Lebanon Files'),
  -- תימן
  ('yemen', 'https://yemennownews.com/', 'Yemen Now'),
  ('yemen', 'https://barran.press/', 'Barran Press'),
  ('yemen', 'https://deraalganoob.com/', 'Deraa Al-Ganoob'),
  ('yemen', 'https://www.aljazeera.com/tag/yemen', 'Al Jazeera – Yemen'),
  ('yemen', 'https://english.alarabiya.net/tag/yemen', 'Al Arabiya – Yemen'),
  ('yemen', 'https://www.newarab.com/tag/yemen', 'The New Arab – Yemen'),
  ('yemen', 'https://www.sabanew.net/', 'Saba New'),
  ('yemen', 'https://almasdaronline.com/', 'Al-Masdar Online'),
  ('yemen', 'https://www.saba.ye/en', 'Saba (Yemen)'),
  -- סוריה
  ('syria', 'https://www.aljazeera.com/tag/syria', 'Al Jazeera – Syria'),
  ('syria', 'https://english.alarabiya.net/tag/syria', 'Al Arabiya – Syria'),
  ('syria', 'https://www.newarab.com/tag/syria', 'The New Arab – Syria'),
  ('syria', 'https://www.syria-report.com/', 'The Syria Report'),
  ('syria', 'https://sana.sy/en', 'SANA'),
  ('syria', 'https://english.enabbaladi.net/', 'Enab Baladi'),
  ('syria', 'https://syrianobserver.com/', 'Syrian Observer'),
  ('syria', 'https://syriadirect.org/', 'Syria Direct'),
  -- איראן
  ('iran', 'https://www.aljazeera.com/tag/iran', 'Al Jazeera – Iran'),
  ('iran', 'https://english.alarabiya.net/tag/iran', 'Al Arabiya – Iran'),
  ('iran', 'https://www.newarab.com/tag/iran', 'The New Arab – Iran'),
  ('iran', 'https://www.iranintl.com/en', 'Iran International'),
  ('iran', 'https://www.tehrantimes.com/', 'Tehran Times'),
  ('iran', 'https://en.irna.ir/', 'IRNA'),
  ('iran', 'https://en.isna.ir/', 'ISNA'),
  ('iran', 'https://www.tasnimnews.com/en', 'Tasnim'),
  ('iran', 'https://www.farsnews.ir/en', 'Fars'),
  ('iran', 'https://www.presstv.ir/', 'Press TV'),
  -- בינלאומי
  ('international', 'https://militarywatchmagazine.com/', 'Military Watch Magazine'),
  ('international', 'https://defense-arab.com/news/', 'Defense Arab'),
  ('international', 'https://www.defense-arabic.com/', 'Defense Arabic'),
  ('international', 'https://www.aljazeera.com/', 'Al Jazeera'),
  ('international', 'https://www.alarabiya.net/', 'Al Arabiya'),
  ('international', 'https://www.newarab.com/', 'The New Arab'),
  ('international', 'https://english.aawsat.com/', 'Asharq Al-Awsat'),
  ('international', 'https://www.middleeasteye.net/', 'Middle East Eye'),
  ('international', 'https://www.alhadath.net/', 'Al Hadath'),
  ('international', 'https://www.almayadeen.net/', 'Al Mayadeen'),
  ('international', 'https://nziv.net/', 'nziv.net'),
  ('international', 'https://www.telegraph.co.uk/middle-east/', 'The Telegraph – Middle East'),
  ('international', 'https://www.wsj.com/news/regions/middle-east', 'WSJ – Middle East'),
  ('international', 'https://www.axios.com/world/middle-east', 'Axios – Middle East'),
  ('international', 'https://www.reuters.com/world/middle-east', 'Reuters – Middle East'),
  ('international', 'https://apnews.com/hub/middle-east', 'AP – Middle East'),
  ('international', 'https://www.bbc.com/news/world/middle_east', 'BBC – Middle East'),
  ('international', 'https://edition.cnn.com/world/middle-east', 'CNN – Middle East'),
  ('international', 'https://www.theguardian.com/world/middleeast', 'The Guardian – Middle East'),
  ('international', 'https://www.bloomberg.com/regions/middle-east', 'Bloomberg – Middle East'),
  -- מכוני מחקר
  ('research', 'https://www.washingtoninstitute.org/', 'Washington Institute'),
  ('research', 'https://www.fdd.org/', 'FDD'),
  ('research', 'https://www.mei.edu/', 'Middle East Institute'),
  ('research', 'https://www.middleeastmonitor.com/', 'Middle East Monitor'),
  ('research', 'https://www.thenationalnews.com/', 'The National'),
  ('research', 'https://www.al-monitor.com/', 'Al-Monitor'),
  ('research', 'https://dayan.org/', 'Moshe Dayan Center'),
  ('research', 'https://www.inss.org.il/', 'INSS'),
  ('research', 'https://jiss.org.il/', 'JISS'),
  ('research', 'https://www.runi.ac.il/research-institutes/government/ips', 'IPS Reichman University'),
  ('research', 'https://studies.aljazeera.net/', 'Al Jazeera Centre for Studies'),
  ('research', 'https://www.dohainstitute.org/', 'Doha Institute'),
  ('research', 'https://www.iiss.org/', 'IISS'),
  ('research', 'https://ecfr.eu/', 'ECFR'),
  ('research', 'https://israel-alma.org/', 'Alma Center')
on conflict (url) do nothing;

-- Keep the article log to two weeks.
select cron.schedule('osintfront-intel-items-cleanup', '41 3 * * *',
  $c$delete from public.intel_items where created_at < now() - interval '14 days'$c$);
