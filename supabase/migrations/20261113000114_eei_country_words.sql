-- EEI theatre pre-filter: a country name matches whole words only ("oman" is no longer found inside
-- "Romania"); regex characters in a typed country name are escaped. Same function, one condition changed.
/** Published events of the last 24 h in the theatre (country text or pin inside a box) not yet checked for it. */
create or replace function public.eei_pending(p_hash text, p_limit int)
returns table (id uuid, category_slug text, country text, location_name text, title text, description text)
language sql stable security definer set search_path = '' as $$
  with t as (select spec from public.eei_theatres where hash = p_hash)
  select e.id, c.slug, e.country, e.location_name, e.title, e.description
  from public.events e
  cross join t
  left join public.event_categories c on c.id = e.category_id
  where e.status = 'published' and e.deleted_at is null
    and e.occurred_at >= now() - interval '24 hours'
    and not exists (select 1 from public.eei_tags g where g.theatre_hash = p_hash and g.event_id = e.id)
    and (
      (jsonb_array_length(coalesce(t.spec->'countries', '[]')) = 0 and jsonb_array_length(coalesce(t.spec->'boxes', '[]')) = 0)
      or exists (select 1 from jsonb_array_elements_text(t.spec->'countries') n
                 where char_length(n) >= 2
                   and lower(coalesce(e.country, '')) ~ ('(^|[^[:alnum:]_])' || regexp_replace(n, '([.*+?^${}()|\[\]\\])', '\\\1', 'g') || '($|[^[:alnum:]_])'))
      or exists (select 1 from jsonb_array_elements(t.spec->'boxes') b
                 where e.latitude between (b->>0)::float8 and (b->>2)::float8
                   and e.longitude between (b->>1)::float8 and (b->>3)::float8)
    )
  order by e.occurred_at desc
  limit greatest(least(p_limit, 2000), 0);
$$;

revoke all on function public.eei_pending(text, int) from public, anon, authenticated;
