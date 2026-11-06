# Weather Layer + Sun/Moon Clock Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Right-click weather card (now / 48 h / 7 days / sun & moon) and a "Weather" section in the Intelligence layers panel with clouds and rain that move on a forecast timeline.

**Architecture:** One Vercel route `api/weather.ts` (point forecast from MET Norway, OpenWeatherMap tile proxy, weekly member key) with a pure normalizer in `api/_lib/weatherNormalize.ts`. Astronomy is computed in the browser with `suncalc` in `src/lib/moon.ts`. Cloud and rain frames are WMS layers loaded straight from EUMETView (observed) and DWD (ICON forecast), driven by a timeline component.

**Tech Stack:** React 19, Leaflet 1.9, TypeScript 5.8, Vite, Vercel functions (Web `Request`/`Response`), Supabase (Postgres migrations), `node --test` with `--experimental-strip-types`, `suncalc`.

**Spec:** `docs/superpowers/specs/2026-11-06-weather-layer-design.md`

## Global Constraints

- Access: `plan_features.feature_key = 'weather'` — enabled for `free`, `pro`, `max`, `intel`; disabled for `guest`. No daily quota.
- Guests: 🔒 on every weather control; clicking opens `openGate('signup')`.
- MET requests send `User-Agent: osintfront.com weather (+https://osintfront.com)`; total traffic far below 20 req/s.
- Point coordinates rounded to 0.05° on the server before calling MET.
- Every `api/weather.ts` route except `?key=1` requires a valid weekly key `k` (`tileKeyOk`); invalid → 403, before any upstream call.
- Cache headers: point `public, max-age=300, s-maxage=1800, stale-while-revalidate=3600`; OWM tiles `public, max-age=300, s-maxage=600`; key `no-store`.
- Units: °C, mm, km/h with knots in brackets (`1 m/s = 3.6 km/h`, `1 km/h = 0.539957 kn`).
- Times shown in the user's clock; the point's local time shown small next to it when its zone differs.
- Moon state thresholds (lit fraction): `<0.03` no moon · `0.45–0.55` half · `>0.97` full · otherwise partial.
- Effective moonlight: `fraction × (1 − 0.9 × cloud/100)`, `0` when the moon's altitude ≤ 0.
- Timeline: −6 h … +72 h, step 1 h; past = Meteosat clouds only; from now = DWD ICON clouds + rain; play ≈ 2 frames/s; preload at most the next 3 frames.
- Credits: "MET Norway (CC BY 4.0)", "EUMETSAT", "Deutscher Wetterdienst", "OpenWeatherMap".
- Texts in Hebrew + English using the `TXT = { he, en }` pattern of `IntelLayers.tsx`. Code, comments, commit messages and DB names in English.
- Commits end with the session's Co-Authored-By / Claude-Session lines.

## Review Focus

1. **MET timeseries without `next_1_hours`** (after ~60 h MET only gives `next_6_hours`): hours and daily rain must still be filled, not `NaN`/crash → test in Task 3.
2. **No moonrise or moonset on a date** (it happens about once a month): the card shows "—", never "Invalid Date" → test in Task 2.
3. **Weekly key rotated while the page stayed open**: a 403 from `api/weather` must fetch a fresh key once and retry, not break silently → test in Task 4.
4. **Two right-clicks in quick succession**: the card must show the second point's weather, never the slower first answer → test in Task 5 (`latestOnly`).
5. **A point outside the countries we know a time zone for** (sea, Egypt, Turkey…): no point-local time is shown and nothing throws → test in Task 2 (`zoneForCountry`).

---

### Task 0: Verify the external sources and capture fixtures

No product code. Uses the user's browser (built-in browser, or Claude in Chrome), because these hosts refuse this environment's proxy.

**Files:**
- Create: `src/lib/weatherSources.ts`
- Create: `tests/weather/fixtures/met-compact.json`

**Interfaces:**
- Produces (`src/lib/weatherSources.ts`, exported consts, values filled from what you verify):
  `DWD_WMS_URL: string`, `DWD_LAYER_CLOUD: string`, `DWD_LAYER_RAIN: string`,
  `EUMET_WMS_URL: string`, `EUMET_LAYER_CLOUD: string`, `WMS_TIME_FORMAT: 'iso-hour'` (comment the exact format the servers accept, e.g. `2026-11-06T09:00:00.000Z`).

- [ ] **Step 1: Read DWD capabilities** at `https://maps.dwd.de/geoserver/dwd/wms?service=WMS&request=GetCapabilities`. Find global ICON layers for total precipitation and total cloud cover. Record: names, bounding box, `TIME` dimension extent and step, the service's AccessConstraints/Fees text.
- [ ] **Step 2: Gate.** The bbox must cover 25°E–65°E / 10°N–45°N, the TIME extent must reach ≥ +48 h hourly, and AccessConstraints must allow reuse with attribution. **If any fails: STOP, do not continue the plan, report to the owner with alternative C (own GFS tiles).**
- [ ] **Step 3: Read EUMETView capabilities** at `https://view.eumetsat.int/geoserver/wms?service=WMS&request=GetCapabilities`. Pick the Meteosat 0° IR 10.8 µm (or cloud) layer covering the Middle East; record its name and TIME extent (must include each of the last 6 hours).
- [ ] **Step 4: Load one tile of each layer in the browser** for the Middle East at a forecast hour (DWD) and the last hour (EUMETView) and confirm pictures come back (not blank, not an XML error).
- [ ] **Step 5: Save a MET sample**: open `https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=33.27&lon=35.20` and save the JSON to `tests/weather/fixtures/met-compact.json`.
- [ ] **Step 6: Write `src/lib/weatherSources.ts`** with the verified values and a header comment listing the AccessConstraints text and the date checked.
- [ ] **Step 7: Commit**

```bash
git add src/lib/weatherSources.ts tests/weather/fixtures/met-compact.json
git commit -m "Weather: verified WMS sources + MET sample fixture"
```

---

### Task 1: `weather` plan feature + nearest-place lookup

**Files:**
- Create: `supabase/migrations/20261106000092_weather_feature.sql`
- Create: `supabase/tests/weather_feature.sql`
- Modify: `src/lib/plans.ts` (the `FeatureKey` union)

**Interfaces:**
- Produces: `FeatureKey` includes `'weather'`.
- Produces: RPC `public.geo_nearest_place(p_lat double precision, p_lng double precision) returns table(name text, name_he text, name_en text, country_code text, km double precision)` — the nearest `geo_places` row within 15 km, preferring populated places (`feature_class = 'P'`); 0 rows when none. `security definer`, `set search_path = ''`, `grant execute … to authenticated` (not anon).

- [ ] **Step 1: Write the failing SQL test** `supabase/tests/weather_feature.sql` (style of `stage_a_plans.sql`, run inside `begin; … rollback;`):

```sql
do $$
begin
  assert (select not enabled from public.plan_features where feature_key='weather' and plan_id='guest'), 'guest weather must be off';
  assert (select count(*) from public.plan_features where feature_key='weather' and plan_id in ('free','pro','max','intel') and enabled and limit_value is null) = 4, 'weather on for free/pro/max/intel, no limit';
  assert (select count(*) from public.geo_nearest_place(33.2733, 35.2033)) = 1, 'a place near Tyre';
  assert (select count(*) from public.geo_nearest_place(33.0, 30.0)) = 0, 'nothing in the open sea';
end $$;
set local role anon;
do $$ begin
  perform public.geo_nearest_place(33.27, 35.2);
  raise exception 'anon must not call geo_nearest_place';
exception when insufficient_privilege then null; end $$;
```

- [ ] **Step 2: Run it** via Supabase MCP `execute_sql` wrapped in `begin; … rollback;`. Expected: FAIL (`weather` rows missing / function missing).
- [ ] **Step 3: Write the migration**: insert the five `plan_features` rows (`note = 'weather layers and card'`) with `on conflict (feature_key, plan_id) do update`; create `geo_nearest_place` using `extensions.ST_DWithin(geom::geography, …, 15000)` ordered by `(feature_class <> 'P'), distance`, `limit 1`.
- [ ] **Step 4: Apply** with Supabase MCP `apply_migration` (name `weather_feature`). Re-run the test. Expected: no assertion error.
- [ ] **Step 5: Add `'weather'` to `FeatureKey`**; run `npm run typecheck`. Expected: exit 0.
- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20261106000092_weather_feature.sql supabase/tests/weather_feature.sql src/lib/plans.ts
git commit -m "Weather: plan feature for registered users + nearest-place lookup"
```

---

### Task 2: Astronomy — `src/lib/moon.ts`

**Files:**
- Modify: `package.json` (add `suncalc` ^1.9.0, dev `@types/suncalc`)
- Create: `src/lib/moon.ts`
- Test: `tests/weather/moon.test.ts`

**Interfaces:**
- Produces:
  - `type MoonState = 'new' | 'partial' | 'half' | 'full'`
  - `moonPhase(at: Date): { fraction: number; state: MoonState; waxing: boolean }`
  - `effectiveLight(fraction: number, cloudPct: number | null, moonUp: boolean): number | null` (null when cloud is null)
  - `interface SunTimes { astroDawn: Date|null; nauticalDawn: Date|null; civilDawn: Date|null; sunrise: Date|null; sunset: Date|null; civilDusk: Date|null; nauticalDusk: Date|null; astroDusk: Date|null; dayLengthMin: number|null }`
  - `sunTimes(day: Date, lat: number, lng: number): SunTimes` (invalid suncalc dates → null)
  - `moonTimes(day: Date, lat: number, lng: number): { rise: Date|null; set: Date|null }`
  - `moonUp(at: Date, lat: number, lng: number): boolean` (altitude > 0)
  - `tonightHours(from: Date, to: Date, lat: number, lng: number): Date[]` (whole hours in [from, to])
  - `zoneForCountry(cc: string | null): string | null` — IL Asia/Jerusalem, PS Asia/Hebron, LB Asia/Beirut, SY Asia/Damascus, JO Asia/Amman, IQ Asia/Baghdad, IR Asia/Tehran, SA Asia/Riyadh, YE Asia/Aden, AE Asia/Dubai, OM Asia/Muscat, QA Asia/Qatar, BH Asia/Bahrain, KW Asia/Kuwait, EG Africa/Cairo, TR Europe/Istanbul, CY Asia/Nicosia; anything else → null.
  - `fmtTime(d: Date | null, zone?: string): string` — `HH:MM` in the zone (default the user's), `'—'` for null.

- [ ] **Step 1: Write failing tests** `tests/weather/moon.test.ts` (header `// Run: node --experimental-strip-types --test tests/weather/moon.test.ts`):
  - `full moon 2026-01-03T10:03Z` → `fraction > 0.98`, `state === 'full'`
  - `new moon 2026-01-18T19:52Z` → `fraction < 0.02`, `state === 'new'`
  - `first quarter 2026-01-26T04:47Z` → `Math.abs(fraction − 0.5) < 0.03`, `state === 'half'`, `waxing === true`
  - `effectiveLight(1, 0, true) === 1`; `effectiveLight(1, 100, true) ≈ 0.1`; `effectiveLight(0.5, 50, true) ≈ 0.275`; `effectiveLight(1, 0, false) === 0`; `effectiveLight(1, null, true) === null`
  - `sunTimes(2026-06-21, 32.08, 34.78)`: `astroDawn < nauticalDawn < civilDawn < sunrise < sunset < civilDusk < nauticalDusk < astroDusk`; `dayLengthMin` between 840 and 860
  - Review Focus 2: find a date in 2026 where `moonTimes(…, 32.08, 34.78)` has `rise === null` or `set === null` (loop days of January 2026) and assert `fmtTime(null) === '—'` and that no field is an invalid Date
  - Review Focus 5: `zoneForCountry('IR') === 'Asia/Tehran'`, `zoneForCountry(null) === null`, `zoneForCountry('FR') === null`
- [ ] **Step 2: Run** `node --experimental-strip-types --test tests/weather/moon.test.ts`. Expected: FAIL (module not found).
- [ ] **Step 3: `npm i suncalc@^1.9.0 && npm i -D @types/suncalc`**, then implement `src/lib/moon.ts` over `SunCalc.getTimes` (dawn = civil, nauticalDawn, nightEnd = astronomical; dusk, nauticalDusk, night), `getMoonIllumination`, `getMoonTimes`, `getMoonPosition`. `waxing` = `phase < 0.5`.
- [ ] **Step 4: Run tests.** Expected: all PASS.
- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json src/lib/moon.ts tests/weather/moon.test.ts
git commit -m "Weather: sun and moon astronomy (suncalc) with moonlight after clouds"
```

---

### Task 3: Server — `api/weather.ts` + normalizer

**Files:**
- Create: `api/_lib/weatherNormalize.ts`
- Create: `api/weather.ts`
- Test: `tests/weather/normalize.test.ts`

**Interfaces:**
- Consumes: `isMember`, `json`, `tileKey`, `tileKeyOk`, `env` from `api/_lib/member.ts`; fixture from Task 0.
- Produces (`api/_lib/weatherNormalize.ts`, imported by the client as types too):
  - `interface Hour { t: string; temp: number|null; cloud: number|null; rain: number|null; windKmh: number|null; windDir: number|null; gustKmh: number|null; humidity: number|null; symbol: string|null }`
  - `interface Day { date: string; tMax: number|null; tMin: number|null; rain: number; windMaxKmh: number|null; symbol: string|null }`
  - `interface PointForecast { updated: string; now: Hour; hours: Hour[]; days: Day[] }`
  - `normalizeMet(raw: unknown, zone: string): PointForecast` — `hours` = first 48 hourly steps from now; `days` = 7 calendar days in `zone`; rain per hour from `next_1_hours`, else `next_6_hours / 6`; day symbol = the step nearest 12:00 local.
  - `roundCoord(v: number): number` — to 0.05.
- Produces (routes): `GET /api/weather?key=1` → `{ k }` (members only, else 401); `GET ?point=lat,lng&k=` → `PointForecast`; `GET ?tile=temp|wind/z/x/y&k=` → PNG.

- [ ] **Step 1: Write failing tests** `tests/weather/normalize.test.ts`:
  - fixture → `hours.length === 48`, `days.length === 7`, every `hours[i].t` one hour after the previous
  - `windKmh === round1(wind_speed × 3.6)` for `hours[0]`
  - each `days[d].tMax >= days[d].tMin`
  - Review Focus 1: a copy of the fixture with `next_1_hours` deleted from every step → no `NaN` anywhere in `hours[].rain` / `days[].rain`, and `hours[0].rain === next_6_hours.details.precipitation_amount / 6`
  - `normalizeMet({}, 'Asia/Jerusalem')` throws `Error('bad MET response')`
  - `roundCoord(33.2733) === 33.25`, `roundCoord(35.2033) === 35.2`
- [ ] **Step 2: Run** `node --experimental-strip-types --test tests/weather/normalize.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement `weatherNormalize.ts`.**
- [ ] **Step 4: Run tests.** Expected: PASS.
- [ ] **Step 5: Implement `api/weather.ts`** (`export async function GET(req: Request)`), in this order: `key=1` → `isMember` → `{ k: tileKey() }`; otherwise `tileKeyOk(k)` or 403; `point` → validate lat/lng (400), round, fetch MET with the Global Constraints User-Agent and a 9 s abort, upstream 429 → 503 with `cache-control: no-store` so the CDN's stale copy is served, other failures → 502 logged; `tile` → layer ∈ {`temp`→`temp_new`, `wind`→`wind_new`}, z 0–12, fetch `https://tile.openweathermap.org/map/{layer}/{z}/{x}/{y}.png?appid=${env('OWM_API_KEY')}`, stream back `image/png`. Missing `OWM_API_KEY` → 503.
- [ ] **Step 6: Verify** `npm run typecheck` exit 0; then `npx vercel dev` (or a preview deploy) and `curl -i "localhost:3000/api/weather?point=33.27,35.2"` → 403; with a key from `?key=1` (signed-in token) → 200 JSON with 48 hours.
- [ ] **Step 7: Commit**

```bash
git add api/weather.ts api/_lib/weatherNormalize.ts tests/weather/normalize.test.ts
git commit -m "Weather: api route (MET point forecast, OWM tile proxy, member key)"
```

---

### Task 4: Client data — `src/lib/weather.ts`

**Files:**
- Create: `src/lib/weather.ts`
- Test: `tests/weather/client.test.ts`

**Interfaces:**
- Consumes: types from `api/_lib/weatherNormalize.ts`; consts from `src/lib/weatherSources.ts`; `supabase` session token (same `authHeader()` approach as `src/lib/intelLayers.ts`).
- Produces:
  - `weatherKey(force?: boolean): Promise<string>` — cached in module memory; `force` refetches.
  - `fetchPoint(lat: number, lng: number, fetcher?: typeof fetch): Promise<PointForecast>` — on 403 calls `weatherKey(true)` once and retries.
  - `owmTileUrl(layer: 'temp' | 'wind', key: string): string` → `/api/weather?tile=${layer}/{z}/{x}/{y}&k=${key}`
  - `interface Frame { time: string; offsetH: number; kind: 'observed' | 'forecast' }`
  - `buildFrames(now: Date, past = 6, future = 72): Frame[]` — `time` = whole UTC hour ISO; offsets −6…−1 `observed`, 0…72 `forecast`.
  - `wmsLayer(kind: 'cloudObserved' | 'cloudForecast' | 'rainForecast', time: string, opacity: number): L.TileLayer.WMS`

- [ ] **Step 1: Write failing tests** `tests/weather/client.test.ts`:
  - `buildFrames(new Date('2026-11-06T09:41:00Z'))` → length 79; first `{ time: '2026-11-06T03:00:00.000Z', offsetH: -6, kind: 'observed' }`; the one with `offsetH: 0` is `forecast` at `09:00Z`; last `offsetH === 72`
  - Review Focus 3: `fetchPoint` with a fake fetcher that answers 403 to the first point call and 200 after a new `?key=1` → resolves; the fake saw exactly two `?key=1` calls (initial + forced) and two point calls
- [ ] **Step 2: Run** `node --experimental-strip-types --test tests/weather/client.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** (keep Leaflet imports out of the functions under test, or import `wmsLayer` from a separate tiny module if `node --test` cannot load Leaflet).
- [ ] **Step 4: Run tests.** Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add src/lib/weather.ts tests/weather/client.test.ts
git commit -m "Weather: client fetchers, frames and layer builders"
```

---

### Task 5: Weather card + right-click item

**Files:**
- Create: `src/components/map/WeatherCard.tsx`
- Create: `src/lib/latestOnly.ts`
- Modify: `src/components/map/MapContextMenu.tsx` (new item + `onWeather?: (lat: number, lng: number) => void` prop)
- Modify: `src/components/map/MapView.tsx` (state `weatherAt: { lat; lng; x; y } | null`; render `<WeatherCard>`; pass `onWeather`)
- Test: `tests/weather/latestOnly.test.ts`

**Interfaces:**
- Consumes: `fetchPoint` (Task 4), all of `moon.ts` (Task 2), RPC `geo_nearest_place` (Task 1), `hasFeature(undefined, 'weather')`, `openGate('signup')`, `useAuth().profile`.
- Produces: `latestOnly<T>(): (p: Promise<T>) => Promise<T | typeof STALE>` and `export const STALE: unique symbol` — only the most recently wrapped promise resolves to its value.
- Produces: `<WeatherCard at={{ lat, lng, x, y }} onClose={() => void} />`.

- [ ] **Step 1: Write failing test** `tests/weather/latestOnly.test.ts` (Review Focus 4): wrap a slow promise (resolves 'A' after 30 ms) then a fast one ('B' after 5 ms) → first resolves to `STALE`, second to `'B'`.
- [ ] **Step 2: Run.** Expected: FAIL. **Step 3: Implement `latestOnly`.** **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Context menu item** "מזג אוויר ושמש/ירח כאן" / "Weather & sun/moon here" (`CloudSun` icon from lucide-react). No profile → `openGate('signup')` and close; otherwise `onWeather(lat, lng)` and close. Long-press already fires Leaflet `contextmenu` on touch — confirm on a mobile viewport.
- [ ] **Step 6: `WeatherCard`** — positioned like the context menu (clamped inside the map container); header = coordinates + `geo_nearest_place` name in the UI language; tabs Now / 48 h / 7 days / Sun & moon exactly as the spec's "UI → Weather card" section; point-local time from `zoneForCountry(country_code)` shown small when it differs from the user's zone; error state "אין נתוני מזג אוויר כרגע" / "No weather data right now" + retry; Sun & moon tab renders even when the forecast failed (light after clouds = "—"); footer credit "MET Norway (CC BY 4.0)" + updated time. Use `latestOnly` for `fetchPoint`.
- [ ] **Step 7: Verify** `npm run check` exit 0; in the dev server as a signed-in user, right-click → card opens, four tabs show data; right-click two points quickly → the card shows the second point.
- [ ] **Step 8: Commit**

```bash
git add src/components/map/WeatherCard.tsx src/lib/latestOnly.ts tests/weather/latestOnly.test.ts src/components/map/MapContextMenu.tsx src/components/map/MapView.tsx
git commit -m "Weather: right-click weather and sun/moon card"
```

---

### Task 6: Weather section + forecast timeline

**Files:**
- Create: `src/components/map/WeatherLayers.tsx`
- Modify: `src/components/map/IntelLayers.tsx` (render `<WeatherLayers map={map} />` as a section; add its legend rows to `mapLegend`)

**Interfaces:**
- Consumes: `buildFrames`, `wmsLayer`, `owmTileUrl`, `weatherKey` (Task 4); `hasFeature(undefined, 'weather')`, `openGate`, `useAuth`.
- Produces: `<WeatherLayers map={L.Map | null} />` — owns its toggles, opacity, timeline bar (portal into the map container, bottom centre) and legend state.

- [ ] **Step 1: Section UI** — four toggles (Clouds, Rain, Temperature, Wind) with the same `sectionHead` look as the other sections; one opacity slider (default 0.7); guests see 🔒 and get `openGate('signup')`; a toggle whose layer fires `tileerror` for its first tiles shows ⚠️ "לא זמין" / "Unavailable".
- [ ] **Step 2: Temperature / wind** — `L.tileLayer(owmTileUrl(...))`, attribution "OpenWeatherMap", "now" only.
- [ ] **Step 3: Timeline** (visible while Clouds or Rain is on) — slider over `buildFrames(new Date())`, ▶️/⏸, label in the user's clock e.g. "ו׳ 18:00 (+9 ש׳)" / "Fri 18:00 (+9 h)", "now" mark. Observed frames show `cloudObserved` only; forecast frames show `cloudForecast` (if Clouds) and `rainForecast` (if Rain). Play at 500 ms per frame; keep at most the current + next 3 frame layers on the map (hidden ones at opacity 0); remove layers that fall out of the window; a frame whose tiles error is marked and skipped by play.
- [ ] **Step 4: Legends** — colour legends for active weather layers in the map legend, with credits (EUMETSAT, Deutscher Wetterdienst, OpenWeatherMap).
- [ ] **Step 5: Verify** `npm run check` exit 0; in the dev server: each toggle shows its layer over the Middle East; ▶️ advances the label and the clouds/rain move; the network panel never shows more than 4 frame layers loading at once; opacity applies to all.
- [ ] **Step 6: Commit**

```bash
git add src/components/map/WeatherLayers.tsx src/components/map/IntelLayers.tsx
git commit -m "Weather: layers section with clouds and rain forecast timeline"
```

---

### Task 7: e2e check, configuration, docs

**Files:**
- Create: `tests/e2e/weather.js`
- Modify: `README.md` (weather section: sources, credits, `OWM_API_KEY`)

- [ ] **Step 1: Write `tests/e2e/weather.js`** in the style of `tests/e2e/guest.js` (a function for Playwright `browser_evaluate`). Signed out: right-click the map (dispatch `contextmenu` on the map container) → click "Weather" item → `data-gate === 'signup'`. Signed in as Free: card opens, four tab buttons exist, the Now tab shows a °C value; turn on Clouds, press ▶️, wait 1.5 s → the timeline label changed.
- [ ] **Step 2: Owner action — ask the owner** to create a free OpenWeatherMap account and add `OWM_API_KEY` to the Vercel project (Production + Preview). Do not proceed to Step 3 until it exists (check with Vercel MCP `filter_project_envs`, never print the value).
- [ ] **Step 3: Preview deploy** and run the e2e script for both states via the Playwright tools. Expected: both object results show the expected values.
- [ ] **Step 4: Full verification** — `npm run check` exit 0; `node --experimental-strip-types --test tests/weather/*.test.ts` all PASS; `supabase/tests/weather_feature.sql` passes.
- [ ] **Step 5: README** — add the weather section.
- [ ] **Step 6: Commit and push**

```bash
git add tests/e2e/weather.js README.md
git commit -m "Weather: e2e check and docs"
git push origin main
```
