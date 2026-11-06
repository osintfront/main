# Ships Upgrade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wider AIS coverage, a six-chokepoint panel (crossings, % of our normal, waiting, last crossing), silent ships and sanctioned vessels in the Ships section — open to everyone.

**Architecture:** Crossings are detected in Postgres inside `ais_upsert` (old vs new position against gate lines in `ais_gates`) and summarised by one RPC, `chokepoint_stats()`. Sanctions come from a weekly GitHub workflow that writes a static JSON file. The client adds a panel and two marker styles to the existing ship layer.

**Tech Stack:** Postgres/PL/pgSQL (Supabase), Deno edge function (`ais-collector`), Python 3.12 stdlib, React 19 + Leaflet, `node --test`.

**Spec:** `docs/superpowers/specs/2026-11-06-ships-upgrade-design.md`

## Global Constraints

- Open to everyone: anon may select `ais_crossings`, `ais_gates` and execute `chokepoint_stats()`.
- Gates (lat, lng) exactly as the spec; Suez north + south form one chokepoint `suez`.
- A crossing = movement segment intersects the gate line, with the previous position ≤ 6 h old; at most one row per (mmsi, gate) per 30 minutes; `dir = +1` when moving from the gate's negative side to its positive side (side = sign of cross product of (b − a) and (p − a)).
- `% of normal` = crossings last 24 h ÷ average daily crossings over the previous 28 days (days with data only); fewer than 7 days of data → null + days collected.
- Status chips: Normal ≥ 70% · Below normal 30–70% · Low < 30% · Collecting.
- Retention: `ais_vessels` 72 h after last contact; `ais_crossings` 60 days (both in the existing hourly branch of `ais_upsert`).
- Silent = `updated_at` between 24 h and 72 h ago.
- Labels: "AIS silent 24 h+ (may be out of receiver range)"; footer "Commercial ships seen by AIS shore receivers; a ship with AIS off is not counted."
- Sanctions file `public/data/sanctioned-vessels.json` = `{ updated, vessels: { "<IMO>": { n, l: [...] } } }`; matching by IMO only; IMO must pass the check digit.
- `ais-collector` changes are committed but **not deployed** before the owner merges (production feed).
- Texts Hebrew + English; code/DB names English; commits with the session trailer lines; branch `ships-upgrade`.

## Review Focus

1. **A ship reappearing after hours away** (stale previous position): no false crossing → SQL test in Task 1 (previous position 8 h old across Hormuz → no row).
2. **A ship hovering on a gate line** (anchored on the line, GPS jitter): counted once per 30 minutes → SQL test in Task 1.
3. **A gate with no history yet**: shows "Collecting baseline (n days)", never "0% of normal" or a division error → SQL + node tests in Tasks 1 and 3.
4. **A ship without IMO, or an IMO with a wrong check digit in AIS data**: never marked sanctioned → node test in Task 3.
5. **The sanctions file not built yet or failing to load**: the panel shows "—" for sanctioned and the map works → node test in Task 3.

---

### Task 0: Sanctions build + workflow

**Files:** Create `tools/sanctions/build_sanctions.py`, `tools/sanctions/test_build.py`, `.github/workflows/sanctions-data.yml`, `public/data/sanctioned-vessels.json` (initial `{"updated":null,"vessels":{}}`).

**Interfaces:**
- Produces (pure): `imo_valid(imo: str) -> bool` (7 digits, weighted check digit 7..2); `imos_in(text: str) -> list[str]` (valid IMOs after "IMO", any spacing / punctuation); `vessels_from_rows(rows: list[list[str]] | list[dict], source: str) -> dict[str, dict]` (IMO → `{n, l}`, name = first non-empty name-like field); `merge(*parts: dict) -> dict` (union of lists, sorted).
- Sources: OFAC `https://sanctionslistservice.ofac.treas.gov/api/PublicationPreview/exports/SDN.CSV` (no header; name col 1, remarks last col); UK `https://sanctionslist.fcdo.gov.uk/docs/UK-Sanctions-List.csv` (header row; scan every field). A source yielding 0 vessels fails the build with its first headers/row printed; the previous file stays.

- [ ] **Step 1: Failing tests:** `imo_valid('9074729')` true, `'9074728'` false, `'123'` false; `imos_in('Vessel Registration Identification IMO 9074729; MMSI 123')` → `['9074729']`; `imos_in('IMO: 9074729, IMO 9074728')` → `['9074729']`; OFAC-shaped row `['36','ANYSHIP','vessel','IRAN', …, 'IMO 9074729; ...']` → `{'9074729': {'n':'ANYSHIP','l':['OFAC']}}`; UK-shaped dict row with `'IMO number': '9074729'` and `'Name 6': 'ANYSHIP'`; `merge` of OFAC + UK for the same IMO → `l == ['OFAC','UK']`.
- [ ] **Step 2: Run** `python3 -m unittest tools/sanctions/test_build.py -v` → FAIL (import).
- [ ] **Step 3: Implement** + `main()` (urllib, UA `osintfront.com data build (+https://osintfront.com)`).
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Workflow** — weekly `'23 4 * * 1'` + manual; tests then build; commit the JSON if changed; build failure → job fails after committing nothing.
- [ ] **Step 6: Commit** `"Ships: sanctioned vessels list build (OFAC, UK)"`.

---

### Task 1: Gates, crossings, stats (database)

**Files:** Create `supabase/migrations/20261106000096_ais_chokepoints.sql`, `supabase/tests/ais_crossings.sql`.

**Interfaces:**
- Produces:
  - `public.ais_gates (id text pk, chokepoint text, a_lat, a_lng, b_lat, b_lng float8, pos_en, neg_en, pos_he, neg_he text, wait_pos box, wait_neg box)` — boxes as `(min_lat, min_lng, max_lat, max_lng)` float8 columns `wp_*`, `wn_*` (eight columns). Seed seven rows: `hormuz, bab_el_mandeb, suez_n, suez_s, bosphorus, dardanelles, tiran` (chokepoints: same id except `suez_n`/`suez_s` → `suez`).
  - Waiting boxes (lat_min, lng_min, lat_max, lng_max): Hormuz Gulf 25.0, 54.5, 26.9, 56.3 / Gulf of Oman 24.8, 56.5, 26.3, 57.8 · Bab el-Mandeb Red Sea 12.7, 42.6, 13.6, 43.6 / Gulf of Aden 11.8, 43.4, 12.6, 45.2 · Suez N 31.2, 32.1, 31.6, 32.6 · Suez S 29.6, 32.45, 29.92, 32.7 · Bosphorus Black Sea 41.2, 28.9, 41.45, 29.4 / Marmara 40.85, 28.8, 41.0, 29.2 · Dardanelles Aegean 39.9, 25.9, 40.1, 26.2 / Marmara 40.3, 26.6, 40.6, 27.2 · Tiran Aqaba 28.0, 34.4, 28.4, 34.8 / Red Sea 27.6, 34.2, 27.9, 34.6. Which box is "pos" vs "neg" follows each gate's side sign (computed in the migration, checked by test).
  - `public.ais_gate_crossings(p0_lat, p0_lng, p1_lat, p1_lng float8) returns table(gate text, dir smallint)` — immutable, pure geometry.
  - `public.ais_crossings (id bigserial pk, gate text, mmsi bigint, dir smallint, at timestamptz, ship_type smallint, name text, flag text)`, index `(gate, at desc)`, `(mmsi, gate, at desc)`.
  - `public.ais_upsert` changed: before writing positions, insert crossings for rows whose current row is ≤ 6 h old, respecting the 30-minute rule; hourly cleanup 72 h vessels / 60 days crossings.
  - `public.chokepoint_stats() returns jsonb` — array of `{ id, crossings_24h, tankers_24h, avg_7d, pct_normal (null if < 7 days), days, wait_pos, wait_neg, pos_en, neg_en, pos_he, neg_he, last: { name, ship_type, flag, dir, at } | null }`, one per chokepoint (6), security definer, anon + authenticated execute.
- Grants: select on `ais_gates`, `ais_crossings` to anon, authenticated.

- [ ] **Step 1: Failing SQL test** (run in `begin … rollback`):
  - `ais_gate_crossings(26.6, 56.0, 26.6, 56.8)` → one row `hormuz`; reversed points → same gate, opposite `dir`; the `dir` for west→east resolves to the label "out of the Gulf" (`neg_en`/`pos_en` per sign)
  - movement along the gate (26.4, 56.42) → (26.9, 56.36) offset 0.05° west → no rows
  - through `ais_upsert`: insert a vessel at (26.6, 56.0), then a position at (26.6, 56.8) → one `ais_crossings` row; another crossing back within 30 min → still one row
  - Review Focus 1: vessel's `updated_at` set 8 h ago, then a crossing position → no row
  - Review Focus 3: `chokepoint_stats()` with no history → every element has `pct_normal` null and `days` 0, six elements
  - with crossings seeded on 8 distinct past days (2/day) and 1 in the last 24 h → Hormuz `pct_normal` = 50
- [ ] **Step 2: Run** → FAIL. **Step 3: Migration**, apply (`ais_chokepoints`). **Step 4: Run** → PASS; check `ais_upsert` still returns counts on a small batch.
- [ ] **Step 5: Commit** `"Ships: chokepoint gates, crossings and stats"`.

---

### Task 2: Wider coverage (collector)

**Files:** Modify `supabase/functions/ais-collector/index.ts` (`BOXES`).

- [ ] **Step 1:** Add the three boxes from the spec (comment each). Keep `[[minLat, minLon], [maxLat, maxLon]]`.
- [ ] **Step 2:** `deno check` not available → `npx esbuild supabase/functions/ais-collector/index.ts --bundle --platform=neutral --external:jsr:* --external:npm:* --outfile=/dev/null` to catch syntax errors.
- [ ] **Step 3: Commit** `"Ships: wider AIS coverage (Turkish Straits, Caspian, Arabian Sea)"`. Not deployed (Global Constraints).

---

### Task 3: Client data — `src/lib/ships.ts`

**Files:** Create `src/lib/ships.ts`; Test `tests/ships/stats.test.ts`.

**Interfaces:**
- Produces:
  - `interface ChokepointStat` mirroring the RPC element; `type Status = 'normal' | 'below' | 'low' | 'collecting'`
  - `statusOf(pct: number | null): Status` (≥ 70 normal, ≥ 30 below, else low; null collecting)
  - `fetchChokepoints(rpc: (fn: string) => Promise<{ data: unknown; error: unknown }>): Promise<ChokepointStat[]>`
  - `loadSanctions(fetcher?: typeof fetch): Promise<Map<string, { n: string; l: string[] }> | null>` — null on failure (cached on success)
  - `imoValid(imo: number | string | null): boolean` (same check digit as Task 0)
  - `sanctionOf(v: { imo: number | null }, list: Map<…> | null): { n: string; l: string[] } | null`
  - `fetchSilentVessels(bounds): Promise<Vessel[]>` (`updated_at` between now−72 h and now−24 h; uses `Vessel` from `src/lib/intelLayers.ts`)
  - `CHOKEPOINT_TXT` (he/en names: Strait of Hormuz / מצר הורמוז, Bab el-Mandeb / באב אל-מנדב, Suez Canal / תעלת סואץ, Bosphorus / הבוספורוס, Dardanelles / הדרדנלים, Strait of Tiran / מצרי טיראן; status labels; footer)
- [ ] **Step 1: Failing tests:** `statusOf(70) === 'normal'`, `statusOf(69.9) === 'below'`, `statusOf(30) === 'below'`, `statusOf(29) === 'low'`, `statusOf(null) === 'collecting'`; `imoValid(9074729)` true, `9074728` false, `null` false; `sanctionOf({imo: 9074728}, list-with-9074728)` → null (bad check digit); `sanctionOf({imo: null}, list)` → null; `loadSanctions` with a 404 fake → null; with a valid file → Map size 1; `fetchChokepoints` maps an RPC payload of six items and throws on `error`.
- [ ] **Step 2: Run** `node --experimental-strip-types --test tests/ships/stats.test.ts` → FAIL. **Step 3: Implement** (no Leaflet/Supabase imports except types; `fetchSilentVessels` takes the supabase client as a parameter). **Step 4:** PASS. **Step 5: Commit** `"Ships: chokepoint, silent and sanctions client data"`.

---

### Task 4: Panel + map markers

**Files:** Create `src/components/map/ChokepointPanel.tsx`; Modify `src/components/map/IntelLayers.tsx` (ships section + ship markers).

- [ ] **Step 1: Panel** inside the Ships section (visible when Ships is on): three numbers (ships on the map = `shownShips.length`, sanctioned at sea = shown ships with `sanctionOf`, silent 24 h+ = silent list length), then six cards per the spec's UI (status chip colours: normal green, below amber, low red, collecting slate); refresh every 5 minutes while open; "See it on the map" → `map.fitBounds` around the gate line + waiting boxes, ships on.
- [ ] **Step 2: Markers** — sanctioned: red ring (`box-shadow: 0 0 0 2px #dc2626`) on the existing icon/dot; popup line "Sanctioned (OFAC, UK)". Toggle "Show silent ships" (default off) → grey dots at last position, popup "Silent since <time> (may be out of receiver range)".
- [ ] **Step 3: Verify** `npx vite build` OK, tsc only the 2 known errors; preview: panel shows six cards for a guest (data may say Collecting).
- [ ] **Step 4: Commit** `"Ships: chokepoints panel, sanctioned and silent ships"`.

---

### Task 5: e2e, docs, verification

- [ ] **Step 1:** `tests/e2e/ships.js` — guest: open panel, turn Ships on, expect 6 elements `[data-chokepoint]`, each with a status chip.
- [ ] **Step 2:** README "Ships upgrade" section (coverage, gates, sanctions workflow, deploy note for the collector).
- [ ] **Step 3:** Full verification (all Python + node suites, SQL tests, tsc, build). Commit and push `ships-upgrade`.
