# Military bases layer — design (approved 2026-11-06)

Owner request: "What about the military bases? Not only airfields." An extension of the
"Airfields & ports" layer (spec `2026-11-06-airfields-ports-design.md`). Same region, same rule:
Middle East excluding Israel. Branch `military-bases`, from `main`.

## Goal
In the "Airfields & ports" section of the Intelligence layers panel, a "Military bases" group shows military
sites that are not airfields — bases and barracks, naval bases, ranges and training areas, bunkers and
checkpoints — each with a popup, and marks bases run by a foreign country (US in Qatar, Russia in Syria,
Turkey in Iraq…).

## Decisions (from the owner)
- **Kinds:** all four — bases & barracks, naval bases, ranges & training areas, bunkers & checkpoints.
- **Foreign operators:** marked on the map (gold ring + operator flag), not only in the popup.
- **Approach:** static files built monthly (approach A), like airfields.
- **West Bank:** sites operated by Israel are left out everywhere, including inside the Palestinian territories.
- **Access:** same plan key as airfields, `airfields_ports` (Free and up; guests see 🔒 → sign-up gate).

## Countries
LB SY JO IQ IR SA YE OM AE QA BH KW EG TR CY PS SD ER DJ SO — the same 20 codes as `tools/infra/build_infra.py`.
Israel (IL) is never queried.

## Sources
- **OpenStreetMap** via the Overpass API (`https://overpass-api.de/api/interpreter`), licence ODbL.
  One query per country, by the country's `ISO3166-1` area (admin level 2), so every element carries its
  country without a point-in-polygon step:
  `nwr["military"](area); nwr["landuse"="military"](area);` with tags and either a centre or bounds per element
  (the parser accepts `center` or `bounds`, so the exact `out` modifiers are settled on the first workflow run).
  Pause 5 s between countries; retry a failed country twice with backoff.
- **Wikidata** SPARQL (`https://query.wikidata.org/sparql`), CC0: items in these 20 countries that are a
  military base / installation (instance of, or subclass of, "military installation"), with coordinates (P625),
  country (P17), operator (P137) and the operator's country (P17 of the operator, or the operator itself when it is
  a sovereign state), English and Hebrew labels, and whether it is a naval base or an air base. The exact class
  QIDs are confirmed during implementation against wikidata.org and written into the build as constants.
- Both requests send `User-Agent: osintfront.com data build (+https://osintfront.com)`. The workspace cannot
  reach either service, so formats are covered by fixtures with the real response shape and confirmed on the
  first workflow run; parsers fail loudly on an unexpected shape.

## Classification (one kind per site, first match wins)
1. **Skipped:** `military=airfield`, anything also tagged `aeroway=aerodrome` (the airfields layer has those),
   `disused=yes` / `abandoned=yes`, and `military=trench|obstacle_course`.
2. **minor:** `military=bunker` or `military=checkpoint`.
3. **naval:** `military=naval_base`, or a name matching navy / naval / coast guard / بحرية / خفر السواحل /
   deniz / donanma / sahil güvenlik / نیروی دریایی (case-insensitive).
4. **range:** `military=range|training_area|danger_area|nuclear_explosion_site`.
5. **base:** `military=base|barracks|office|academy` and any other `military=*` value, or `landuse=military`
   with a name.
6. **range** ("military zone"): `landuse=military` without a name.

## Excluding Israel
Inside PS (and as a safety net in every country) a site is dropped when any of these hold:
its operator maps to IL (OSM `operator` text or Wikidata operator country);
its `name` is written in Hebrew script (U+0590–U+05FF);
it is a `military=checkpoint` inside PS (almost all are Israeli; the few Palestinian ones are dropped too).
The Golan Heights sit inside Israel's boundary in OSM, so they are not queried at all.
`name:he` is used only as a display name and never triggers the drop.

## Operators and foreign bases
- **Wikidata match:** an OSM element whose `wikidata` tag equals the item's QID; otherwise the nearest base or
  naval site within 3 km. An unmatched Wikidata item is added as its own site (kind naval if a naval base,
  else base; source `wd`).
- **Foreign air bases:** a Wikidata air base is skipped (the airfields layer shows it) — unless its operator is
  foreign; then it is added as kind `base` with `air: true`, so "Foreign-operated only" lists Al Udeid, Incirlik,
  Hmeimim and the like. It appears next to the airfield's round marker; that duplicate is accepted.
- **OSM operator text** is a second signal, mapped by keywords to a country code: US (united states, u.s., usaf,
  us navy, us army, centcom), GB (royal air force, royal navy, british), FR (french, armée, marine nationale),
  RU (russian, russia), TR (turkish, türk, tsk), IR (iranian, irgc, iran), IT, DE (bundeswehr), CN (chinese,
  pla), JP, IN, AE (emirati, uae), SA (saudi), EG (egyptian), IL (israel, idf, צה"ל, צבא). Wikidata wins when
  both are present.
- **Foreign** = operator country is known and differs from the site's country.

## Output files
- `public/data/military.geojson` — kinds base, naval, range.
- `public/data/military-minor.geojson` — kind minor.
- Point features, coordinates rounded to 5 decimals. Properties:
  `{ k: 'base'|'naval'|'range'|'minor', n?: name, en?: name:en, he?: name:he, cc: country,
     op?: operator country code, opn?: operator name, f?: true when foreign, air?: true,
     km2?: rough area (from bounds, 2 significant figures), osm?: 'w123'|'r45'|'n67', wd?: 'Q123' }`.
- **Size guard:** if `military.geojson` would exceed 8 MB, drop unnamed `range` sites under 0.05 km²,
  then re-check; if still over, fail. `military-minor.geojson` has no size guard; it is loaded only on demand.
- **Quality gate (fails loudly, keeps last month's files):** any country query failed after retries; fewer
  than 1,000 sites in `military.geojson`; TR, IR, EG or SA with zero sites; the Wikidata query failed
  (OSM-only output is not written). The first run's counts are recorded in the plan ledger and the floor is
  raised to about 70 % of them.

## Build and workflow
- `tools/military/build_military.py` (+ `test_build.py`, fixtures in `tools/military/fixtures/`).
- `.github/workflows/military-data.yml`: manual + monthly (`29 3 2 * *`), runs tests then the build, commits the
  two files. Same pattern as `infra-data.yml`. Needs no secrets.
- Placeholder files are not committed; until the first run, the toggles show ⚠️ "Not built yet"
  (a 404 from `/data/military*.geojson`; `vercel.json` already excludes `data/` from the SPA rewrite).

## UI
- **Panel:** a "Military bases" sub-group inside "Airfields & ports": toggles **Bases · Naval bases ·
  Ranges & zones · Bunkers & checkpoints**, and a **Foreign-operated only** checkbox that filters the first three
  (and minor) to `f: true`. Bunkers & checkpoints shows "zoom in to see" below zoom 11 and draws nothing there.
- **Markers:** square (rounded 3 px) so they differ from the round airfield/port markers; one colour and glyph per
  kind — base olive `#4d7c0f` ★, naval navy `#1e3a8a` ⚓, range amber `#b45309` ◎, minor slate `#475569`
  small 10 px dot. Foreign: 2 px gold `#eab308` ring and the operator's flag emoji at the corner. Clustered with
  `leaflet.markercluster` (one group per kind, the existing `clusterIconHtml`). The legend lists the kinds that
  are on, plus "Foreign-operated" when any foreign site is shown.
- **Popup:** name (Hebrew UI: `he` → `en` → `n`; English UI: `en` → `n`; none → "Unnamed site"); kind;
  country; "ליד <town>" / "near <town>" from `geo_nearest_place` (as airfields); **Operated by** operator name and
  flag, highlighted when foreign; rough size (km²); coordinates; links "OpenStreetMap" / "Wikidata";
  credit "© OpenStreetMap contributors" (and "Wikidata" when used). Hebrew labels, RTL in Hebrew.
- **Errors:** a file that fails to load → its toggles show ⚠️ "Unavailable"; 404 → ⚠️ "Not built yet".
- **Code layout:** `src/lib/military.ts` (types, text, popup, flag, loader using the same cache as `loadInfra`),
  `src/components/map/MilitaryLayers.tsx` (hook, panel group, legend items), wired from `InfraLayers.tsx` /
  `IntelLayers` the way the airfields toggles are. `InfraLayers.tsx` is not grown further.

## Testing
- **Python** (`tools/military/test_build.py`): each classification rule; naval by name in four languages;
  airfields and disused sites skipped; Israel rules (operator IDF, Hebrew-script name, checkpoint in PS;
  `name:he` alone kept); Wikidata match by QID and by distance (2.9 km yes, 3.1 km no); unmatched Wikidata item
  added; foreign vs host operator; foreign air base added with `air`, host air base skipped; operator keyword
  mapping; size guard; quality gate exit codes; parser rejects an unexpected Overpass shape.
- **Node** (`tests/military/popup.test.ts`): popup in English and Hebrew, name fallbacks, foreign highlight,
  missing values → "—", flag from a country code.
- **e2e** (`tests/e2e/military.js`): guest → toggle → sign-up gate; signed-in → toggles render, "zoom in to see"
  below zoom 11.
- **First workflow run:** counts per kind and country, file sizes, and a spot check (Al Udeid US, Hmeimim RU,
  Camp Lemonnier US, a Turkish base in northern Iraq).

## Out of scope
Base outlines (polygons), missile/air-defence sites as their own kind, history of changes, editing,
linking events to bases.
