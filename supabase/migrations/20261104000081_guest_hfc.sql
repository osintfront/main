-- Stage A / Task 7 — guests see the active red alerts (Home Front Command), like every plan.
drop policy if exists "hfc clusters: anyone reads active" on public.hfc_clusters;
create policy "hfc clusters: anyone reads active" on public.hfc_clusters for select to anon
  using (merged_into is null and expires_at > now() - interval '1 minute');
grant select on public.hfc_clusters, public.active_hfc_alerts to anon;
grant execute on function public.active_hfc_shapes() to anon;
