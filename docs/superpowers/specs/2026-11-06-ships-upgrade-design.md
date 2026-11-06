# Ships upgrade — design (approved 2026-11-06)

Project-plan row (Follow Ups): "Ships (Upgrade)" — all ships in the Middle East, Intelligence (Free),
chokepoint insights (Hormuz, Bab el-Mandeb). Part 3 of 3. Branch `ships-upgrade`, stacked on `airfields-ports`.

## Goal
The Ships section gets wider coverage, a chokepoints panel (six gates), silent ships (AIS quiet 24 h+) and
sanctioned vessels. Everything stays open to everyone, guests included, like the ships layer today.

## Honest limits (shown in the UI where they matter)
- Data is aisstream.io's free feed from shore receivers: good near coasts, weak in open water. Counts are
  compared only with **our own** history, never with commercial or satellite sources.
- A ship that goes quiet may simply be out of receiver range. The label says so.

## Decisions
- **Coverage** (`supabase/functions/ais-collector`, `BOXES`, `[[minLat, minLon], [maxLat, maxLon]]`): keep the three
  boxes and add the Turkish Straits + Marmara `[[39.5, 25.5], [41.6, 30.0]]`, the Caspian `[[36.5, 46.5], [47.5, 55.0]]`
  and the Arabian Sea approaches `[[10.0, 51.5], [25.0, 66.0]]`. Check database load after a day (rows, upsert time).
- **Retention:** ships stay in `ais_vessels` for 72 h after last contact (was 12 h). The map's existing age filter
  (1 / 3 / 12 h) is unchanged; silent ships are a separate query.
- **Gates** — a line across each strait; a crossing is when the previous and new positions of a ship lie on opposite
  sides of the line and the movement segment intersects it. Starting coordinates (lat, lng), to be checked on the map:
  - Hormuz: (26.35, 56.42) – (26.95, 56.36)
  - Bab el-Mandeb: (12.70, 43.50) – (12.42, 43.30)
  - Suez north: (31.20, 32.28) – (31.20, 32.42)
  - Suez south: (29.92, 32.52) – (29.92, 32.62)
  - Bosphorus: (41.09, 29.04) – (41.09, 29.08)
  - Dardanelles: (40.14, 26.37) – (40.16, 26.43)
  - Tiran: (27.98, 34.41) – (27.93, 34.52)
  The panel shows six chokepoints; Suez combines north + south (a transit counts at whichever end it is seen).
- **Direction** per gate: two labels from the gate's own geometry (e.g. Hormuz "into the Gulf" / "out of the Gulf";
  Bab el-Mandeb "into the Red Sea" / "out"; Suez "northbound" / "southbound").
- **Crossings** are detected inside `public.ais_upsert` before positions are overwritten, written to
  `public.ais_crossings (id, gate, mmsi, dir smallint (+1/−1), at timestamptz, ship_type, name, flag)`; one row per ship
  per gate per 30 minutes at most. Kept 60 days. Readable by anon (like `ais_vessels`).
- **Baseline:** `% of normal` = crossings in the last 24 h ÷ the average daily crossings of the previous 28 days
  (days with data only). With fewer than 7 days of data: "collecting baseline (n days)".
- **Waiting:** ships with speed < 1 kn inside a box on each side of a gate (boxes defined next to the gates).
- **Read path:** one RPC `public.chokepoint_stats()` → per gate: crossings 24 h, tankers 24 h, 7-day daily average,
  % of normal (or null + days collected), waiting per side, last crossing (name, type, flag, dir, at). Anon may call it.
- **Silent ships:** `updated_at` between 24 h and 72 h ago and last position inside the coverage boxes.
- **Sanctions:** `public/data/sanctioned-vessels.json` = `{ updated, vessels: { "<IMO>": { n: name, l: ["OFAC","UK",…] } } }`,
  built weekly by `tools/sanctions/build_sanctions.py` in `.github/workflows/sanctions-data.yml` from the US OFAC SDN list
  (vessels with an IMO in their remarks) and the UK sanctions list (ship IMO field). The EU is added only if a
  machine-readable list with IMO numbers is found in the plan's first task. Matching is by IMO only.

## UI (Ships section)
- Top: three numbers — ships on the map · sanctioned at sea · silent 24 h+.
- One card per chokepoint (layout of the reference screenshot): name, status chip (Normal ≥ 70% · Below normal
  30–70% · Low < 30% · Collecting), "≈N% of normal", crossings 24 h · tankers · 7-day average, waiting each side,
  last crossing line, "See it on the map" (zooms to the gate and turns ships on).
- Map: sanctioned ships with a red ring; silent ships drawn grey at their last position (toggle "Show silent ships");
  popups gain "Sanctioned (OFAC, UK)" and "Silent since <time> (may be out of receiver range)".
- Footer note: "Commercial ships seen by AIS shore receivers; a ship with AIS off is not counted."

## Testing
- SQL (`supabase/tests/ais_crossings.sql`): a ship crossing Hormuz inward and outward → two rows with opposite `dir`;
  a ship moving along the gate without crossing → none; two crossings within 30 min → one row; stats RPC math.
- Python (`tools/sanctions/test_build.py`): OFAC remark parsing ("IMO 9123456"), UK row parsing, merge of lists for the
  same IMO, invalid IMO check digit rejected.
- Node (`tests/ships/stats.test.ts`): status chip thresholds, "collecting" state, sanctioned/silent counts.
- e2e (`tests/e2e/ships.js`): a guest opens the panel and sees six chokepoint cards.

## Out of scope
VIP yachts, track history / replay, satellite AIS, outside transit statistics, Suez canal convoy schedules.
