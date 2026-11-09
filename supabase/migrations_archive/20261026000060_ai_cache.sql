-- Cost: never process the same item twice.
-- 1. Classifier cache: the exact same text already classified (last 7 days) → reuse.
create index if not exists whatsapp_ingest_log_text_md5 on public.whatsapp_ingest_log (md5(message_text));

create or replace function public.ingest_cached_decision(p_text text)
returns table(decision text, event_id uuid)
language sql stable security definer set search_path = public as $$
  select l.decision, case when e.id is not null and e.deleted_at is null then l.event_id end
  from public.whatsapp_ingest_log l
  left join public.events e on e.id = l.event_id
  where md5(l.message_text) = md5(p_text) and l.message_text = p_text
    and l.sent_at > now() - interval '7 days'
    and l.decision not in ('pending')
  order by (e.id is not null and e.deleted_at is null) desc, l.sent_at desc
  limit 1
$$;
revoke all on function public.ingest_cached_decision(text) from public, anon, authenticated;

-- 2. Generic AI result cache ("ask the map" answers, 15 minutes).
create table if not exists public.ai_cache (
  kind text not null,
  key text not null,
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key (kind, key)
);
alter table public.ai_cache enable row level security;
