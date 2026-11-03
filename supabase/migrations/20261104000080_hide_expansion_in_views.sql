-- Stage A / Task 7 — the reader views no longer carry the cached expansion (details, religious
-- meaning, implications). The site must ask event-agent for it, so every "expand" is counted.
-- Headline/summary translations stay. Rewrites the current view text in place (column order kept).
do $$
declare
  v text;
  d text;
  stripped constant text := '(e.translations #- ''{he,details}'' #- ''{he,religious}'' #- ''{he,implications}'''
    || ' #- ''{en,details}'' #- ''{en,religious}'' #- ''{en,implications}'') AS translations,';
begin
  foreach v in array array['published_events', 'archived_events'] loop
    d := pg_get_viewdef(('public.' || v)::regclass);
    if position('e.translations,' in d) = 0 then
      raise exception 'view % has no plain e.translations column', v;
    end if;
    execute format('create or replace view public.%I as %s', v, replace(d, 'e.translations,', stripped));
  end loop;
end $$;
