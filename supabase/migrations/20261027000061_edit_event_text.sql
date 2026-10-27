-- ════════════════════════════════════════════════════════════════════
-- Osintfront · Migration 61 — staff fix an event's text, and the system learns
-- edit_event_text: analysts and admins correct the Hebrew / English headline and
--   summary from the event window. Same rule as the other quick edits (an analyst's
--   change on a live event is flagged for review by events_editor_review).
-- learn_term: after such a fix the person can save the changed words as a learned
--   term (learned_terms); an existing term gets the new wrong rendering added.
-- ════════════════════════════════════════════════════════════════════
alter table public.learned_terms add column if not exists learned_from uuid references public.events (id) on delete set null;

create or replace function public.edit_event_text(p_id uuid, p_title_he text, p_summary_he text, p_title_en text, p_summary_en text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_owner uuid; v_tr jsonb; v_he jsonb; v_en jsonb;
  c_he_t text := nullif(btrim(p_title_he), '');
  c_he_s text := nullif(btrim(p_summary_he), '');
  c_en_t text := nullif(btrim(p_title_en), '');
  c_en_s text := nullif(btrim(p_summary_en), '');
begin
  select created_by, coalesce(translations, '{}'::jsonb) into v_owner, v_tr from public.events where id = p_id and deleted_at is null;
  if not found then raise exception 'Event not found.' using errcode = 'P0002'; end if;
  if auth.uid() is null or not (public.has_permission('event.edit.any')
       or (public.has_permission('event.edit.own') and v_owner = auth.uid())) then
    raise exception 'You do not have permission to edit this event.' using errcode = '42501';
  end if;
  if c_he_t is null then raise exception 'A Hebrew headline is required.' using errcode = '22023'; end if;
  if length(c_he_t) > 200 or length(coalesce(c_en_t, '')) > 200
     or length(coalesce(c_he_s, '')) > 400 or length(coalesce(c_en_s, '')) > 400 then
    raise exception 'Text too long.' using errcode = '22001';
  end if;
  v_he := coalesce(v_tr->'he', '{}'::jsonb) || jsonb_build_object('title', c_he_t);
  v_he := case when c_he_s is null then v_he - 'summary' else v_he || jsonb_build_object('summary', c_he_s) end;
  v_en := coalesce(v_tr->'en', '{}'::jsonb);
  v_en := case when c_en_t is null then v_en - 'title' else v_en || jsonb_build_object('title', c_en_t) end;
  v_en := case when c_en_s is null then v_en - 'summary' - 'description'
               else v_en || jsonb_build_object('summary', c_en_s, 'description', c_en_s) end;
  update public.events
     set title = c_he_t,
         translations = v_tr || jsonb_build_object('he', v_he, 'en', v_en)
   where id = p_id;
end;
$$;
revoke execute on function public.edit_event_text(uuid, text, text, text, text) from public, anon;
grant execute on function public.edit_event_text(uuid, text, text, text, text) to authenticated;

create or replace function public.learn_term(p_term text, p_he text, p_en text, p_avoid text[], p_event uuid default null)
returns bigint language plpgsql security definer set search_path = '' as $$
declare v_id bigint;
  c_term text := nullif(btrim(p_term), '');
  c_he text := nullif(btrim(p_he), '');
  c_en text := nullif(btrim(p_en), '');
  c_avoid text[] := array(select distinct btrim(a) from unnest(coalesce(p_avoid, '{}')) a
                          where length(btrim(a)) between 2 and 120 and btrim(a) is distinct from c_he and btrim(a) is distinct from c_en);
begin
  if auth.uid() is null or not (public.has_permission('settings.manage') or public.has_permission('event.edit.any')
       or public.has_permission('event.edit.own')) then
    raise exception 'You do not have permission to teach terms.' using errcode = '42501';
  end if;
  if c_term is null or length(c_term) > 120 then raise exception 'Term required.' using errcode = '22023'; end if;
  if c_he is null and c_en is null then raise exception 'Hebrew or English required.' using errcode = '22023'; end if;
  select id into v_id from public.learned_terms where lower(btrim(term)) = lower(c_term);
  if v_id is null then
    insert into public.learned_terms (term, he, en, avoid, learned_from, created_by)
    values (c_term, c_he, c_en, c_avoid, p_event, auth.uid()) returning id into v_id;
  else
    update public.learned_terms
       set he = coalesce(c_he, he), en = coalesce(c_en, en),
           avoid = array(select distinct x from unnest(avoid || c_avoid) x where x is distinct from coalesce(c_he, he) and x is distinct from coalesce(c_en, en))
     where id = v_id;
  end if;
  return v_id;
end;
$$;
revoke execute on function public.learn_term(text, text, text, text[], uuid) from public, anon;
grant execute on function public.learn_term(text, text, text, text[], uuid) to authenticated;

-- Analysts may add terms on the Learning page too (removing stays with admins).
drop policy if exists "learned terms: managers write" on public.learned_terms;
drop policy if exists "learned terms: staff write" on public.learned_terms;
create policy "learned terms: staff write" on public.learned_terms for insert to authenticated
  with check ((select public.has_permission('settings.manage') or public.has_permission('event.edit.any') or public.has_permission('event.edit.own')));
