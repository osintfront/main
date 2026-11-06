# Military Bases Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A "Military bases" group inside "Airfields & ports" showing bases, naval bases, ranges & zones, and bunkers & checkpoints for the Middle East without Israel, with foreign-operated bases marked.

**Architecture:** A Python build (`tools/military/build_military.py`, run monthly by a GitHub workflow) turns OpenStreetMap (Overpass, one query per country) plus Wikidata (operators) into two static GeoJSON files in `public/data/`. The browser loads them on first toggle-on (`src/lib/military.ts`), draws square clustered markers (`src/components/map/MilitaryLayers.tsx`), and asks `geo_nearest_place` for the town when a popup opens.

**Tech Stack:** Python 3.12 stdlib (json, urllib), React 19, Leaflet 1.9 + leaflet.markercluster, TypeScript 5.8, Supabase, `node --test`, `python3 -m unittest`.

**Spec:** `docs/superpowers/specs/2026-11-06-military-bases-design.md`

## Global Constraints

- Countries: `LB SY JO IQ IR SA YE OM AE QA BH KW EG TR CY PS SD ER DJ SO`. `IL` is never queried.
- Kinds: `base`, `naval`, `range`, `minor`; classification order exactly as the spec's "Classification" list.
- Israel exclusion: operator maps to `IL`; or `name` contains a Hebrew-script character (U+0590–U+05FF); or `military=checkpoint` in `PS`. `name:he` never triggers it.
- Foreign = operator country known and ≠ site country. Wikidata operator wins over OSM `operator` text.
- Wikidata match: OSM `wikidata` tag = QID, else nearest `base`/`naval` site within 3 km.
- Files: `public/data/military.geojson` (base, naval, range), `public/data/military-minor.geojson` (minor). Points, coordinates rounded to 5 decimals. Properties exactly `k, n?, en?, he?, cc, op?, opn?, f?, air?, km2?, osm?, wd?`.
- Size guard 8 MB on `military.geojson` (drop unnamed `range` < 0.05 km², then fail if still over). Floor: 1,000 sites in `military.geojson`; TR, IR, EG, SA each > 0.
- UA: `osintfront.com data build (+https://osintfront.com)`. Overpass `https://overpass-api.de/api/interpreter`, Wikidata `https://query.wikidata.org/sparql`.
- Access: plan key `airfields_ports` (no new key, no migration). Guests see 🔒 and `openGate('signup')`.
- Markers square (border-radius 3 px): base `#4d7c0f` ★, naval `#1e3a8a` ⚓, range `#b45309` ◎, minor `#475569` 10 px dot. Foreign: 2 px `#eab308` ring + flag emoji. Minor drawn only at zoom ≥ 11.
- Credit: "© OpenStreetMap contributors" (+ "Wikidata" when `wd` is set).
- Texts Hebrew + English (`{ he, en }` pattern); code, comments, commits in English.
- Commits end with the session's Co-Authored-By / Claude-Session lines. Work on branch `military-bases`. No `package-lock.json`.

## Review Focus

1. **Overpass answers 200 with a timeout remark and partial data**: must count as a failed country, not a short country → test in Task 1 (`parse_overpass` raises on a `remark` containing "error" or "timed out").
2. **The same base mapped twice** (a named node inside the named area of the same base): one marker, the larger one kept → test in Task 1 (`dedupe`).
3. **Files not built yet** (workflow not run): toggles show ⚠️ "Not built yet", airfields keep working → test in Task 4 (`isNotBuilt`).
4. **A site with no name in any language and no operator**: popup says "Unnamed site", no "Operated by" row, no "undefined" → test in Task 4.
5. **Wikidata item with no label** (label service returns the bare QID): treated as no name → test in Task 2.

---

### Task 1: OSM parsing and classification

**Files:**
- Create: `tools/military/build_military.py`, `tools/military/test_build.py`, `tools/military/fixtures/overpass_qa.json`

**Interfaces:**
- Produces (in `build_military.py`):
  - `COUNTRIES: frozenset[str]` (the 20 codes), `UA`, `OUT` (→ `public/data`), `MIN_SITES = 1000`, `MAX_BYTES = 8_000_000`
  - `overpass_query(cc: str) -> str` — `[out:json][timeout:300]; area["ISO3166-1"="<cc>"][admin_level=2]->.a; (nwr["military"](area.a); nwr["landuse"="military"](area.a);); out bb qt;`
  - `classify(tags: dict[str, str]) -> str | None` — `'base' | 'naval' | 'range' | 'minor' | None` (None = skipped)
  - `operator_cc(text: str | None) -> str | None` — keyword map from the spec
  - `israeli(tags: dict, cc: str, op_cc: str | None, kind: str) -> bool`
  - `area_km2(b: dict) -> float | None` — from `{minlat, minlon, maxlat, maxlon}`, 2 significant figures
  - `parse_overpass(data: dict, cc: str) -> list[dict]` — sites `{k, lat, lng, cc, tags, osm, km2}`; raises `ValueError` on missing `elements` or an error/timeout `remark`; drops skipped and Israeli sites
  - `dedupe(sites: list[dict]) -> list[dict]`

- [ ] **Step 1: Fixture.** `fixtures/overpass_qa.json` in the real Overpass shape (`{"version":0.6,"elements":[…]}`): a node `military=bunker`; a way `military=base` name "Al Sailiya Camp" with `bounds`; a way `military=naval_base`; a way `landuse=military` without name; a way `military=airfield`; a relation `military=training_area` with `bounds`.
- [ ] **Step 2: Write failing tests** in `test_build.py` (classes `Classify`, `Israel`, `Operator`, `Parse`, `Dedupe`):
  - `classify({'military':'barracks'}) == 'base'`; `{'military':'naval_base'} → 'naval'`; `{'landuse':'military','name':'Coast Guard Station'} → 'naval'`; same with names `'قاعدة بحرية'`, `'Deniz Kuvvetleri Üssü'`, `'نیروی دریایی'` → `'naval'`; `{'military':'range'} → 'range'`; `{'landuse':'military'} → 'range'`; `{'landuse':'military','name':'X'} → 'base'`; `{'military':'checkpoint'} → 'minor'`; `{'military':'airfield'}`, `{'military':'base','aeroway':'aerodrome'}`, `{'military':'base','disused':'yes'}`, `{'military':'trench'} → None`; `{'military':'storage'} → 'base'`.
  - `operator_cc('United States Air Force') == 'US'`; `'Royal Navy' → 'GB'`; `'IRGC' → 'IR'`; `'צה"ל' → 'IL'`; `'IDF' → 'IL'`; `None → None`; `'Municipality' → None`.
  - `israeli({'military':'base','operator':'IDF'}, 'PS', 'IL', 'base')` is True; `{'name':'בסיס'}` in PS → True; `{'military':'checkpoint'}` kind minor in PS → True, in SY → False; `{'name':'Camp X','name:he':'מחנה'}` in JO, no operator → False.
  - `parse_overpass(fixture, 'QA')`: 5 sites (airfield dropped); the way's lat/lng is the bounds midpoint, rounded to 5 decimals; `osm == 'w<id>'`, node `'n<id>'`, relation `'r<id>'`; `km2` set for ways with bounds, absent for nodes; every site `cc == 'QA'`.
  - `parse_overpass({'elements': [], 'remark': 'runtime error: Query timed out in "query" at line 1'}, 'IR')` raises `ValueError`; `parse_overpass({}, 'IR')` raises `ValueError`.
  - `dedupe`: a named node "Camp X" at 25.0,51.0 and a named way "Camp X" (km2 4.0) at 25.005,51.0 → one site, the way; two different names 200 m apart → both kept; two unnamed ranges 200 m apart → both kept.
- [ ] **Step 3: Run** `python3 -m unittest tools/military/test_build.py -v` → FAIL (`ModuleNotFoundError: build_military`).
- [ ] **Step 4: Implement** the Interfaces above. Naval name regex (case-insensitive): `naval|navy|coast ?guard|بحري|خفر السواحل|deniz|donanma|sahil güvenlik|دریایی`. Distance by haversine; `dedupe` merges sites of the same kind with the same non-empty `name` within 1 km, keeping the one with the larger `km2` (a site without `km2` counts as 0).
- [ ] **Step 5: Run** the tests → all PASS.
- [ ] **Step 6: Commit** `tools/military/` — "Military bases: OSM parsing and classification".

### Task 2: Wikidata operators and merge

**Files:**
- Modify: `tools/military/build_military.py`, `tools/military/test_build.py`
- Create: `tools/military/fixtures/wikidata.json`

**Interfaces:**
- Consumes: sites from `parse_overpass` / `dedupe` (Task 1).
- Produces:
  - `WIKIDATA_QUERY: str` — SPARQL for items that are instance of (P31/P279*) the military-installation class, in the 20 countries, with `?coord` (P625), `?cc` (P297 of P17), optional `?opcc` (P297 of the operator's P17, or of the operator when it has P297 itself), `?opLabel`, `?itemLabel` (en), `?he` (Hebrew label), `?naval` and `?air` booleans (instance of naval base / air base).
  - `parse_wikidata(data: dict) -> list[dict]` — items `{qid, lat, lng, cc, en, he, op_cc, op_name, naval, air}`; raises `ValueError` on a missing `results.bindings`
  - `merge(sites: list[dict], items: list[dict]) -> list[dict]` — sites with `wd`, `op`, `opn`, `f`, `air` filled; unmatched items appended as sites
  - `site_feature(s: dict) -> dict` — GeoJSON Point with the spec's properties only, empty values left out

- [ ] **Step 1: Confirm the class QIDs.** Look up on wikidata.org (WebSearch/WebFetch): "military installation", "military base", "naval base", "air base". Write them as constants (`Q_INSTALLATION`, `Q_NAVAL`, `Q_AIR`) with the label in a comment, and record them in the ledger.
- [ ] **Step 2: Fixture.** `fixtures/wikidata.json` in the SPARQL JSON shape (`{"head":…,"results":{"bindings":[…]}}`, `coord` as `"Point(<lng> <lat>)"`): Al Udeid (QA, air, op US), Hmeimim (SY, air, op RU), Camp Lemonnier (DJ, naval, op US), a host-country base (EG, op EG), an air base with host operator (SA, op SA), an item whose `itemLabel` is its own QID, and an item with an OSM `wikidata` match in the Task 1 fixture.
- [ ] **Step 3: Write failing tests** (class `Wikidata`):
  - `parse_wikidata` reads lat/lng from `Point(lng lat)`; an item whose label equals its QID gets `en is None`.
  - `merge`: the item whose QID is in an OSM `wikidata` tag fills that site (`wd`, `op`, `f`) even when 5 km away; an item 2.9 km from an OSM base fills it; at 3.1 km it is appended as its own site; Camp Lemonnier appended as `k == 'naval'`, `f is True`, `op == 'US'`; the EG host base gets `op == 'EG'` and no `f`; Al Udeid and Hmeimim appended with `air is True`, `f is True`; the SA host air base is not added; an OSM site with `operator='United States Navy'` and no Wikidata match gets `op == 'US'`, `f is True`; a Wikidata operator wins over OSM text.
  - A merged item with `op_cc == 'IL'` in PS is dropped.
  - `site_feature` of a site without name/operator has exactly the keys `k, cc, osm` in `properties`.
- [ ] **Step 4: Run** the tests → the new ones FAIL.
- [ ] **Step 5: Implement** the Interfaces. Names on features: `n` = OSM `name` (or Wikidata `en` for appended items), `en` = `name:en` (or Wikidata `en`), `he` = `name:he` (or Wikidata `he`); `opn` = Wikidata `op_name` or the OSM `operator` text.
- [ ] **Step 6: Run** all tests → PASS.
- [ ] **Step 7: Commit** — "Military bases: Wikidata operators and foreign bases".

### Task 3: Build, quality gate and monthly workflow

**Files:**
- Modify: `tools/military/build_military.py`, `tools/military/test_build.py`
- Create: `.github/workflows/military-data.yml`

**Interfaces:**
- Consumes: Tasks 1–2.
- Produces:
  - `size_guard(features: list[dict], limit: int = MAX_BYTES) -> list[dict]` — raises `ValueError` if still over after dropping unnamed `range` features with `km2 < 0.05` (or no `km2`)
  - `check(main: list[dict], failed: list[str]) -> None` — raises `ValueError` naming the reason
  - `main(argv: list[str]) -> int` — `0` both files written · `3` nothing written; prints per-country and per-kind counts and file sizes

- [ ] **Step 1: Write failing tests** (class `Gate`):
  - `size_guard` with `limit` set just above the size of the named features keeps every named feature and drops only the small unnamed range; with `limit=10` it raises.
  - `check(features_with_TR_IR_EG_SA_and_1000_items, [])` passes; with `['IR']` failed → raises mentioning `IR`; with 999 features → raises; with no `SA` feature → raises mentioning `SA`.
  - `main(['--dry'])` with `_fetch` patched to return the Task 1 fixture for every country and the Task 2 fixture for Wikidata returns `3` (floor not reached) and writes nothing to `OUT` (patch `OUT` to a temp dir).
  - `main([])` with `_fetch` raising for Wikidata returns `3` and writes nothing.
  - `main([])` with the same fixtures and `MIN_SITES` patched to 1 (and the TR/IR/EG/SA check satisfied by the fixture's `cc` being rewritten per country) returns `0` and writes both files; `military-minor.geojson` holds only `k == 'minor'`.
  - `main([])` with `_fetch` raising for one country (after retries, `time.sleep` patched out) returns `3` and writes nothing.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.** `_fetch(url: str, data: bytes | None = None) -> dict` POSTs the Overpass query as `data=<query>` (form-encoded) and GETs Wikidata with `?format=json&query=…`, both with `UA` and a 360 s timeout; each Overpass country is retried twice (sleep 30 s, then 60 s) and the loop sleeps 5 s between countries. Write both files only after `check` and `size_guard` pass, sorted by `(cc, k, n)`, compact JSON, `ensure_ascii=False`.
- [ ] **Step 4: Run** all tests → PASS.
- [ ] **Step 5: Workflow** `.github/workflows/military-data.yml`, modelled on `infra-data.yml`: name "Military bases data", `cron: '29 3 2 * *'` + `workflow_dispatch`, `permissions: contents: write`, `timeout-minutes: 60`, steps checkout → setup-python 3.12 → `python -m unittest tools/military/test_build.py -v` → `python tools/military/build_military.py` → commit `public/data/military.geojson public/data/military-minor.geojson` as "military-data bot" with message "Data: military bases (OpenStreetMap, Wikidata)" only if changed, then push.
- [ ] **Step 6: Commit** — "Military bases: build gate and monthly workflow".

### Task 4: Browser data module

**Files:**
- Create: `src/lib/military.ts`, `tests/military/popup.test.ts`
- Modify: `src/lib/infra.ts` (loader accepts the two new files; `isNotBuilt`)

**Interfaces:**
- Consumes: `loadInfra`, `INFRA_TXT` patterns from `src/lib/infra.ts`.
- Produces:
  - in `infra.ts`: `export type InfraFile = 'airfields' | 'ports' | 'military' | 'military-minor'`; `loadInfra(kind: InfraFile, fetcher?)` (unchanged behaviour); `export function isNotBuilt(e: unknown): boolean` (true for the `HTTP 404` error)
  - in `military.ts`: `export type MilKind = 'base' | 'naval' | 'range' | 'minor'`; `export interface MilProps { k: MilKind; n?: string; en?: string; he?: string; cc: string; op?: string; opn?: string; f?: true; air?: true; km2?: number; osm?: string; wd?: string }`; `export const MIL_TXT = { he, en }` (group title, the four toggle labels, kind labels, "Foreign-operated only", "Foreign-operated", "zoom in to see", "Not built yet", "Unnamed site", "Operated by", "Size", "Coordinates", "Country"); `export function flag(cc?: string): string` (regional-indicator emoji, `''` for missing/invalid); `export function milName(p: MilProps, lang: 'he' | 'en'): string | null`; `export function militaryPopup(p: MilProps, lang: 'he' | 'en', near: string | null, lat: number, lng: number): string`

- [ ] **Step 1: Write failing tests** in `tests/military/popup.test.ts`:
  - `flag('US') === '🇺🇸'`, `flag(undefined) === ''`, `flag('u') === ''`.
  - `milName({k:'base',cc:'JO',n:'معسكر',en:'Camp X',he:'מחנה X'},'he') === 'מחנה X'`; same in `'en'` → `'Camp X'`; without `en` in `'en'` → `'معسكر'`; with no names → `null`.
  - English popup of a foreign base (`op:'US', opn:'United States Navy', f:true`) contains "Operated by", "United States Navy", "🇺🇸", the highlight colour `#eab308`, "© OpenStreetMap contributors", and an `https://www.openstreetmap.org/way/123` link for `osm:'w123'`; with `wd:'Q1'` also "Wikidata" and `https://www.wikidata.org/wiki/Q1`.
  - A host-operated base shows "Operated by" without `#eab308`.
  - A site `{k:'range', cc:'SY'}` → contains "Unnamed site", does not contain "Operated by", "undefined" or "NaN"; size row shows "—".
  - Hebrew popup has `dir="rtl"` and the Hebrew kind label.
  - A name `'<b>&"x'` is escaped (`&lt;b&gt;&amp;&quot;x`).
  - Coordinates row shows `25.11720, 51.31500` for those inputs.
  - `isNotBuilt(new Error('HTTP 404')) === true`, `isNotBuilt(new Error('HTTP 500')) === false`.
- [ ] **Step 2: Run** `node --experimental-strip-types --test tests/military/popup.test.ts` → FAIL.
- [ ] **Step 3: Implement.** Reuse the escaping, `row` and country-name helpers by exporting them from `infra.ts` (`esc`, `infoRow`, `countryName`); size row as `≈ <km2> km²`; no live-traffic button.
- [ ] **Step 4: Run** this test and `tests/infra/popup.test.ts` → all PASS.
- [ ] **Step 5: Commit** — "Military bases: popup, names, flags".

### Task 5: Map layer, panel and legend

**Files:**
- Create: `src/components/map/MilitaryLayers.tsx`, `tests/e2e/military.js`
- Modify: `src/components/map/InfraLayers.tsx` (`InfraLayersPanel` and `InfraLegend` take optional `children`), `src/components/map/IntelLayers.tsx` (wire it), `README.md` (one section)

**Interfaces:**
- Consumes: Task 4 exports; `clusterIconHtml`, `openGate`, `hasFeature(undefined, 'airfields_ports')`, `useAuth`, `supabase.rpc('geo_nearest_place', { p_lat, p_lng })` (row fields `name, name_he, name_en`).
- Produces: `useMilitaryLayers(map: L.Map | null, lang: string, dir: 'ltr' | 'rtl')` → `{ T, dir, on: Record<MilKind, boolean>, foreignOnly: boolean, setForeignOnly(v: boolean), toggle(k: MilKind, v: boolean), status: { main?: 'unavailable' | 'notBuilt'; minor?: 'unavailable' | 'notBuilt' }, zoomOk: boolean, guest: boolean, any: boolean, anyForeign: boolean }`; `MilitaryLayersGroup({ s })`; `MilitaryLegendItems({ s })` (the kinds that are on, plus "Foreign-operated" with the gold ring when `anyForeign`). `InfraLegend` becomes `InfraLegend({ s, extra, children })`: it renders when `s.any || extra`, with `children` after its own items.

- [ ] **Step 1: Implement `MilitaryLayers.tsx`.** Same structure as `useInfraLayers`: gate in `toggle` (guest → `openGate('signup')`, no feature → `openGate('upgrade')`); load `military` when any of base/naval/range is on and `military-minor` when minor is on; one cluster group per kind (`disableClusteringAtZoom: 11`); square `L.divIcon` with class `ofm-mil` (and `ofm-mil-foreign` when `f`); filter by `foreignOnly`; the minor group is on the map only while `on.minor && map.getZoom() >= 11` (listen to `zoomend`). Popup via `militaryPopup`, then the town from `geo_nearest_place` like `InfraLayers`. Panel rows carry `data-mil-toggle="<kind>"`, the filter `data-mil-foreign`, the hint `data-mil-zoom-hint`; status shows ⚠️ "Not built yet" / "Unavailable".
- [ ] **Step 2: Wire it.** `InfraLayersPanel({ s, children })` renders `children` at the end of its list; `InfraLegend({ s, extra, children })` as in Interfaces. In `IntelLayers.tsx`: `const mil = useMilitaryLayers(map, lang, dir)`, `<InfraLayersPanel s={infra}><MilitaryLayersGroup s={mil} /></InfraLayersPanel>`, `<InfraLegend s={infra} extra={mil.any}><MilitaryLegendItems s={mil} /></InfraLegend>`.
- [ ] **Step 3: e2e script** `tests/e2e/military.js` (same style as `tests/e2e/infra.js`): open Intelligence layers, click `[data-mil-toggle="base"]`; signed out → returns `{ gate: 'signup' }`; signed in → `checked: true`, a status or markers; click `[data-mil-toggle="minor"]` at zoom < 11 → `[data-mil-zoom-hint]` present and no `.ofm-mil` from minor.
- [ ] **Step 4: Verify.** `npx tsc --noEmit -p .` → only the 2 known errors (`AccessDenied.tsx`, `eventAdminService.ts`); `npx vite build` → OK; run every `tests/**/*.test.ts` and the three Python suites → PASS. Run the e2e script in the browser on the dev server (signed out) → `gate: 'signup'`; with the files missing, the signed-in check shows "Not built yet" (can only be run by the owner when signed in).
- [ ] **Step 5: README** — a "Military bases" paragraph under "Airfields & ports": sources, licence credit, the monthly workflow, how to run it by hand.
- [ ] **Step 6: Commit** — "Military bases: map layer, panel and legend".

### Task 6: Final review and ship

- [ ] **Step 1:** Whole-branch review by a fresh reviewer (diff excluding `public/data/`); fix confirmed findings with a test each.
- [ ] **Step 2:** Merge `military-bases` into `main` (fast-forward), push → Vercel production deploy; check `/data/military.geojson` returns 404 and the site has no new runtime errors.
- [ ] **Step 3:** Owner: run "Military bases data" once from Actions. Then record the per-country and per-kind counts and file sizes in the ledger, raise `MIN_SITES` to ~70 % of the real total, and spot-check Al Udeid (US), Hmeimim (RU), Camp Lemonnier (US) and a Turkish base in northern Iraq.
