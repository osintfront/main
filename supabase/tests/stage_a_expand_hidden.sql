-- Stage A / Task 7: the expansion (details / religious / implications) is never served by
-- published_events, so every "expand" goes through event-agent and is counted.
set local role anon;
do $$ begin
  assert (select count(*) from public.published_events
          where translations->'he' ? 'details' or translations->'en' ? 'details'
             or translations->'he' ? 'implications' or translations->'he' ? 'religious') = 0, 'expansion leaks to guests';
  assert (select count(*) from public.published_events where translations->'he' ? 'title') > 0, 'headline translations must stay';
end $$;
reset role;
