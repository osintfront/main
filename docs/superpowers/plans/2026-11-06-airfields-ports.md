# Airfields and Ports Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An "Airfields & ports" section in Intelligence layers with clustered airfields (civil / military / strips & helipads / closed) and ports for the Middle East without Israel, each with a details popup, the nearest town in Hebrew and a "Live traffic nearby" button.

**Architecture:** A Python build (`tools/infra/build_infra.py`, run by a GitHub workflow) turns OurAirports and the NGA World Port Index into two static GeoJSON files in `public/data/`. The browser loads them on first toggle-on (`src/lib/infra.ts`), draws them with `leaflet.markercluster` (`src/components/map/InfraLayers.tsx`), and asks `geo_nearest_place` for the Hebrew town when a popup opens.

**Tech Stack:** Python 3.12 (stdlib csv/json + urllib), React 19, Leaflet 1.9 + leaflet.markercluster, TypeScript 5.8, Supabase, `node --test`.

**Spec:** `docs/superpowers/specs/2026-11-06-airfields-ports-design.md`

## Global Constraints

- Countries: `LB SY JO IQ IR SA YE OM AE QA BH KW EG TR CY PS SD ER DJ SO`. `IL` never.
- Airfield classes, first match wins: `closed` (type closed) → `military` (regex `\b(air ?base|airbase|AB|air force|military|naval air|army|قاعدة)\b`, case-insensitive, on name + keywords, not if the name contains "hospital") → `civil` (large/medium airport, or small airport with ICAO or IATA) → `strip` (everything else).
- Military is always labelled "military (by name)" / "צבאי (לפי השם)".
- Files: `public/data/airfields.geojson`, `public/data/ports.geojson`; coordinates rounded to 5 decimals; closed runways left out.
- Feature properties exactly as the spec's "Data shape".
- Access: `plan_features` key `airfields_ports` — free/pro/max/intel on, guest off; guests see 🔒 and `openGate('signup')`.
- Icon colours: civil `#0284c7`, military `#991b1b`, strip `#64748b`, closed `#9ca3af`, port `#0f766e`.
- Credits: "OurAirports" and "NGA World Port Index".
- Texts Hebrew + English (`TXT = { he, en }` pattern). Code, comments, commits, DB names in English.
- Commits end with the session's Co-Authored-By / Claude-Session lines. Work stays on branch `airfields-ports`.

## Review Focus

1. **Ports file not built yet** (the workflow has not run): the Ports toggle shows ⚠️ "Unavailable" and airfields still work → test in Task 3 (`loadInfra` rejects on 404, and a later call retries).
2. **Missing values** (no runways, no elevation, no codes, no port depths): the popup shows "—", never "undefined" or "NaN" → test in Task 3.
3. **Names with markup characters** (`<`, `&`, quotes) from the data: escaped in the popup HTML → test in Task 3.
4. **Toggling a layer on and off repeatedly**: each file is fetched once per page load → test in Task 3 (`loadInfra` caches).
5. **"Live traffic nearby" when that layer is already on**: it stays on and only the view moves → manual check in Task 4, line in `tests/e2e/infra.js`.

---

### Task 1: Data build + workflow

**Files:**
- Create: `tools/infra/build_infra.py`, `tools/infra/test_build.py`
- Create: `.github/workflows/infra-data.yml`
- Create: `public/data/airfields.geojson` (generated locally from OurAirports — the workspace can reach GitHub)

**Interfaces:**
- Produces (Python, pure): `COUNTRIES: frozenset[str]`; `classify(row: dict) -> str | None` (None = drop); `runways_for(rows: list[dict]) -> dict[str, list[dict]]` keyed by `airport_ident`; `airfield_feature(row: dict, runways: list[dict]) -> dict`; `port_columns(headers: list[str]) -> dict[str, str]` (logical name → real header; raises `ValueError` listing headers when one of name/country/lat/lng is missing); `port_feature(row: dict, cols: dict[str, str]) -> dict | None`; `feature_collection(features: list[dict]) -> dict`.
- Produces (files): `public/data/airfields.geojson`, `public/data/ports.geojson`.

- [ ] **Step 1: Failing tests** `tools/infra/test_build.py` (unittest):
  - `classify({'type':'large_airport','name':'Al Udeid Air Base','keywords':'','iso_country':'QA','icao_code':'OTBH'}) == 'military'`
  - `classify({... 'type':'heliport','name':'Zayed Military Hospital Heliport', 'iso_country':'AE'}) == 'strip'`
  - `classify({... 'type':'closed','name':'Old Air Base','iso_country':'SY'}) == 'closed'`
  - small airport with `icao_code` 'OLKA' → `'civil'`; small airport without codes → `'strip'`
  - `iso_country 'IL'` → `None`; `'PS'` → not None; `'FR'` → `None`
  - `runways_for` skips rows with `closed == '1'`; lengths are ints, surface kept as text
  - `airfield_feature` → `geometry.coordinates == [35.48845, 33.82089]` for lon 35.488449, lat 33.820889 (5 decimals, lon first); properties keys ⊆ `{k,n,t,icao,iata,cc,el,rw}`, empty codes omitted
  - `port_columns(['Main Port Name','Country Code','Latitude','Longitude','Harbor Size','Channel Depth (m)'])` maps name/country/lat/lng/size/ch; the same with `['portName','countryName','ycoord','xcoord','harborSize','chDepth']`
  - `port_columns(['foo','bar'])` raises `ValueError` whose message contains `foo`
  - `port_feature` with country "Lebanon" → `cc 'LB'`; with "Israel" → `None`
- [ ] **Step 2: Run** `python3 -m unittest tools/infra/test_build.py -v`. Expected: FAIL (import error).
- [ ] **Step 3: Implement** pure functions + `main()`: download the two OurAirports CSVs and the WPI CSV (`urllib.request`, User-Agent `osintfront.com data build (+https://osintfront.com)`), write both files (sorted keys, no spaces). If the ports step fails, keep the existing `ports.geojson` and exit 1 after writing airfields. Country names → ISO2 via a dict covering the 20 countries plus "Israel" → `IL`. Harbour size codes `L/M/S/V`.
- [ ] **Step 4: Run tests.** Expected: PASS.
- [ ] **Step 5: Generate airfields locally** — `python3 tools/infra/build_infra.py --airfields-only` → file with ~2,000 features; check `IL` count is 0 and class counts look like the spec.
- [ ] **Step 6: Workflow** `.github/workflows/infra-data.yml` — `workflow_dispatch` + `schedule: '17 3 2 * *'`; Python 3.12; run tests then the build; commit `public/data/*.geojson` if changed; `permissions: contents: write`.
- [ ] **Step 7: Commit**

```bash
git add tools/infra .github/workflows/infra-data.yml public/data/airfields.geojson
git commit -m "Infra: airfields and ports data build (OurAirports, NGA WPI)"
```

---

### Task 2: Plan feature

**Files:** Create `supabase/migrations/20261106000095_airfields_ports_feature.sql`, `supabase/tests/airfields_ports_feature.sql`; Modify `src/lib/plans.ts` (`FeatureKey` + `'airfields_ports'`).

- [ ] **Step 1: Failing SQL test** — guest row disabled; free/pro/max/intel enabled with null limit (count = 4).
- [ ] **Step 2: Run** via Supabase MCP `execute_sql` in `begin; … rollback;`. Expected: FAIL.
- [ ] **Step 3: Migration** (insert … on conflict do update, note `'airfields and ports layer'`), apply with `apply_migration` (`airfields_ports_feature`); add the FeatureKey.
- [ ] **Step 4: Run the test** → passes; `npx tsc --noEmit -p tsconfig.json` → only the 2 known errors.
- [ ] **Step 5: Commit** `"Infra: plan feature for airfields and ports"`.

---

### Task 3: Client data + popups — `src/lib/infra.ts`

**Files:** Create `src/lib/infra.ts`; Test `tests/infra/popup.test.ts`.

**Interfaces:**
- Produces:
  - `type AirfieldClass = 'civil' | 'military' | 'strip' | 'closed'`
  - `interface AirfieldProps { k: AirfieldClass; n: string; t: string; icao?: string; iata?: string; cc: string; el?: number; rw?: { l: number; s: string; lit: boolean }[] }`
  - `interface PortProps { n: string; cc: string; sz?: 'L' | 'M' | 'S' | 'V'; ty?: string; ch?: number; an?: number; cp?: number }`
  - `loadInfra(kind: 'airfields' | 'ports', fetcher?: typeof fetch): Promise<GeoJSON.FeatureCollection>` — `/data/${kind}.geojson`, cached per kind; a failed load is not cached.
  - `INFRA_TXT: { he: Record<string,string>; en: Record<string,string> }`
  - `airfieldPopup(p: AirfieldProps, lang: 'he' | 'en', near: string | null): string` and `portPopup(p: PortProps, lang: 'he' | 'en', near: string | null): string` — HTML strings; every data value escaped; missing values "—"; lengths `"<m> m (<ft> ft)"` with m = round(ft × 0.3048); elevation `"<ft> ft (<m> m)"`; a `<button data-infra-traffic>` with the live-traffic label; credit line.

- [ ] **Step 1: Failing tests** `tests/infra/popup.test.ts`:
  - airfield with `rw: [{ l: 10000, s: 'ASP', lit: true }]` → contains `3048 m (10000 ft)`; `el: 87` → `87 ft (27 m)`
  - military airfield → contains `military (by name)` (en) and `צבאי (לפי השם)` (he)
  - Review Focus 2: airfield with no `rw`, `el`, `icao`, `iata` → contains `—` and not `undefined` / `NaN`
  - Review Focus 3: name `A<b>&"x"` → contains `A&lt;b&gt;&amp;&quot;x&quot;` and no `<b>`
  - port `{ sz: 'L', ch: 12.5 }` → contains `Large` and `12.5 m`; `near: 'Beirut'` → contains `near Beirut` (en) / `ליד Beirut` (he)
  - Review Focus 4: two `loadInfra('airfields', fake)` calls → fake called once
  - Review Focus 1: fake answering 404 → `loadInfra('ports', fake)` rejects; a second call fetches again
- [ ] **Step 2: Run** `node --experimental-strip-types --test tests/infra/popup.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** (no Leaflet / Supabase imports in this file).
- [ ] **Step 4: Run tests.** Expected: PASS.
- [ ] **Step 5: Commit** `"Infra: data loader and popups"`.

---

### Task 4: Map section — `src/components/map/InfraLayers.tsx`

**Files:** Create `src/components/map/InfraLayers.tsx`; Modify `src/components/map/IntelLayers.tsx`.

**Interfaces:**
- Consumes: Task 3 exports; `supabase.rpc('geo_nearest_place', { p_lat, p_lng })`; `hasFeature(undefined, 'airfields_ports')`, `openGate`, `useAuth`.
- Produces: `useInfraLayers(map: L.Map | null, lang: string, dir: 'ltr' | 'rtl', live: { aircraft: () => void; ships: () => void })`, `<InfraLayersPanel s>`, `<InfraLegend s>` (areaLayers / weather pattern).

- [ ] **Step 1: Section** after `<WeatherLayersPanel>`: five toggles (`data-infra-toggle="civil|military|strip|closed|ports"`), 🔒 and sign-up gate for guests, upgrade gate when the plan lacks the feature, ⚠️ "Unavailable" when a load fails.
- [ ] **Step 2: Layers** — one `L.markerClusterGroup` for airfields (filtered by the four class toggles) and one for ports; `L.divIcon` per class with the Global Constraints colours; markers built once per file, re-filtered on toggle.
- [ ] **Step 3: Popup** — on `popupopen`, set content to `airfieldPopup` / `portPopup` with `near = null`, then call `geo_nearest_place` and re-render with the town (Hebrew name in Hebrew, English otherwise); wire `[data-infra-traffic]` to `live.aircraft()` / `live.ships()` then `map.setView(latlng, 10)`.
- [ ] **Step 4: IntelLayers** — pass `live = { aircraft: () => setPlanesOn(true), ships: () => setShipsOn(true) }`; render `<InfraLegend>` next to the other legends.
- [ ] **Step 5: Verify** `npx vite build` OK and tsc has only the 2 known errors; preview as guest: toggles show 🔒 and open the sign-up gate.
- [ ] **Step 6: Commit** `"Infra: airfields and ports section in intelligence layers"`.

---

### Task 5: e2e, docs, verification

**Files:** Create `tests/e2e/infra.js`; Modify `README.md`.

- [ ] **Step 1: `tests/e2e/infra.js`** (style of `tests/e2e/weather.js`): guest → open panel → click `[data-infra-toggle="civil"]` → `data-gate === 'signup'`. Signed in: civil on → `.leaflet-marker-icon` count rises; click one cluster-free marker → popup has `data-infra-traffic`; with Aircraft already on, clicking it keeps Aircraft on.
- [ ] **Step 2: README** — short "Airfields & ports" section (sources, workflow, refresh).
- [ ] **Step 3: Full verification** — `python3 -m unittest tools/infra/test_build.py`, `node --experimental-strip-types --test tests/infra/*.test.ts tests/weather/*.test.ts`, SQL test, tsc (2 known), `npx vite build`; preview e2e as guest.
- [ ] **Step 4: Commit and push** the branch `airfields-ports`.
