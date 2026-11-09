-- Weather timeline: forecast frames rendered from NOAA GFS by tools/gfs/render_frames.py (GitHub Actions,
-- every 6 hours). Public bucket: the frames are public-domain pictures; only the server (service role) writes.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('weather', 'weather', true, 2097152, array['image/png', 'application/json'])
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;
