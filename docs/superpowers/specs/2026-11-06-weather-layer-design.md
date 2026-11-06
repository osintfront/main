# Weather layer + sun/moon clock — design (approved 2026-11-06)

Project-plan rows (Follow Ups): "Weather (Live and forecast)" and "שעון זריחה\שקיעה\דמדומים (מלא)".
Owner: Ben. Part 1 of 3 in the agreed order (weather + sun/moon → airfields & ports → ships upgrade).

## Goal
Registered users (Free and up) can:
1. Right-click (long-press on touch) any point on the map and see the weather there now, hourly
   for 48 h, daily for 7 days, plus a full sun/moon clock with the moon's light after clouds.
2. Turn on weather layers in the Intelligence layers panel — clouds, rain, temperature, wind — and
   play a timeline that moves clouds and rain across the map: observed past hours, forecast ahead.

"Weather&Radar" is the look-and-feel reference only; none of its data is used.

## Decisions
- **Access:** new `plan_features` key `weather` — enabled for `free`, `pro`, `max`, `intel`;
  disabled for `guest`. Guests see 🔒 and get the sign-up gate (`openGate('signup')`), as satellite does.
  No daily quota.
- **Point forecast:** MET Norway Locationforecast 2.0 (`compact`), CC BY 4.0 — commercial use OK
  with credit. Requests identify the site (`User-Agent: osintfront.com weather (+https://osintfront.com)`);
  responses are cached; total traffic stays far below 20 req/s.
- **Sun and moon (all of it):** computed in the browser with `suncalc` (`src/lib/moon.ts`), no network —
  dawns/dusks (civil, nautical, astronomical), sunrise/sunset, moonrise/moonset, illumination and the
  moon's altitude per hour. (Changed while planning: MET Sunrise 3.0 does not return twilight times.)
- **Observed clouds and rain (past hours):** EUMETView WMS (no access constraints, no fees):
  `msg_fes:ir108` (Meteosat 0° IR 10.8 µm) for clouds and `msg_fes:h60b` (blended observed precipitation),
  both every 15 min; we use hourly frames.
- **Forecast clouds and rain (moving layer):** NOAA GFS 0.25° (public domain), total cloud cover
  (`TCDC`, entire atmosphere) and precipitation rate (`PRATE`, surface), hourly +1…+72 h. A GitHub
  Actions job (`tools/gfs/render_frames.py`, every 6 h) downloads only the Middle East box
  (25°E–65°E, 10°N–45°N) from NOMADS, renders one Web-Mercator PNG per hour per layer, uploads them to
  the public Supabase Storage bucket `weather` and writes `gfs/latest.json`. The map shows them with
  `L.imageOverlay`. (Changed in Task 0: DWD has no cloud-cover forecast and only 6-hour rain totals.)
- **Temperature and wind layers:** OpenWeatherMap Weather Maps 1.0 tiles (Free plan: ODbL,
  commercial use allowed, 60 calls/min, 1M/month), proxied so the key stays on the server.
- **Units:** °C, mm, km/h with knots in brackets. **Times:** the user's clock; when the point's
  local time differs, it is shown small next to it.
- **Languages:** Hebrew + English, following the `TXT` pattern in `IntelLayers.tsx`.
  Code, comments, commit messages and DB names in English.

## Task 0 result (2026-11-06)
DWD GeoServer: ICON rain only as `Icon_reg025_fd_sl_TOTPREC06H` (6 h totals, 3 h step); no cloud-cover
layer. ECMWF public WMS: no cloud/precipitation layers. EUMETView: verified as above. → GFS pipeline.

## Architecture

### Server — `api/weather.ts` (pattern of `api/aircraft.ts` / `api/sat.ts`)
| Route | Source | Cache (`s-maxage`) |
|---|---|---|
| `GET ?key=1` | — returns the member's weekly tile key (`isMember` + the existing signed weekly key in `api/_lib/member.ts`) | `no-store` |
| `GET ?point=lat,lng&k=` | MET Locationforecast; lat/lng rounded to 0.05° | 1800 s, honour upstream `Expires` |
| `GET ?tile=temp\|wind/z/x/y&k=` | OpenWeatherMap tiles (`OWM_API_KEY` env var) | 600 s |

- Every route except `key` requires a valid weekly key `k`. The key is part of the URL, so CDN-cached
  answers are only reachable by members (a guest without `k` gets 401 before any cache entry exists for it).
- `point` returns a slim shape, not MET's raw JSON:
  `{ updated, now: Hour, hours: Hour[48], days: Day[7] }` with
  `Hour = { t, temp, cloud, rain, windKmh, windDir, gustKmh, humidity, symbol }` and
  `Day = { date, tMax, tMin, rain, windMaxKmh, symbol }`.
- Upstream 5xx/timeout (9 s) → 502 `{ error }`, logged. Upstream 429 → serve the last cached body
  (stale-while-revalidate 3600) and log.

### Browser-direct layers (no server route)
- **EUMETView WMS** (`msg_fes:ir108`, `msg_fes:h60b`): one `L.tileLayer.wms` per past frame, `TIME` = the hour.
- **GFS frames**: `L.imageOverlay(<public storage URL>, [[10, 25], [45, 65]])` per forecast frame, listed in `gfs/latest.json`.
- Attribution strings are set on the layers ("EUMETSAT", "NOAA GFS").

### Client
- `src/lib/weather.ts` — fetchers (`weatherKey`, `fetchPoint`), types, tile URL builders,
  frame list builder (past observed hours + future forecast hours).
- `src/lib/moon.ts` — pure functions over `suncalc`: `sunTimes(date, lat, lng)`, `moonPhase(date)` → `{ fraction, phase: 'new'|'partial'|'half'|'full', waxing }`;
  `effectiveLight(fraction, cloudPct, moonUp)` → `fraction × (1 − 0.9 × cloud/100)`, 0 when the moon is down.
  Phase names follow the project plan: **no moon** (<3% lit), **partial**, **half** (45–55%), **full** (>97%).
- `src/components/map/WeatherCard.tsx` — the right-click card (four tabs, below).
- `src/components/map/WeatherLayers.tsx` — the "Weather" section inside `IntelLayers` + the timeline bar.
- `MapContextMenu.tsx` — new item "Weather & sun/moon here" (`CloudSun` icon); guests → sign-up gate.
- `MapView.tsx` — holds the open card's point; renders `WeatherCard` and the timeline bar.
- Plans: add `'weather'` to `FeatureKey` in `src/lib/plans.ts`; migration
  `20261106000092_weather_feature.sql` inserts the five `plan_features` rows.

## UI

### Weather card (right-click / long-press)
Opens next to the point. Header: coordinates + nearest place name from `geo_places` when one is near.
Tabs:
1. **Now** — temperature, condition icon, cloud %, rain mm/h, wind (speed, direction arrow, gusts), humidity.
2. **48 h** — horizontal hourly strip: temperature, cloud, rain, wind per hour.
3. **7 days** — one row per day: max/min, icon, rain total, max wind.
4. **Sun & moon** — astronomical, nautical, civil dawn; sunrise; sunset; civil, nautical, astronomical
   dusk; day length. Moonrise and moonset; moon state (full / half / partial / no moon); illumination %;
   **light now after clouds**; **tonight, hour by hour** — effective moonlight per hour from sunset to
   sunrise using the hourly cloud forecast, so the darkest hours stand out.
Footer: source credits (MET Norway, CC BY 4.0) and last-updated time.

### "Weather" section in the Intelligence layers panel
- Toggles: ☁️ Clouds, 🌧️ Rain, 🌡️ Temperature, 💨 Wind. One shared opacity slider.
- Colour legends for active layers in the map legend (as ships/aircraft do today).
- Guests: every toggle shows 🔒 and opens the sign-up gate.

### Timeline (clouds and rain that move with the forecast)
Shown under the map while Clouds or Rain is on.
- Range: last 6 h → +72 h, step 1 h, "now" marked. Past hours show observed clouds and rain
  (EUMETView); from "now" on, clouds and rain come from the GFS frames.
- Slider + ▶️/⏸ + current label, e.g. "Fri 18:00 (+9 h)". Play loops at ~2 frames/s.
- Before play: preload only the next 3 frames for the current view and zoom; while playing, show one
  frame and load the next. Never 72 layers at once. Frames that fail are skipped.
- Temperature and wind stay "now" (OWM 1.0 has no forecast).

## Errors
- MET down → card shows "No weather data right now" + retry; the Sun & moon tab still works fully
  (computed locally); only "light after clouds" shows "—".
- A tile source failing → that toggle shows ⚠️ "Unavailable"; nothing else changes.
- Missing timeline frames are skipped; if no forecast frames load, the timeline shows observed hours only
  with a note.

## Performance and cost
- CDN cache per route (table above); point rounding makes nearby clicks share one answer.
- Nothing loads until the card or the section is opened.
- Expected load is far below MET's 20 req/s and OWM's 60/min; if OWM nears its limit, tiles fall back to
  "Unavailable" rather than paying.

## Testing
- **Unit** (`node --experimental-strip-types --test`, like `tests/ofi`):
  `tests/weather/moon.test.ts` — illumination at known full moons and new moons (±2%), phase names,
  `effectiveLight` with 0/50/100% cloud and moon down.
  `tests/weather/normalize.test.ts` — a saved MET Locationforecast sample → the slim `point` shape
  (48 hours, 7 days, km/h conversion, daily max/min).
- **SQL** (`supabase/tests/weather_feature.sql`): `weather` enabled for free/pro/max/intel, disabled for guest.
- **e2e** (`tests/e2e/weather.js`, Playwright `browser_evaluate` like `guest.js`):
  guest → right-click → "Weather here" → sign-up gate; Free member → card opens with four tabs,
  layers turn on, ▶️ advances the timeline label.

## Out of scope
Weather alerts/notifications, radar, historical weather, saving favourite points, weather in the feed.
