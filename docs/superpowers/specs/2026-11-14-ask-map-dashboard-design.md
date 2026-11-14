# "Ask the map": statistics dashboard — design (draft 2026-11-14)

Owner: Ben. Builds on `2026-11-12-ask-map-chat-design.md` (conversation, summary mode, copy/share).

## Intent
A count question in "Ask the map" ("how many Israeli incursions into Syria last week", "how much
Israeli artillery fire at south Lebanon in the last two days", "how many threats against Iran this
week") returns a visual dashboard instead of a text answer: a small map, headline numbers, a chart,
hotspots, written insights, and PDF / JPEG download.

**Why:** it must look professional enough to show new companies and clients — it is a sales showcase
as much as a feature. Credibility of the numbers is the point: a client who catches one inflated
number stops trusting the product.

## Goals
- Correct counts of **distinct incidents**, not raw rows: repeat reports of one incident count once.
  Every number can be traced to the events behind it.
- An impressive, clean dashboard on phone and desktop, in Hebrew and English.
- One-tap download as PDF and JPEG that look the same on every device.
- Staff can put a client's name on it ("Prepared for …") for sales use.

## Non-goals (v1)
- Saved dashboard history, shareable dashboard links, scheduled/automatic dashboards.
- Counting quantities inside reports ("30 shells") — possible later as a secondary figure.
- Free-form chart building (choosing chart types, custom breakdowns).
- Arabic UI now (but see Languages).

## Anti-goals (a failure even if it "works")
- Numbers the model guessed. The model classifies events; **code counts**.
- A dashboard whose count disagrees with what the user sees when they open its events on the map.
- Charging a user for a clarifying question.
- An export that is blurry, cut off, missing the map, or shows the print dialog instead of a file.

## Who gets it
- **Max** (and the `intel` licence tier — my call: it is the top tier) and **staff** (`profiles.role <> 'viewer'`).
- **Pro** users can already ask the map (3 credits/day). A Pro user's count question gets a normal
  text answer plus one line "Statistics dashboards are part of Max" with an upgrade link to the
  packages page (the site rule: every missing feature shows "not in your plan" + upgrade link).
- New `plan_features` row `ai_dashboard` (guest/free/pro false; max/intel true). Staff bypass, as today.

## How the user gets there (decided)
Everything goes through the "Ask the map" input. No separate button.

1. **Clear count request** → the dashboard is built straight away.
2. **Unclear request** (could be a count or a plain question) → the map asks back, as a normal turn:
   "Create a statistics dashboard, or answer in text?" with two quick-reply chips:
   `Dashboard · 3 questions` / `Text answer`.
   - **This clarifying question and the short reply to it are free** — not charged to the user's quota.
     What follows is charged as usual: "Dashboard" → 3 credits; "Text answer" → a normal question.
     So nothing paid is ever free, and the server may trust the client's "this is a clarify reply"
     flag (worst case a cheap plan call goes unattributed). No server-side clarify record.
   - A reply counts as "the answer to the clarification" only if the previous turn was a clarify
     turn **and** it is a chip press or a short text (≤ 40 chars, my call). Anything longer is a new,
     normal question. This stops the free turn being used as free chat.
3. While building: a progress card in the thread with stages — "Finding events" → "Classifying 120 of
   340" → "Merging repeat reports" → "Writing insights". Expect ~20–60 s.
4. Done: a compact card in the thread ("14 incidents · +40% vs previous week") with "Open dashboard".
   The dashboard opens full-screen on phone, as a large modal on desktop. It also opens automatically
   the first time it is ready.
5. A dashboard is one of the 6 turns of the conversation. Follow-up questions may refer to it
   (history gets a one-line summary of it: the metric, the count, the period).

## Cost and quota (decided + my calls)
- The quota today is cost-based: `ai_quota.used` = today's `ai_usage.cost_usd` ÷ `ai_credit_usd`
  (0.08). "A dashboard costs 3 questions" is a **fixed charge of 3 credits**, so the user can predict it,
  while the global budget still sees the **real** cost (my call):
  - the dashboard's model calls are logged as usual under the user (`runAsReader`), with purposes
    starting `ask_dashboard_` — so `spent_today_usd` (global budget) counts their real cost, staff
    runs included;
  - `ai_quota.used` (the user's quota) leaves those rows out and adds instead 3 credits per dashboard
    of the user's that finished today (`ai_dashboards.status = 'done'`, not from cache). This is a
    change to the `ai_quota` function in the migration.
  - Cost estimate (Haiku 5.5 at $0.1 / $0.5 per M tokens; Opus 5.5 for insights): a typical week
    (~300 events × 2 periods) ≈ $0.05–0.10; at the 2,000-event cap (≈ 4,000 classified) ≈ $0.30.
    The cap therefore covers both periods together: at most 2,000 + 2,000 events classified.
- Before building: the user needs ≥ 3 credits left, else the existing quota message, worded
  "A dashboard needs 3 questions; you have N left today."
- No charge when: the build fails, no events at all are found in the period (nothing classified), or
  the result comes from the 15-minute cache.
- Clarify turn: the plan call that decided "unclear" is not attributed to the user.
- Staff: no quota (unchanged rule).
- Hard cap: at most **2,000** candidate events per dashboard; above that, the map asks the user to
  narrow the area or period (my call; free, like a clarify turn).

## The counting engine (approach B, chosen)
Pipeline on the server, in `event-agent` (new module `supabase/functions/_shared/askStats.ts`):

1. **Plan** (existing cheap plan step, extended). New `mode` values: `"stats"` and `"clarify_stats"`.
   For `stats` the plan also returns a **metric**:
   - `subject` — what is counted, in plain words + the fitting categories (e.g. ground incursion →
     `infiltration`, `military-activity`, `force-sighting`);
   - `actor` — who did it, optional ("Israel", "Hezbollah", …);
   - `target` — against whom / where, optional ("Syria", "Iran", "south Lebanon");
   - `since` / `until`, `countries`, `places`, `terms` (as today);
   - `title` — the dashboard title in the UI language ("Israeli incursions into Syria").
   No time in a stats request → last 7 days (my call; a plain question keeps 3 days, a summary 24 h).
2. **Fetch** all public events (`published`/`archived`, not deleted) that pass the plan's broad filter,
   **without the 120 cap** (≤ 2,000), plus the same for the **previous period of equal length** (for
   the comparison). A new RPC (or a `p_limit` raise on `ai_search_candidates` for this caller only —
   builder's choice) that also returns `sources` (merged reports) and coordinates.
3. **Classify** with a cheap model (Haiku-class, `CHEAP_MODELS`) in batches of ~40 events, both periods.
   Per event the tool returns: `fits` (yes / no / unsure), `actor`, `target`, `place` (as written),
   and a one-line `incident` description. `unsure` is not counted; it is listed as
   "N reports were unclear and not counted" in the method note. Events and question are data;
   instructions inside them are ignored (existing rule).
4. **Merge into incidents** — in code, deterministic:
   - Events already merged by the dedupe agent are one event with several `sources`; their report count
     is `max(1, sources.length)`.
   - Remaining repeats: same incident when same kind, place within ~5 km (or the same place name), and
     time within 60 minutes (builder may reuse `dedupeMatch.ts` helpers; exact thresholds are the
     builder's, with tests).
   - Result: incidents, each with its event ids, time (earliest), place, coordinates.
5. **Compute** in code: incident count, report count, previous-period count and % change, time buckets
   (≤ 48 h → per hour, ≤ 31 days → per day, longer → per week; Israel time), peak bucket, top places
   (top 5 + "other") with share, night share (22:00–05:00) and any other simple figures the insights use.
6. **Insights** — Opus (`OPUS_MODELS`) gets the computed figures and the incident list (not raw rows)
   and writes 3–5 short bullets with citations `[n]` to incidents. It may only state what the figures
   and incidents show; every number in a bullet must come from the computed figures (the builder adds
   a check that drops a bullet whose numbers don't appear in the figures). No insights call when there
   are 0 incidents.

**Long-running:** the build runs in the background (`EdgeRuntime.waitUntil`), writing progress and the
result to a new table `ai_dashboards` (id, user_id, status, stage, progress, question, lang, result
jsonb, created_at). The client gets the id at once and polls (every ~1.5 s) until `done` / `failed`.
Rows are service-role only; the user reads their own through an RPC. Rows older than 30 days are
deleted (my call; nothing in the UI lists them in v1).

**Cache:** same normalised question + same period + same UI language within 15 minutes → the same
result (as `ask` today). The client sends `lang` (the UI language); it decides the dashboard's
language (title, labels, insights) and is part of the cache key (my call; today the plan step guesses
the language from the question).

**Showing a dashboard's events on the main map** (from a hotspot, a bar, a citation, or "show all"):
the map and feed show **all the reports** behind the chosen incidents — not one item per incident —
under a header line "5 incidents · 9 reports" with a "Back to dashboard" and a "Clear" action. While
they are shown, the user's own map filters, search and filter sets are **bypassed**, so the numbers
always match what is on screen (my call; `MapPage.visibleEvents` needs a bypass for this source).

## The dashboard (approved mock-up, 2026-11-14)
Top to bottom (RTL in Hebrew):
1. **Header:** "OSINTFRONT · Dashboard" mark; title; period (dates) + period name; "Updated HH:MM".
   Staff only: an editable "Prepared for …" badge (≤ 60 chars, edited in place, no re-run).
2. **Mini map:** our own SVG (no map tiles) — country outlines of the region from a bundled,
   simplified, public-domain boundary file (Natural Earth admin-0, cropped to the Middle East,
   lazy-loaded), view fitted to the incidents. One circle per hotspot, size by incident count, label
   "place N". The target country is shaded. Pressing a hotspot closes the dashboard and shows its
   events on the main map.
3. **Headline tiles (2 × 2):** incidents (with "of Y reports"); change vs the previous period (%, and the
   previous count); peak day/hour (and its count); main hotspot (and its share).
4. **Main chart:** incidents per bucket as bars; previous period as a dashed gray line. One y-axis.
   Hover/tap a bar → its count; pressing it shows that bucket's events on the main map.
5. **Hotspots:** horizontal bars, top 5 + "other".
6. **Insights:** 3–5 bullets with citation chips; a chip opens that incident's events on the map.
7. **Method note:** "All N events in the period were classified; repeat reports of the same incident
   were merged. M unclear reports were not counted. Source: Osintfront event database."
8. **Actions:** Download PDF · Download JPEG (two equal buttons).

**Zero incidents:** the dashboard still renders (0, the previous period, an empty chart with the
baseline) with the line "No matching incidents in this period" and no insights.

**Charts are our own SVG components** (no chart library is in the project; keeps the bundle small and
exports sharp). Colors follow the site's palette; one hue for the current period, gray for comparison,
red for hotspots.

## Export (decided: in the browser)
- Both files are made in the browser, from the dashboard itself; libraries are lazy-loaded on the first
  press (e.g. `html-to-image` + `jspdf`; builder's choice).
- Always rendered in the **light** theme at a fixed export width, whatever the screen.
- **JPEG:** the dashboard as on screen (without the action buttons), 2× scale, ≥ 1,080 px wide.
- **PDF:** A4 portrait. Page 1 = the dashboard. Last page(s) = "Sources": one line per incident,
  `[n] title — osintfront.com/e/{id}`, links clickable. Footer on every page: logo, "Prepared for …"
  (when set), generated time, `osintfront.com`.
- Hebrew must render correctly (RTL, site font embedded). Direct download, never the print dialog.
- File name: `osintfront-dashboard-{slug-of-title}-{YYYY-MM-DD}.pdf|.jpg`.
- Links in exports always use `osintfront.com`, never the `*.vercel.app` host (existing rule).

## Languages
- Hebrew and English via `src/i18n` keys (no Hebrew literals in components — existing test).
- All dashboard text, including the title and insights, comes in the UI language (sent by the client,
  see Cache).
- Arabic is being prepared for the site: nothing in the dashboard may hard-code he/en layout decisions
  beyond `dir` from i18n, so Arabic plugs in later. Western digits everywhere.

## Errors
- Quota / budget / upgrade / sign-in / rate limit: the existing messages; "upgrade" for Pro opens the
  "not in your plan" message with the packages link.
- Build failed: the progress card turns into "Couldn't build the dashboard. Try again." — not charged.
- Too many events (> 2,000): a free clarify-style turn asking to narrow the area or period.
- Export failed (browser refused, memory): "Couldn't create the file. Try again." Nothing else changes.

## Server and client pieces (orientation for the builder)
- Server: `_shared/ask.ts` (plan modes, metric), new `_shared/askStats.ts` (fetch, classify, merge,
  compute, insights — merge/compute as pure exported functions), `event-agent/index.ts` (new actions
  `ask` → may return `{mode:"stats", dashboard_id}` / `{mode:"clarify_stats"}`; `dashboard_status`),
  migration: `plan_features` row, `ai_dashboards` table + RPC + cleanup, fetch RPC.
- Client: `src/services/askService.ts` (modes, polling), `src/components/map/AskMap.tsx` (clarify chips,
  progress card, dashboard card), new `src/components/ask/StatsDashboard.tsx`, `MiniMap.tsx`,
  `charts/*`, `src/lib/askStats.ts` (pure: buckets, labels, file names), `src/lib/dashboardExport.ts`.
- The exact split is the builder's.

## Testing
- Unit (`node:test`): incident merging (repeat reports, already-merged sources, near/far, time window),
  bucketing by period length in Israel time, % change incl. previous = 0, top places + other,
  clarify-reply rule (chip, ≤ 40 chars, after a clarify turn only), insight-number check, file names.
- Browser (Playwright, the `tests/e2e/*.mock.cjs` pattern with a faked Supabase), saved as
  `tests/e2e/ask-dashboard.mock.cjs`, run he/en × desktop/phone (390 px):
  clear count question → progress stages → dashboard opens; unclear question → clarify chips → the
  shown quota does not drop → chip → dashboard; Pro user → text answer + upgrade line; staff sets
  "Prepared for" → it appears in both exports; PDF downloads (starts `%PDF`, A4, sources page present);
  JPEG downloads (valid JPEG, ≥ 1,080 px wide); hotspot / bar / citation press shows events on the map;
  zero-incidents dashboard; failure shows retry and no charge; dark mode screen still exports light.
  Screenshots saved for the owner's review.
- Accuracy check on the preview with the real function: the three example questions from the owner;
  staff hand-count the incidents behind each and compare. Target: within 10 % of the hand count
  (my proposal for the acceptance bar).
- `npm run check` (types + build) must pass.

## Rollout
1. Branch `feat/ask-map-dashboard`; Vercel builds a preview.
2. Migration + `event-agent` deploy (backward compatible: old clients never send stats) after the owner agrees.
3. Owner checks accuracy and the exports on the preview.
4. Merge to `main`.

## Approaches considered (counting engine)
- **A. One Opus call reads everything** — simplest, but miscounts hundreds of items, not auditable,
  expensive, and a busy week doesn't fit one call. Rejected.
- **B. Classify in batches with a cheap model, merge and count in code, Opus only for insights** —
  auditable to the event, cheaper; more parts and a 20–60 s wait with progress. **Chosen by the owner.**
- **C. Only stored fields (category + country) counted in SQL** — instant and free, but cannot tell who
  fired at whom, so it fails the owner's own examples. Rejected.

## Decided by the owner
Distinct incidents (B over raw rows or quantities); Max + staff, staff get "Prepared for" and no quota;
the dashboard layout above with the mini map at the top; entry only through the question; unclear →
the map asks, and that exchange is free; time buckets, languages, export format as listed; engine B.

## Left to the builder
Exact merge thresholds (with tests), fetch RPC shape, export libraries and technique, component split,
polling details, boundary-file preparation and size (keep it small, lazy-loaded).
