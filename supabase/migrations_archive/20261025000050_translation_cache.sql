-- ════════════════════════════════════════════════════════════════════
-- Osintfront · Migration 50 — translation cache and log (POST /api/translate)
-- Every translated text is stored once (by a hash of the target language + the text), so the
-- same text is never sent to a provider twice. Each new translation is also logged with the
-- provider that made it; paid = true marks the paid fallback (Claude).
-- Only the server (service role) reads or writes these tables: RLS on, no policies.
-- ════════════════════════════════════════════════════════════════════
create table if not exists public.translation_cache (
  hash            text primary key,                 -- sha256(target_lang || '\0' || source_text)
  source_text     text not null,
  source_lang     text,
  target_lang     text not null check (target_lang in ('he', 'en')),
  translated_text text not null,
  provider        text not null,                    -- cohere / gemini / groq / openrouter / cohere / huggingface / claude
  model           text,
  paid            boolean not null default false,
  created_at      timestamptz not null default now()
);

create table if not exists public.translation_log (
  id          bigint generated always as identity primary key,
  at          timestamptz not null default now(),
  provider    text not null,                        -- 'none' = every provider failed, original returned
  model       text,
  target_lang text,
  chars       integer,
  paid        boolean not null default false,
  ok          boolean not null default true,
  duration_ms integer,
  detail      text
);
create index if not exists translation_log_at_idx on public.translation_log (at desc);

alter table public.translation_cache enable row level security;
alter table public.translation_log enable row level security;
revoke all on public.translation_cache, public.translation_log from anon, authenticated;
