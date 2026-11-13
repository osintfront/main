# Translation on the picture, subtitles on the video — design (owner's decisions 2026-11-13; rulings by the planner, listed below)

Follow-up to `docs/superpowers/specs/2026-11-13-media-translation-design.md` (merged 4531e75). That
spec stays in force: plan gates, counting, budget, privacy rules, the states table. This one adds
two ways of *showing* a saved reading, the two pieces of saved data they need, and a diagnosis of
the speech route. Branch `feat/media-overlay` (from main 4531e75). Nothing here is built yet.

## Goal
1. **Pictures:** the translation is drawn on the picture itself (as Google Lens does) — a box with
   the translated text over each original text, with an **Original / Translated** switch. The
   language is the site language (Hebrew or English).
2. **Videos:** the translated speech appears as subtitles on the playing video, in the site
   language, with an on / off switch.
3. **Speech route:** find out why a run with speech on saved "speech not available" (state `off`),
   and make the next such failure say why — in the function log and to staff on the site.

## Non-goals
- The picture file is never changed, copied or re-saved. The overlay is page elements drawn above
  the `<img>`; download and "open original" give the untouched file. (Evidence must not be altered.)
- No new paid action, no new plan key, no new daily count. Boxes and timed lines come out of the
  same run as today's reading.
- No automatic re-reading of readings saved before this work.
- No overlay on video stills, in the map popup, the phone preview sheet, share text or push.
- No burned-in subtitles; the video file is not touched either.

## Owner's decisions (binding)
- Overlay on the picture, Original / Translated switch, picture file untouched.
- Subtitles of the translated speech, on / off switch.
- Both follow the site language.
- Gates and counting as the existing feature.

## Rulings (made by the planner — the owner should read these)
1. **Text positions come from Claude, in the call that already reads the picture.** Each text pair
   may carry `box: [ymin, xmin, ymax, xmax]`, whole numbers 0–1000 measured on the full picture.
   Why this and not Gemini: (a) nothing new to wire — no second Vercel route, no second hop that
   can fail, no free-tier limit to hit; (b) the box arrives attached to the very pair it belongs to,
   whereas Gemini's boxes would have to be matched to Claude's texts by comparing Arabic / Persian
   strings read by two different models; (c) pictures keep going to one company only — today
   Google receives videos, not pictures; (d) cost is a few output tokens per text (see Cost).
   Price of this choice: Claude's boxes are approximate. The design absorbs that — a box that is
   off still shows the right words, a tap shows the original, and the text panel under the picture
   stays the full, exact record. **Fallback if the owner finds the boxes too loose at go-live
   (Task 8, five pictures by eye): a Gemini picture route**, as a separate small plan. The saved
   shape (`box` on the pair) would not change, so no display work is lost.
2. **Timed lines come from Gemini, in the transcribe call that already listens to the video.**
   The prompt asks for `segments: [{start, end, text}]` (seconds) instead of one block of speech.
   Claude translates the lines one by one in its existing call and returns `{i, he, en}` per line;
   the full Hebrew / English translation shown in the panel is the lines joined, so Claude does
   not write the speech twice. Free on the Gemini side; about the same Claude output as today.
3. **Saved data stays backward compatible; no table change for it.** `media_readings.texts` and
   `.speech` are JSON: a pair gains optional `box`; speech gains optional
   `segments: [{start, end, orig, he, en}]`. Every reader of the old shape keeps working.
4. **Old readings:** no box → that text is not drawn; a picture with no drawable box has no switch
   (panel only, exactly as today). No segments → no subtitle switch. **Staff "Run again" is the
   only way to add boxes / timed lines to an old reading.** A reader's click never re-reads a
   picture just because it lacks boxes (that would be a paid run the reader did not ask for).
5. **When the overlay appears:** the saved reading is loaded where it is loaded today — after
   "Expand", for readers whose plan has the feature. From then on the event's pictures show the
   switch. It starts on **Original**; opening the translation ("Translate image/video" or "Show
   media translation") turns the event's pictures to **Translated**. The switch on each picture
   changes that event's pictures back and forth.
6. **Tapping:** on the small picture in the card / details window a tap opens the full-screen
   viewer as today, in the mode the switch is in. In the viewer, tapping a box flips that box
   between translation and original; the viewer has its own switch. (On the small picture the
   boxes are often too small to hit with a finger.)
7. **Text fitting:** the font shrinks from 22 px to 9 px until the text fits the box. If it does
   not fit at 9 px, the box is drawn as a tinted frame without words (the viewer, being larger,
   usually fits it). Each box takes its direction from its own text (Hebrew right-to-left,
   English left-to-right), whatever the site direction.
8. **Subtitles are a WebVTT track built in the browser** from the saved lines (a `<track>` with a
   blob address), so the browser's own player draws them — including full screen on a phone.
   The switch sets the track to showing / off. Changing the site language rebuilds the track.
9. **Long and cut videos:** unchanged limits — over 10 minutes or 50 MB there is no speech and so
   no subtitles. Lines are kept until the speech text reaches 6,000 characters or 120 lines; the
   rest is not saved, `cut` is true, the subtitles simply stop there and the existing line "only
   its beginning is translated" stays in the panel.
10. **Claude's answer limit rises from 6,000 to 8,000 tokens** (`MEDIA_LIMITS.maxTokens`), so a
    full run of 12 texts with boxes plus 120 lines cannot be cut mid-answer. This raises the
    worst-case cost of a run, not the typical one.
11. **Speech route failures get a reason.** The route answers `502 { error: 'busy', detail }`
    with the step and the upstream status; the job logs it and saves one short line in
    `media_jobs.speech_note`; staff see that line in the panel. The route also receives the time
    the job can wait (`budget_ms`) and gives up inside it with a reason, instead of being cut off.

## Saved data
Text pair (in `media_readings.texts[]`):
`{ orig, lang, he, en, where_he, where_en, from, box? }` — `box` = four whole numbers,
`0 ≤ ymin < ymax ≤ 1000`, `0 ≤ xmin < xmax ≤ 1000`, each side at least 8. Anything else → the pair
is kept without `box`. A pair that came from the video's on-screen list (`from: 'video'`) never
has a box.

Speech (in `media_readings.speech`): today's fields plus
`segments?: [{ start, end, orig, he, en }]` — seconds, `0 ≤ start < end`, in order, no overlap,
at most 120, `orig` ≤ 300, `he` / `en` ≤ 400. `he` / `en` of the whole speech = the lines joined
with a line break.

`media_jobs.speech_note text` (new column, migration 128): the last run's reason(s) why speech was
not read, ≤ 300 characters, `null` when every video's speech was read. Never contains speech text.

## Timed lines — cleaning rules (route side)
- `start` / `end` accepted as numbers or as `MM:SS`, `MM:SS.s`, `HH:MM:SS` strings.
- Dropped: no readable start; text with no letter; a start at or past the video's length.
- Sorted by start. An end that is missing or not after the start → start + 4 s. A line longer
  than 12 s → cut to 12 s. An end past the next line's start → the next line's start. A line left
  under 0.2 s → dropped.
- If Gemini gives no usable lines but gives a `speech` text, the run continues as today (text,
  no subtitles).

## Speech route diagnosis (read from the code on 4531e75; nothing live was touched)
Observed by the owner: event `8f6dd772-287b-4840-b6bd-dcadb9bbcf2f`, a video still with the video
fetched on demand (12,223,726 bytes), speech switch on → saved speech state `off`; minutes later
the on-demand video row and its file were gone.

**What `off` can mean in the current code — confirmed by reading**
- A. The route call failed: `speechFor` returns `'failed'` for a network error, the wait running
  out, or any answer that is not `200` with a known state (so `401`, `404`, `502`, `503`, `504`);
  `routeOutcome` turns that into `off`. Nothing is logged — the reason is lost.
- B. The route call was skipped: `speechBudgetMs` returned 0 (under 15 s left for it).
- C. Speech was judged off when the job started: `speechPlan` returns `off` when the switch reads
  false **or** `speechConfigured()` is false (the function's `TRANSLATE_API_URL` does not end in
  `/api/translate`, or `TRANSLATE_SECRET` is empty). The job reads the switch itself, separately
  from the request that started it.

**What it cannot have been — confirmed by reading**
- The file missing when the route fetched it → the route answers `unavailable`, saved as such.
- Too big / too long → `too_big` / `too_long`. A safety block or an empty answer → `unreadable`.
- The worker dying → a failed job, the use given back, no reading saved at all.

**Likely causes, most likely first — NOT confirmed (the reason was never recorded)**
1. *The job waited less than the route needs.* The job has 180 s. Fetching the video on demand
   runs first, inside the job (download from Telegram, upload to storage; no time limit of its
   own, the loop allows it up to 85 s). The route then gets `100 s − fetch time`, while the route
   itself works up to 90 s. Any fetch over 10 s means the job can hang up on a route that is still
   working. Confirmed as arithmetic; not confirmed that it happened.
2. *Gemini refused or limited the request*, which the route reports as `502 busy` for every
   reason alike: the free-tier limit (429); a request too large — this file is under the route's
   12 MB inline limit (12,582,912), so it was sent inline, which is about 16.3 MB once encoded;
   Google's limit for inline requests could not be checked from the code; a model name Google
   does not accept (`GEMINI_MODEL` or the default `gemini-3.5-flash-lite`); a key problem.
3. *The route was not reachable as the function expects*: not on the production deployment (404),
   the two copies of the secret differ (401), or Vercel ended the function before 90 s (the plan's
   time limit could not be checked from the code; `vercel.json` asks for 120 s).
4. *Case C* — the function's settings, which cannot be read from the repository.

**The disappearing video — confirmed by reading**
- Two places delete videos to make room: `_shared/videoOnDemand.ts makeRoom` (on-demand fetch,
  `attach_media`) and `whatsapp-ingest makeRoom` (uploads). Both act when storage plus the
  incoming file passes 90 % of 1 GB, delete the oldest videos first, and continue until under 80 %.
- If pictures alone keep the store above 80 %, the loop deletes **every** video, the newest
  included — so the next upload by anyone removes a video fetched minutes earlier.
- Not confirmed: how full the store is, and what `media_storage_usage()` counts (it is not in the
  repository's migrations).
- Effect on this feature: readings are saved by the still's id and survive; the video is fetched
  again on the next play. But each speech retry must fetch the file again, which makes cause 1
  more likely.

**A cost risk seen while reading (existing behaviour, not changed here without the owner):**
a video whose speech is `off` counts as "new media" while the switch is on. Each reader click on
"Translate the new media" then makes a paid Claude call and counts a use, and — while the route
keeps failing — saves `off` again. Until the route is proven, the switch should stay off.

## What the reader sees — copy (keys in `src/i18n/en.ts` / `he.ts`)
| key | English | Hebrew |
|---|---|---|
| `mt.ov.translated` | Translated | מתורגם |
| `mt.ov.original` | Original | מקור |
| `mt.ov.switch` | Translation on the picture | תרגום על גבי התמונה |
| `mt.ov.hint` | Tap a text to see the original | הקישו על טקסט כדי לראות את המקור |
| `mt.subs` | Subtitles | כתוביות |
| `mt.subsLabel.he` | Hebrew (AI translation) | עברית (תרגום AI) |
| `mt.subsLabel.en` | English (AI translation) | אנגלית (תרגום AI) |
| `mt.staffNote` | Speech (staff): {note} | דיבור (צוות): {note} |

## Cost
- **Picture:** no new call. Per text about 20 extra output tokens for the box; at most 12 texts →
  at most about 250 tokens, well under one US cent per picture. Measured at go-live.
- **Video:** Gemini stays on the free tier (cost 0), one call as today. Claude translates the
  same speech once, as lines; expected within about 20 % of today's cost. Measured at go-live.
- **Old readings:** nothing, unless staff press "Run again" (a normal staff run, outside the
  readers' budget, logged as `media_translate_staff`).

## Privacy and safety
Unchanged. Box and line texts are model output: cleaned by the pure modules before saving, drawn
as plain text only (`textContent` / React text nodes), and escaped inside the subtitle file. The
route's `detail` and the saved note never contain speech text or anything about a reader.

## Open questions for the owner
1. After go-live, should staff re-run the events of the last N days so their pictures get boxes?
   (Cost: one staff run per event.)
2. Should the overlay be offered before "Expand" for readers with the feature? (One extra read per
   event with media; no AI.)
3. Storage: should the newest videos be protected from the make-room loop for some minutes, or the
   store enlarged? Needs the live usage numbers first (Task 8 asks to read them).
4. The "off counts as new media" cost risk above: keep, or stop retrying a video after N failures?
