# Satellite enhance ×4 (SEN2SR) — design

**Goal.** A Pro / Max / Intel user (or staff) clicks a spot; a 2.56 km Sentinel-2 square is
super-resolved from 10 m to 2.5 m and shown on the map as before / after pictures in three
products (true colour, infrared, NDVI), with a swipe comparison.

## Flow
Browser → `satsr_request` (RPC) → `satsr_jobs` queue → local `satsr-worker/` claims the job,
reads the box from Microsoft Planetary Computer (STAC `sentinel-2-l2a`, signed COG links),
runs SEN2SR Lite (`NonReference_RGBN_x4`, CC0), uploads PNGs to the private bucket
`satsr-results` → browser polls `satsr_my_jobs`, signs links, shows two `L.imageOverlay`s.
No Vercel / API change; the worker holds no Copernicus credentials.

## Decisions
- **Engine** `sen2sr_lite_rgbn_x4`: B04, B03, B02, B08 (10 m) → ×4. Pluggable registry
  (`satsr/engines/`); the engine name is stored per job and is part of the cache key; allowed
  names in `app_settings.satsr_engines`, default `satsr_engine`. `bicubic_x4` for tests / staff.
- **Box** 256 × 256 px at 10 m (`BOX_PX`), square (SEN2SR's `predict_large` needs a square
  ≥ 128 px). CPU by default, CUDA when available.
- **Georeferencing**: super-resolve on the tile's native UTM pixels; then warp the result AND
  the original onto ONE shared north-up EPSG:3857 grid (RGBA, transparent where the turned UTM
  box does not reach). Leaflet's image overlay is linear in EPSG:3857, so the bounds are exact.
- **Products** (`satsr/render.py`, a list): `tci` (R,G,B × 2.6), `irp` (NIR,R,G, 2–98 %
  stretch from the original), `ndvi` (fixed ramp). Each has `{job}/{key}_lr.png` (original,
  nearest neighbour on the shared grid) and `{job}/{key}_sr.png`, same stretch for both.
  `products jsonb` holds the paths. Each PNG ≤ 8 MB (bucket limit).
- **Cache** shared and free: key (engine, 0.005° cell, scene date). Only the request that
  creates a job is charged. If the worker finds that the chosen picture was already done,
  `satsr_resolve` / `satsr_finish` merge the job into the existing one (requesters repointed,
  uncharged; uploaded duplicates returned as `orphans` and deleted by the worker).
- **Quota** counted from rows: charged requests today (Asia/Jerusalem) whose job is not
  `failed` — failures give the use back. Pro 3, Max / Intel 15, staff (`role <> 'viewer'`,
  active) unlimited. Enforced even with `enforce_plans` off (like `can_geolocate()`), so the UI
  gates on `satsr_my_quota()`, not on `hasFeature()`. Per-user advisory lock.
- **Queue**: `satsr_max_queue` (40) → `busy`. Running > 15 min is reclaimed, 3 attempts then
  `timeout`; queued > 48 h → `expired`; results deleted after `satsr_retention_days` (60).
- **Worker online**: `satsr_workers.last_seen` (claim + 30 s heartbeat thread) within 3 min.

## Security
RLS on all three tables, read-only for `authenticated` (own requests; jobs you requested;
workers staff-only); `created_by` / `worker` columns are not granted. Writes only through
`security definer` functions with `search_path = ''`; worker functions are `service_role`
only. Storage read policy: `satsr_object_allowed(name)` = a done job whose `products` lists
that exact path, and the caller is staff or requested the job.

## Swipe under leaflet-rotate
Overlay panes `ofmSrA` (before) / `ofmSrB` (after) live in `rotatePane`. The two screen halves
of the divider are mapped corner by corner with `map.containerPointToLayerPoint` (which knows
the bearing) and applied as CSS `clip-path: polygon(...)`. The date-compare swipe keeps its own
panes and `clip`, so the two never interfere.

## Tests
`supabase/tests/sat_enhance.sql` (one DO block, ends with `SAT_ENHANCE_ALL_OK`),
`satsr-worker/tests/` (offline, `python -m unittest discover -s tests`),
`tests/satsr/satEnhance.test.ts` (node).
