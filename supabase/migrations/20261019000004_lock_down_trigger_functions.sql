-- ════════════════════════════════════════════════════════════════════
-- Osintfront · Migration 4 — remove API access to trigger functions
-- Flagged by the Supabase security advisor. Trigger functions can't do
-- anything useful when called via /rest/v1/rpc, but they shouldn't be
-- exposed. EXECUTE is checked when a trigger is created, not when it
-- fires, so the triggers keep working.
-- ════════════════════════════════════════════════════════════════════
revoke execute on function public.events_before_insert()       from public, anon, authenticated;
revoke execute on function public.events_before_update()       from public, anon, authenticated;
revoke execute on function public.events_after_change()        from public, anon, authenticated;
revoke execute on function public.profiles_before_update()     from public, anon, authenticated;
revoke execute on function public.profiles_before_delete()     from public, anon, authenticated;
revoke execute on function public.profiles_after_change()      from public, anon, authenticated;
revoke execute on function public.invitations_before_insert()  from public, anon, authenticated;
revoke execute on function public.invitations_before_update()  from public, anon, authenticated;
revoke execute on function public.invitations_after_change()   from public, anon, authenticated;
revoke execute on function public.handle_new_auth_user()       from public, anon, authenticated;
revoke execute on function public.handle_auth_user_updated()   from public, anon, authenticated;
revoke execute on function public.event_internal_notes_stamp() from public, anon, authenticated;
revoke execute on function public.set_updated_at()             from public, anon, authenticated;
