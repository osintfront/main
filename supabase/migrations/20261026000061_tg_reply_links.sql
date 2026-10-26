-- Telegram replies and albums: link a post to the event of the post it replies to / its album.
alter table public.whatsapp_ingest_log add column if not exists tg_group text;
create index if not exists whatsapp_ingest_log_tg_group on public.whatsapp_ingest_log (tg_group) where tg_group is not null;
