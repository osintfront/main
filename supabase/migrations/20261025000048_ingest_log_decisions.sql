-- The ingest log also records skipped messages (off topic / outside the region, and categories
-- not published for now). Those inserts failed the old check, so such messages were never
-- marked as seen and could be classified again (tokens).
alter table public.whatsapp_ingest_log drop constraint if exists whatsapp_ingest_log_decision_check;
alter table public.whatsapp_ingest_log add constraint whatsapp_ingest_log_decision_check
  check (decision = any (array['pending', 'event_published', 'event_draft', 'merged_duplicate',
                               'skipped_not_event', 'skipped_off_topic', 'skipped_category']));
