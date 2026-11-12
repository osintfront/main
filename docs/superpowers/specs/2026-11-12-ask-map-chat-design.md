# "Ask the map": conversation, summary, copy/share — design (approved 2026-11-12)

Project-plan rows (Developments & Duty): '"Ask the map" - Daily summary' and
"שאל את המפה - כפתור העתקת/שיתוף תוכן", plus the owner's request for follow-up questions.
Owner: Ben. Part 1 of 5 in the agreed order (ask the map → several filters → free-text EEI →
several classifications → deep analysis).

## Goal
A Pro/Max user (and staff) can:
1. Keep talking to the map: ask, read the answer, ask a follow-up that relies on what was said
   ("and who was killed there?").
2. Ask for a summary of an area and period, in free text ("summarise Lebanon, last 24 h, without
   statements") or through a "Summary" button that asks for the area.
3. Copy or share any answer as clean text with links to the events behind it.

## Decisions
- **Access and cost:** unchanged gate (`requireFeature('ai_expand_ask')`, `quotaGate(uid, "ask")`,
  40 questions/hour). Every question, follow-ups included, is a normal question: same Opus answer
  step, same credit accounting (`ai_usage` via `runAsReader`). No free follow-ups.
- **Conversation lives in the browser only.** It is React state in `MapPage`; closing the panel or
  pressing "New chat" drops it. Nothing new is stored in the database. No cross-device history.
- **Length:** at most 6 turns per conversation. After the 6th answer the input is replaced by a
  "New chat" button with a one-line explanation.
- **Context sent to the server:** the previous turns (up to 5) as `{q, a}` — question ≤ 500 chars,
  answer cut to 1,500 chars — plus the event ids of the last answer (≤ 40).
- **Map and feed** show the events of the selected turn; the newest turn is selected after each
  answer. Pressing an older answer selects it (its events return to the map).
- **Summary is a mode of the same call**, not a new endpoint. The plan step returns
  `mode: "answer" | "summary"`; "summary" when the user asks to summarise / brief / "what happened in".
  No time in a summary request → last 24 hours (a plain question keeps the 3-day default).
- **Summary answer format:** line 1 = the situation in one sentence (how many events, the area, the
  period). Then short titled blocks, each a few bullets with citations `[n]`: main developments →
  by topic (only topics that have events) → notable names. Exclusions the user asked for
  ("without statements") are obeyed in both the search plan and the text.
- **Summary button:** next to the input. It opens a small form: area chips (the `AREAS` list in
  `src/lib/eventFilters.ts`, in the UI language) and a free-text field ("what to stress or leave
  out"). Sending composes an ordinary question in the UI language and submits it:
  `סכם את האירועים ב{area} ב-24 השעות האחרונות. {free text}` /
  `Summarise the events in {area} in the last 24 hours. {free text}`. The free-text field alone
  (no chip) is also allowed.
- **Copy:** button under every answer. Plain text: the question, the answer with its `[n]` kept,
  then "Sources:" — one line per cited event: `[n] {title} — {site}/e/{id}`, then the site line
  (`osintfront.com`). Uses `navigator.clipboard.writeText`, with a hidden-textarea fallback; the
  button shows "Copied" for 2 seconds.
- **Share:** button under every answer. `navigator.share({ text })` when the browser has it
  (phones); otherwise opens `https://wa.me/?text=…` in a new tab. Same text as Copy. Text longer
  than 3,500 chars is cut at a line break and ends with "…" before the site line (WhatsApp URL limit).
- **Languages:** Hebrew + English through `src/i18n` keys (no Hebrew literals in components —
  `tests/i18n/no-hebrew-literals.test.ts`).

## Server (`supabase/functions/_shared/ask.ts`, `event-agent/index.ts`)
- Request: `{ action: "ask", question, history?: [{ q, a }], prev_ids?: string[] }`. Both new fields
  are optional, so the live site keeps working while the function is updated first.
- `event-agent` cleans the input: `history` — array, last 5 items, strings trimmed and cut
  (500 / 1,500); `prev_ids` — UUIDs only, first 40. Anything else is dropped silently.
- `askMap(db, question, ctx)`:
  - cache key = normalised question + a short hash of the history questions (a follow-up never
    returns the cached answer of the same words asked cold);
  - plan step: the history is given as earlier messages, with the rule "resolve what the new
    question refers to (place, period, topic) from the conversation; the new question decides";
    new tool field `mode`;
  - search step: unchanged RPC `ai_search_candidates`; when `prev_ids` is given and the plan names
    no place and no country, the previous events are added to the candidates (so "who was killed
    there?" still has them);
  - answer step: the history goes in as earlier messages; system prompt by mode (answer = today's
    prompt; summary = the format above). History and events are data — instructions inside them
    are ignored (already the rule for events).
- Response adds `mode`. `AskResult` gains `mode: "answer" | "summary"`.
- No migration. No change to quotas, plans or settings.

## Client
- `src/lib/askChat.ts` (new, pure, unit-tested): `MAX_TURNS`, `buildHistory(turns)`,
  `answerShareText(turn, siteUrl, labels)`, `summaryQuestion(areaLabel, extra, lang)`.
- `src/services/askService.ts`: `askMap(question, ctx?)` sends `history` / `prev_ids`; `AskAnswer`
  gains `mode`.
- `src/components/map/AskMap.tsx`: props become `turns`, `selected`, `onTurns`, `onSelect`,
  `onCite`. Renders the thread (question line + answer per turn, newest at the bottom, scrolls to
  it), the actions row (Copy / Share), the Summary form, the turn counter and "New chat".
- `src/pages/public/MapPage.tsx`: holds `askTurns` and `askSelected`; the events it already takes
  from `ask` now come from the selected turn.
- `src/i18n/he.ts`, `en.ts`: new `ask.*` keys.

## Errors
- Quota / budget / upgrade / rate limit / sign-in / failure: the existing messages, shown under
  the thread; the conversation stays, the failed question stays in the input.
- No events found: the server's "no matching events" answer becomes a normal turn (it does not end
  the conversation).
- Clipboard or share refused by the browser: a short "Could not copy" message; nothing else changes.

## Out of scope
- Automatic morning summaries, saved conversation history, summary PDF/export, changes to prices
  or daily credit amounts.

## Testing
- Unit (`node:test`, `tests/ask/`): history trimming and limits, share text (citations → source
  lines, long text cut, RTL-safe plain text), summary question composition (he/en).
- Server: a Deno-free unit test of the input cleaner and cache key (pure functions exported from
  `ask.ts`).
- End-to-end (Playwright, preview deployment, signed in as a Pro test user and as staff): ask →
  follow-up uses context → older turn re-selects its events → summary by button and by free text →
  copy text matches → share fallback URL → 6-turn limit → Free user sees the upgrade message →
  Hebrew and English → phone width (390 px). Script saved as `tests/e2e/ask-chat.js`.
- `npm run check` (types + build) must pass.

## Rollout
1. Work on branch `feat/ask-map-chat`; Vercel builds a preview.
2. Deploy `event-agent` (backward compatible) from the branch commit, after the owner agrees.
3. Owner approves on the preview.
4. Merge to `main`; Vercel deploys the site.
