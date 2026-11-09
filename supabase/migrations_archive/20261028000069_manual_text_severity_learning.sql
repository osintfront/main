-- (1) A hand-corrected text stays exactly as written: the description shows the corrected
--     Hebrew summary, and ai_suggestions.manual_text stops the AI agents from rewriting it.
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
         description = coalesce(c_he_s, description),
         translations = v_tr || jsonb_build_object('he', v_he, 'en', v_en),
         ai_suggestions = coalesce(ai_suggestions, '{}'::jsonb) || jsonb_build_object('manual_text', now())
   where id = p_id;
end;
$$;

-- (2) Severity set by hand (analysts / admins) — and learned: the classifier gets the latest
--     corrections as examples (like category corrections).
create table if not exists public.severity_corrections (
  id bigint generated always as identity primary key,
  event_id uuid references public.events(id) on delete set null,
  text text not null,
  from_severity text,
  to_severity text not null,
  corrected_by uuid,
  created_at timestamptz not null default now()
);
alter table public.severity_corrections enable row level security;
create policy "severity corrections: staff read" on public.severity_corrections for select to authenticated
  using ((select public.has_permission('event.view.internal')));

create or replace function public.set_event_severity(p_id uuid, p_severity text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_owner uuid; v_old text; v_text text;
begin
  if p_severity not in ('low', 'medium', 'high', 'critical') then raise exception 'bad severity' using errcode = '22023'; end if;
  select created_by, severity::text, coalesce(nullif(original_report_text, ''), title) into v_owner, v_old, v_text
    from public.events where id = p_id and deleted_at is null;
  if not found then raise exception 'Event not found.' using errcode = 'P0002'; end if;
  if auth.uid() is null or not (public.has_permission('event.edit.any')
       or (public.has_permission('event.edit.own') and v_owner = auth.uid())) then
    raise exception 'You do not have permission to edit this event.' using errcode = '42501';
  end if;
  if v_old is distinct from p_severity then
    update public.events set severity = p_severity::public.event_severity where id = p_id;
    insert into public.severity_corrections (event_id, text, from_severity, to_severity, corrected_by)
    values (p_id, left(v_text, 400), v_old, p_severity, auth.uid());
  end if;
end $$;
revoke all on function public.set_event_severity(uuid, text) from public, anon;
grant execute on function public.set_event_severity(uuid, text) to authenticated;
