-- ════════════════════════════════════════════════════════════════════
-- Osintfront · Migration 32 — fast geo_lookup
-- Inside plpgsql the cached generic plan ignored the names index (GIN) and scanned the
-- whole place table by distance (~2.5 s per lookup; events with several places hit the
-- statement timeout, so the editor's Hebrew text was never saved). Now the name match
-- always runs first (materialized), then distance / ranking on those few rows.
-- ════════════════════════════════════════════════════════════════════
create or replace function public.geo_lookup(p_name text, p_country text default null, p_lat double precision default null, p_lng double precision default null)
returns public.geo_places language plpgsql stable set search_path = '' as $$
declare
  v_norm  text := public.normalize_place(p_name);
  v_cc    text := public.country_iso(p_country);
  v_pt    extensions.geography;
  v_try   text;
  v_row   public.geo_places;
begin
  if char_length(v_norm) < 2 then return null; end if;
  if p_lat is not null and p_lng is not null then
    v_pt := extensions.st_setsrid(extensions.st_makepoint(p_lng, p_lat), 4326)::extensions.geography;
  end if;
  foreach v_try in array array[
    v_norm,
    case when v_norm ~ '^[הבלמו][א-ת]{2}' then substr(v_norm, 2) end,
    case when v_norm ~ '^(al|el|an|ad|ar|as|at|az) ' then regexp_replace(v_norm, '^(al|el|an|ad|ar|as|at|az) ', '') end
  ] loop
    continue when v_try is null or v_try = '';
    with c as materialized (
      select g.* from public.geo_places g where g.names @> array[v_try]
    )
    select c.* into v_row from c
    where coalesce(c.feature_code, '') not in ('PCL', 'PCLI', 'PCLD', 'PCLF', 'PCLS', 'TERR', 'CONT')
      and (v_cc is null or c.country_code = v_cc)
      and (v_pt is null or extensions.st_dwithin(c.geom::extensions.geography, v_pt, 150000))
    order by
      case when v_pt is null then 0 else extensions.st_distance(c.geom::extensions.geography, v_pt) end,
      case c.feature_class when 'P' then 1 when 'S' then 2 when 'A' then 3 else 4 end,
      c.population desc
    limit 1;
    if found then return v_row; end if;
  end loop;
  return null;
end;
$$;
