-- Picture fingerprints: the same photo reposted by several channels is kept once per event.
-- sha256 = exact bytes; phash = 64-bit difference hash (survives re-compression), hex.
alter table public.event_media add column if not exists sha256 text;
alter table public.event_media add column if not exists phash text;
create index if not exists event_media_event_sha_idx on public.event_media (event_id, sha256);
