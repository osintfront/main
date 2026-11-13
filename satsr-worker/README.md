# Osintfront satellite enhance worker (Windows)

Makes a sharper satellite picture of one small area on demand: a 2.56 km square of
Sentinel-2 (10 m pixels) is super-resolved ×4 to 2.5 m with **SEN2SR Lite**
(ESA OpenSR, CC0 weights). Runs on your own computer and works through the site's
queue by itself. Uses the graphics card when it has CUDA, otherwise the CPU.

**How a job flows**
1. A Pro / Max / Intel subscriber (or staff) presses "Enhance ×4" in the Satellite
   section and clicks a point. The site calls `satsr_request`: the click is snapped
   to a 0.005° cell; if that cell (and date) was already enhanced, or is already in
   the queue, the user gets that result **free** (shared cache). Otherwise a job is
   queued and one daily use is spent (Pro 3, Max / Intel 15 a day, staff unlimited).
   A job that fails gives the use back automatically.
2. The worker claims the job (`satsr_claim`), searches Microsoft Planetary Computer
   for Sentinel-2 L2A pictures over the point (that UTC day, or the last 60 days),
   and picks the newest whose box is at most `MAX_CLOUD` % cloud (from the SCL
   layer), else the least cloudy. No picture → the job fails as `no_scene`.
3. If that exact picture was already enhanced for the cell, the database hands the
   requesters the existing result (`satsr_resolve`) and the worker moves on.
4. Otherwise it reads only the box (red, green, blue, near infrared), upscales it,
   and makes three products, each as a **before** (original 10 m) and an **after**
   (2.5 m) picture on the same web-mercator grid:
   - `tci` true colour, `irp` infrared (vegetation in red), `ndvi` vegetation index.
5. The PNGs go to the private bucket `satsr-results` (`{job}/{product}_sr.png`,
   `{job}/{product}_lr.png`) and the job is marked done (`satsr_finish`). Users who
   asked for it see it on the map with a before/after swipe.

Results older than 60 days are deleted (`satsr_expired`, run hourly while idle).
Jobs nobody processes within 48 hours expire (no use is spent).
The site shows "the processing station is offline" when this worker has not been
seen for 3 minutes; requests still queue and run when it comes back.

## One-time setup
1. **Python 3.12** (or 3.11) from https://www.python.org/downloads/ (tick "Add python.exe to PATH").
2. Double-click **`start.bat`**. First run creates `.env` and opens it in Notepad. Fill in:
   - `SUPABASE_SERVICE_KEY` — Supabase → Project Settings → API → `service_role`.
3. Run `start.bat` again. It installs PyTorch (CUDA build if `nvidia-smi` works,
   else the CPU build), then the rest, downloads the model weights into
   `models/`, and waits for jobs.

Process one job and stop: `start.bat --once`. Log: `worker.log`.
Auto-start with Windows: Win+R → `shell:startup` → shortcut to `start.bat`.

## Good to know
- `.env` holds a full-access database key. Keep it on this computer.
- No Copernicus or Planetary Computer account is needed.
- Speed: on a CPU a 256 px box takes roughly a few minutes (not measured yet on
  your laptop). If it is too slow, lower `BOX_PX` (e.g. 192 or 128) or set
  `TORCH_THREADS`. A job stuck for 15 minutes is retried, 3 tries at most.
- `HARMONIZE=1` removes the +1000 offset that Sentinel-2 pictures processed with
  baseline 04.00 or later carry, so all dates are on the same reflectance scale.
- Engines: `sen2sr_lite_rgbn_x4` (default) and `bicubic_x4` (plain interpolation,
  for comparisons; staff can request it). Allowed names: `app_settings.satsr_engines`;
  default: `app_settings.satsr_engine`. The engine is part of the cache key.
- These are AI reconstructions: fine details are the model's estimate, not an
  observation. The site says so under every result.
- Attribution: "Contains modified Copernicus Sentinel data · SEN2SR (ESA OpenSR)".

## Tests (no network needed)
```
.venv\Scripts\python -m pip install -r requirements-test.txt
.venv\Scripts\python -m unittest discover -s tests -v
```
`test_pipeline_offline` writes the six pictures of a synthetic job into `tests/out/`.
`test_engine_smoke` runs the real model and is skipped until the model is installed.

---

## בקצרה (עברית)
1. להתקין Python 3.12 (לסמן "Add python.exe to PATH").
2. ללחוץ פעמיים על `start.bat`. בפעם הראשונה נפתח קובץ `.env` ב-Notepad: להדביק
   את מפתח ה-`service_role` מ-Supabase בשורה `SUPABASE_SERVICE_KEY=`, לשמור ולסגור.
3. ללחוץ שוב על `start.bat`. ההתקנה הראשונה לוקחת כמה דקות (PyTorch והמודל). אחר כך
   החלון מחכה לבקשות ומעבד אותן לבד. אפשר להשאיר אותו פתוח ברקע.
4. כדי שיעלה עם המחשב: Win+R ← `shell:startup` ← קיצור דרך ל-`start.bat`.

כשהחלון סגור, האתר מציג "תחנת העיבוד אינה מחוברת כרגע" — הבקשות נשמרות בתור
ומעובדות כשמפעילים אותו שוב (עד 48 שעות). המפתח ב-`.env` נותן גישה מלאה למסד
הנתונים: לא לשתף אותו ולא להעלות אותו לשום מקום.
