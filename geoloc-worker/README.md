# Osintfront geolocation worker (Windows)

Finds where a photo was taken by matching its skyline to elevation data, then
locates the event's subject (smoke, impact, building) on the ground. Runs on
your own computer and works through the site's queue by itself.

**How a job flows**
1. A job is queued only when someone asks: a Max / Intel subscriber presses
   "Geolocate" in the event window (`request_geolocation`, 20 per day on Max,
   50 on Intel), or staff press "Run again". Only events pinned to a town or an
   exact spot qualify. (Automatic queuing of every new photo exists but is
   off: setting `geoloc_auto`.)
2. The worker downloads the media (for videos: also 6 frames, keeps the one
   with the best skyline), asks Claude Haiku whether there is terrain to match,
   and extracts the sky/terrain line.
3. It downloads Copernicus 30 m elevation tiles for the area (cached in
   `cache/dem`, ~25 MB per 1°×1° tile, first time only), and searches every
   position within `SEARCH_RADIUS_KM` of the reported place: all headings and
   fields of view, then a least-squares refinement, a held-out check and an
   ambiguity test (does another site 1.5 km+ away fit almost as well?).
4. Claude (Opus by default) marks the event's subject in the frame and flags
   AI-made / edited / filmed-off-screen media. The subject pixel is ray-cast
   onto the terrain → target coordinates.
5. Results go back to the job with a confidence grade and two proof boards
   (`geoloc-proofs` bucket): one without the camera, one with it.

**Who sees what**
- Max and Intel subscribers (and staff) only — `can_geolocate()`.
- Subscribers see finished **high/medium** results: target point and the board
  without the camera. The camera point is where a person stood filming, so it
  stays hidden until staff release it (`geoloc_review(job, true)`).
- **low** confidence or flagged media → `needs_review`, staff only.
- No terrain / flat skyline → `skipped` (cheap: stops after the Haiku check).

## One-time setup
1. **Python 3.11+** from https://www.python.org/downloads/ (tick "Add python.exe to PATH").
2. Double-click **`start.bat`**. First run creates `.env` and opens it in Notepad. Fill in:
   - `SUPABASE_SERVICE_KEY` — Supabase → Project Settings → API → `service_role`.
   - `ANTHROPIC_API_KEY` — console.anthropic.com.
3. Run `start.bat` again. It installs what it needs (a few minutes), then waits for jobs.

Process one job and stop: `start.bat --once`. Log: `worker.log`.
Auto-start with Windows: Win+R → `shell:startup` → shortcut to `start.bat`.

## Good to know
- `.env` holds a full-access database key. Keep it on this computer.
- A job takes ~1–4 min of CPU (more cores = faster; `CPU_WORKERS` to limit).
- Accuracy comes mostly from the geometry. Pixel residuals show the fit is
  consistent, not that the location is right; the held-out check and the
  ambiguity ratio are what catch wrong answers. Photos without a skyline
  (streets, smoke-filled frames, night, close-ups) are skipped, not guessed.
- To compare models, set `SCENE_MODEL` and re-run jobs for events whose
  locations you already verified, then compare target distance errors.
- Automatic queuing of new photos is off; to turn it on: `update app_settings set value = 'true' where key = 'geoloc_auto';`

## Tests (no network needed)
```
.venv\Scripts\python -m tests.test_synthetic         # solver recovers a known camera
.venv\Scripts\python -m tests.test_pipeline_offline  # full job → tests/out/board_*.png
```
