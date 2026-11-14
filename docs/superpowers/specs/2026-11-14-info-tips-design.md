# Info icons on every map, layer and sub-layer — short design

_14 Nov 2026 · planned by Fable · small change_

## Why
Readers open the map-style menu and the "Intelligence layers" panel and meet names they
cannot decode (Sentinel-2, VIIRS, AIS, ADS-B, "silent ships", squawk 7700). The owner wants a
small (i) beside each map, each layer and each sub-layer with a short explanation.

## Goals
- One (i) beside every item listed below; tap / hover / focus shows 1–2 short sentences.
- Each text says: what you see · where the data comes from · how fresh it is (when known).
- Hebrew and English, simple words, no jargon without a gloss.

## Non-goals
- No admin editing of the texts (owner chose fixed texts in code).
- No database change, no AI call, no new dependency.
- No change to which layers exist, their order, defaults or plan locks.

## Anti-goals
- A tip that toggles the layer when tapped, or closes the menu.
- A tip clipped by the panel edge or hidden behind the map on a phone.
- Long texts: more than 160 characters (2–3 very short sentences at most).

## Approaches
1. **Fixed texts in the translation files, reuse `InfoTip` (chosen).** `src/components/common/InfoTip.tsx`
   already exists and is used in 5 places. Cheapest; a text change needs a deploy.
2. Texts in a Supabase table with an admin edit screen. Owner edits alone, but ~3× the build
   (table, RLS, screen, cache). Rejected by the owner.
3. One "legend / help" page listing everything. Cheap, but the explanation is not where the
   reader is looking. Rejected.

## Design
- Texts live in `src/i18n/en.ts` and `he.ts` under `info.<group>.<item>` (existing `info.weather`,
  `info.infra`, `info.military`, `info.eei`, `info.severity` stay as they are).
- A single list `src/lib/infoTips.ts` names every key, so one test can check that each key has
  both languages and respects the length limit.
- `InfoTip` is placed **beside** the control, never inside a `<button>` or `<label>` (a tap on it
  must not toggle the layer). `InfoTip` already stops click propagation.
- **Map-style menu** (`MapView.tsx` ~l.1303): each row is one `<button role="menuitemradio">`.
  Split each row into a flex row: the button (flex-1) + `InfoTip` as a sibling. Tapping (i) must
  not close the menu.
- **Clipping:** the tooltip is `absolute`, 240 px wide; the style menu is 208 px and the panel
  scrolls. The builder must check at 390 px width (LTR and RTL) and, if it clips, render the
  tooltip through a portal with fixed position, or flip its side. Builder's call which.

### Where the (i) goes
| Group | Items |
|---|---|
| Map styles (8) | standard, topo, cyclosm, satellite, hybrid, light, dark, vector |
| Satellite | section head; source dropdown (one tip explaining the 4 sources: sharpness vs. how often); "before / after" mode |
| Fires | fires & hot spots (NASA FIRMS) |
| Ships | section head (what AIS is); "show silent ships"; ship types row (one tip) |
| Aircraft | section head (what ADS-B is, 250 NM radius); military only; military worldwide; emergencies only (what 7500/7600/7700 mean) |
| Areas | control areas; sects in Lebanon; wadis and streams in Lebanon |
| Weather (group tip exists) | clouds, rain, temperature, wind |
| Airfields & ports (group tip exists) | each sub-layer checkbox |
| Military (group tip exists) | each site-type checkbox; "foreign operators only" |

Planner's calls (not asked of the owner): pure filters get no tip (flag, search box, last
update, altitude band, "moving only", opacity) — they explain themselves; the four satellite
sources share one tip because a dropdown option cannot hold an icon.

## Texts
Fable drafts all texts (HE + EN) in the plan, taken from the facts already in the code
(source names, resolutions, refresh times, "Israel not included"). No fact may be invented:
if the code does not say how fresh a layer is, the text leaves freshness out.

## Tests (fail first)
- Unit `tests/i18n/infoTips.test.ts`: every key in `infoTips.ts` exists in en and he, non-empty,
  ≤ 160 chars.
- Playwright `tests/e2e/info-tips.mock.cjs`, 390×844 and desktop, HE and EN:
  every listed control has a `[data-info-tip]` beside it; tap opens the tooltip fully inside
  the viewport; tap on (i) does not change the layer's checked state; in the style menu it does
  not change the style or close the menu; Escape and tap-outside close it.

## Rollout / rollback
Front-end only: merge to `main` → Vercel deploys. Rollback: revert the merge.

## Left to the builder
Exact spacing, portal vs. flip for clipping, wording polish inside the length limit.
