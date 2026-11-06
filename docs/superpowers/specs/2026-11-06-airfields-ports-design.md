# Airfields and ports layer — design (approved 2026-11-06)

Project-plan row (Follow Ups): "Airfields and ports" — Intelligence (Free). Scope from the owner:
Middle East excluding Israel. Part 2 of 3 (weather → airfields & ports → ships upgrade).
Branch `airfields-ports`, stacked on `weather-layer` (reuses `geo_nearest_place` and the Intelligence panel).

## Goal
In Intelligence layers, a section "Airfields & ports" shows every airfield (civil, military, strips and
helipads, closed) and every port in the region, each with a popup of basics and technical details, the
nearest town in Hebrew, and a button that turns on live aircraft or ships around it.

## Decisions
- **Countries:** LB SY JO IQ IR SA YE OM AE QA BH KW + EG TR CY PS + SD ER DJ SO. Israel (IL) never.
- **Airfields source:** OurAirports (`airports.csv`, `runways.csv`, public domain), from
  `https://raw.githubusercontent.com/davidmegginson/ourairports-data/main/`. ~2,100 rows in these countries
  (checked 2026-11-06: 1,068 heliports, 548 small, 215 medium, 102 large, 171 closed).
- **Airfield classes** (one per field, first match wins):
  1. `closed` — type `closed`.
  2. `military` — name or keywords match `\b(air ?base|airbase|AB|air force|military|naval air|army|قاعدة)\b` (case-insensitive),
     unless the name contains "hospital". Shown as "military (by name)" — an inference, not an official flag.
  3. `civil` — `large_airport`, `medium_airport`, or `small_airport` with an ICAO or IATA code.
  4. `strip` — everything else: small airports without codes, heliports, seaplane bases, balloon ports.
- **Ports source:** NGA World Port Index (Pub. 150, public domain) from
  `https://msi.nga.mil/api/publications/world-port-index?output=csv`. Columns are matched by normalized
  header name (port name, country, latitude, longitude, harbor size, harbor type, channel / anchorage /
  cargo-pier depth). If a required column is missing, the build fails and lists the headers it saw;
  the previous file stays. Exact headers are verified on the first workflow run.
- **Hebrew:** the popup shows the English name, and under it "ליד <town>" from `geo_nearest_place`
  (within 15 km, signed-in users only — the layer is for signed-in users anyway). No AI.
  (Changed from "Hebrew name of the airfield": `geo_places` covers only 7 of the 20 countries and the build
  would need a database secret.)
- **Delivery:** static files `public/data/airfields.geojson` and `public/data/ports.geojson`, built by
  `tools/infra/build_infra.py` in `.github/workflows/infra-data.yml` (manual + monthly, commits the files,
  same pattern as `osm-wadis.yml`). Loaded only on first toggle-on.
- **Access:** new `plan_features` key `airfields_ports` — enabled for free, pro, max, intel; disabled for guest.
  Guests see 🔒 and get `openGate('signup')`.

## Data shape
Airfield feature properties: `{ k: 'civil'|'military'|'strip'|'closed', n: name, t: OurAirports type,
icao?, iata?, cc: country, el?: elevation ft, rw?: [{ l: length ft, s: surface, lit: bool }] }`.
Port feature properties: `{ n: name, cc, sz?: 'L'|'M'|'S'|'V', ty?: harbor type text, ch?: m, an?: m, cp?: m }`.
Coordinates rounded to 5 decimals. Closed runways (`closed = 1`) are left out.

## UI
- Toggles: **Civil · Military · Strips & helipads · Closed · Ports**, under the weather section.
- Clustered markers (`leaflet.markercluster`), one cluster group for airfields and one for ports; icon per class:
  civil ✈ (sky), military ✈ (dark red), strip • (slate), closed ✕ (grey), port ⚓ (teal). Small legend while on.
- Popup: name; "ליד <town>" / "near <town>"; class (military = "military (by name)"); ICAO / IATA; country;
  elevation (ft and m); runways (length m (ft), surface, lit). Ports: harbour size (Large/Medium/Small/Very small),
  type, channel / anchorage / cargo-pier depth (m). Credit line: "OurAirports" / "NGA World Port Index".
- Button **"Live traffic nearby"**: airfields → turns on the Aircraft layer; ports → Ships; then
  `map.setView(point, 10)`.
- Errors: a file that fails to load → its toggles show ⚠️ "Unavailable".

## Testing
- Python (`tools/infra/test_build.py`): classification (Al Udeid Air Base → military; "Zayed Military Hospital
  Heliport" → strip; a `closed` field → closed even if named Air Base; small airport with ICAO → civil);
  country filter drops IL and keeps PS; runway closed rows skipped; port header matching on two header
  spellings; missing column → clear error.
- Node (`tests/infra/popup.test.ts`): popup text for an airfield and a port (units, missing values → "—").
- SQL (`supabase/tests/airfields_ports_feature.sql`): plan key.
- e2e (`tests/e2e/infra.js`): guest → toggle → sign-up gate.

## Out of scope
Editing entries, linking events to airfields, runway geometry, airspace / NOTAMs.
