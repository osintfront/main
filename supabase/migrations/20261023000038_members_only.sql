-- ════════════════════════════════════════════════════════════════════
-- Osintfront · Migration 38 — members-only site
-- The map is no longer public: every visitor signs in first (frontend: RequireAuth on
-- "/" and "/archive"). Here the anonymous role loses read access to the event data,
-- so the API itself refuses visitors who are not signed in. Signed-in accounts
-- (role "authenticated": viewers, editors, admins) keep their existing access.
-- Reversible: grant the same privileges back to anon.
-- ════════════════════════════════════════════════════════════════════
revoke select on public.published_events, public.archived_events, public.event_categories,
  public.events_pulse, public.hfc_pulse, public.active_hfc_alerts from anon;
revoke all on public.event_media from anon;

-- Column-level read grants on events (used through the views).
do $$
declare v_col text;
begin
  for v_col in
    select a.attname from pg_attribute a
    where a.attrelid = 'public.events'::regclass and a.attnum > 0 and not a.attisdropped
      and has_column_privilege('anon', 'public.events', a.attname, 'select')
  loop
    execute format('revoke select (%I) on public.events from anon', v_col);
  end loop;
end $$;

-- Public read functions: signed-in accounts only.
revoke execute on function public.active_hfc_shapes() from public, anon;
grant execute on function public.active_hfc_shapes() to authenticated;
revoke execute on function public.event_media_kinds(uuid) from public, anon;
grant execute on function public.event_media_kinds(uuid) to authenticated;
revoke execute on function public.event_source_text(uuid) from public, anon;
grant execute on function public.event_source_text(uuid) to authenticated;
revoke execute on function public.geo_lookup(text, text, double precision, double precision) from public, anon;
grant execute on function public.geo_lookup(text, text, double precision, double precision) to authenticated;
