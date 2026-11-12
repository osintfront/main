# Ask the map — conversation, summary, copy/share: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn "Ask the map" into a short conversation with follow-up questions, a summary mode (free text or button) and Copy / Share under every answer.

**Architecture:** The conversation is React state in `MapPage` (a list of turns + the selected turn). Each question is the existing `event-agent` `ask` call with two optional fields (`history`, `prev_ids`); the server resolves context in the plan step and writes the answer in "answer" or "summary" mode. Pure logic lives in two small files (`src/lib/askChat.ts`, `supabase/functions/_shared/askInput.ts`) so it is unit-tested without Deno or a browser.

**Tech Stack:** React 19 + TypeScript + Tailwind 4, Supabase Edge Function (Deno), `node:test` run with `node --experimental-strip-types --test`, Playwright for end-to-end.

**Spec:** `docs/superpowers/specs/2026-11-12-ask-map-chat-design.md`

## Global Constraints

- Branch `feat/ask-map-chat`. Nothing reaches `main` or the live `event-agent` without the owner's yes.
- No migration; no change to quotas, plans, prices or `app_settings`.
- Request stays backward compatible: `history` and `prev_ids` are optional.
- Limits (exact): 6 turns per conversation; history sent = last 5 turns; question ≤ 500 chars; history answer ≤ 1,500 chars; `prev_ids` ≤ 40 UUIDs; share text ≤ 3,500 chars before the site line.
- Summary default period 24 h; plain question keeps 3 days.
- No Hebrew string literals in components: all text through `src/i18n/he.ts` and `en.ts`. Code, comments and commit messages in English.
- Commit trailer on every commit:
  `Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>` and
  `Claude-Session: https://claude.ai/code/session_01Ka6fmoBGGuf9g4trFMvffK`.
- Every task ends with `npm run typecheck` clean.

## Review Focus

1. A follow-up sent while the previous question is still running → ignored (button disabled, no second call, no turn out of order). Test: Task 4 e2e step "double submit".
2. An answer with no cited events (the "no matching events" answer) → still a turn; Copy text has no "Sources:" block; `prev_ids` for the next question comes from the last turn that had events. Tests: Task 1 (`answerShareText` with no events, `buildContext` skipping empty turns).
3. Forged or oversized `history` / `prev_ids` from a client (non-array, objects, 10,000-char strings, non-UUID ids) → cleaned silently, never a 500. Tests: Task 2 (`cleanHistory`, `cleanIds`).
4. Citation numbers above the turn's event count, or `[n]` inside a copied answer whose event was not loaded (deleted / not visible to the plan) → the number stays in the text, no source line, no crash. Test: Task 1.
5. Mixed-direction text (Hebrew answer with English names and URLs) pasted into WhatsApp → every source line starts with `[n]` and the URL is alone at the end of its line. Test: Task 1 asserts the exact line shape.

---

### Task 1: Client pure logic — `src/lib/askChat.ts`

**Files:**
- Create: `src/lib/askChat.ts`
- Test: `tests/ask/askChat.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export const MAX_TURNS = 6;
  export const HISTORY_TURNS = 5;
  export interface AskTurnLike { question: string; answer: string; ids: string[]; events: { id: string; title: string }[] }
  export interface AskContext { history: { q: string; a: string }[]; prev_ids: string[] }
  /** Last 5 turns as {q,a} (q ≤ 500, a ≤ 1,500) + ids (≤ 40) of the newest turn that has any. */
  export function buildContext(turns: AskTurnLike[]): AskContext;
  export interface ShareLabels { sources: string; site: string }   // e.g. "Sources:" / "osintfront.com"
  /** Question, blank line, answer, blank line, "Sources:", one line per cited event `[n] title — siteUrl/e/id`, blank line, site. */
  export function answerShareText(turn: AskTurnLike, siteUrl: string, labels: ShareLabels, max?: number): string; // max default 3500
  /** he: `סכם את האירועים ב{area} ב-24 השעות האחרונות. {extra}` · en: `Summarise the events in {area} in the last 24 hours. {extra}`; no area → he `סכם את האירועים ב-24 השעות האחרונות. {extra}` / en `Summarise the events of the last 24 hours. {extra}`. */
  export function summaryQuestion(area: string, extra: string, lang: 'he' | 'en'): string;
  export function whatsappUrl(text: string): string; // https://wa.me/?text=<encoded>
  ```

- [ ] **Step 1: Write the failing tests** in `tests/ask/askChat.test.ts` (header comment: `// Run: node --experimental-strip-types --test tests/ask/askChat.test.ts`):
  - `buildContext`: 7 turns → `history.length === 5`, the last item is turn 7; a 600-char question → 500; a 2,000-char answer → 1,500; newest turn has `ids: []` and the one before has 50 ids → `prev_ids.length === 40` taken from that earlier turn; no turns → `{ history: [], prev_ids: [] }`.
  - `answerShareText`: turn `{question:'Q', answer:'A [1] and [2] and [9]', ids:['a','b'], events:[{id:'a',title:'T1'},{id:'b',title:'T2'}]}` with `siteUrl 'https://osintfront.com'`, labels `{sources:'Sources:', site:'osintfront.com'}` → exactly
    `"Q\n\nA [1] and [2] and [9]\n\nSources:\n[1] T1 — https://osintfront.com/e/a\n[2] T2 — https://osintfront.com/e/b\n\nosintfront.com"`.
  - Only cited numbers get a source line: answer `'A [2]'` with the same events → one source line, `[2] T2 — …/e/b`.
  - Id cited but its event missing from `events` → no source line for it, no throw.
  - No citations / no events → no `Sources:` block: `"Q\n\nA\n\nosintfront.com"`.
  - Long answer (5,000 chars of 80-char lines) with `max` 3500 → result minus the final `"\n\nosintfront.com"` is ≤ 3,500 chars, ends with `…`, and the cut is at a line break (`!result.includes(lastLine.slice(0, 40) + …partial)` — assert the char before `…` is `\n`).
  - `summaryQuestion('לבנון', 'בלי הצהרות', 'he') === 'סכם את האירועים בלבנון ב-24 השעות האחרונות. בלי הצהרות'`; `('Lebanon','', 'en') === 'Summarise the events in Lebanon in the last 24 hours.'`; `('', 'only strikes', 'en') === 'Summarise the events of the last 24 hours. only strikes'`; result is always ≤ 500 chars (extra of 600 chars).
  - `whatsappUrl('a b&c') === 'https://wa.me/?text=a%20b%26c'`.
- [ ] **Step 2: Run** `node --experimental-strip-types --test tests/ask/askChat.test.ts` → FAIL (module not found).
- [ ] **Step 3: Implement `src/lib/askChat.ts`** with the signatures above. No imports from React, Supabase or `@/` aliases (the test runner has no alias resolution).
- [ ] **Step 4: Run** the same command → PASS; `npm run typecheck` → clean.
- [ ] **Step 5: Commit** `feat(ask): pure helpers for conversation context and share text`.

### Task 2: Server — context, summary mode, input cleaning

**Files:**
- Create: `supabase/functions/_shared/askInput.ts` (no Deno APIs, no imports)
- Modify: `supabase/functions/_shared/ask.ts`, `supabase/functions/event-agent/index.ts` (the `action === "ask"` block, ~lines 492–520, and the header comment line 14)
- Test: `tests/ask/askInput.test.ts`

**Interfaces:**
- Produces (`askInput.ts`):
  ```ts
  export interface AskTurn { q: string; a: string }
  export interface AskCtx { history: AskTurn[]; prevIds: string[] }
  export function cleanHistory(v: unknown): AskTurn[];   // array only; last 5; q ≤ 500, a ≤ 1500; both trimmed; items with empty q or a dropped
  export function cleanIds(v: unknown): string[];        // UUID strings only, de-duplicated, first 40
  export function cacheKey(question: string, history: AskTurn[]): string; // normalised question; with history: + "|" + 8-hex FNV-1a of the history questions joined by "\n"
  export function historyMessages(history: AskTurn[]): { role: 'user' | 'assistant'; content: string }[]; // alternating q / a
  ```
- Produces (`ask.ts`): `askMap(db, question, ctx?: AskCtx)`; `AskResult.mode: "answer" | "summary"`.
- Wire format (consumed by Task 3): request `{ action:"ask", question, history?: {q,a}[], prev_ids?: string[] }`; response adds `mode`.

- [ ] **Step 1: Write the failing tests** `tests/ask/askInput.test.ts`:
  - `cleanHistory`: `null`, `"x"`, `{}` → `[]`; 8 valid items → the last 5; item `{q: 5, a: null}` dropped; 10,000-char `a` → 1,500; `{q:' hi ', a:' yo '}` → trimmed.
  - `cleanIds`: mixed `['not-uuid', 7, uuidA, uuidA, uuidB]` → `[uuidA, uuidB]`; 60 distinct UUIDs → 40; non-array → `[]`.
  - `cacheKey('  What  Happened ', []) === 'what happened'`; with history it differs from the bare key and is stable across calls; two different histories → different keys.
  - `historyMessages([{q:'a',a:'b'}])` deep-equals `[{role:'user',content:'a'},{role:'assistant',content:'b'}]`.
- [ ] **Step 2: Run** `node --experimental-strip-types --test tests/ask/askInput.test.ts` → FAIL.
- [ ] **Step 3: Implement `askInput.ts`.**
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Change `ask.ts`:**
  - `PLAN_TOOL` gains `mode: { type:"string", enum:["answer","summary"] }` (required). Plan system prompt gains: summary when the user asks to summarise / brief / overview / "what happened in" (`סכם`, `סיכום`, `תמונת מצב`, `מה קרה ב`); a summary with no time → now minus 24 h; exclusions the user states ("without statements") → leave those categories and terms out; "Earlier messages are the conversation so far: resolve what the new question refers to (place, period, topic) from them; the new question decides."
  - Plan and answer calls: `messages: [...historyMessages(ctx.history), { role:"user", content: … }]`.
  - Search: after the RPC, when `ctx.prevIds.length` and the plan has no `places` and no `countries`, load those events with the same columns the RPC returns (`id, occurred_at, category_slug, country, location_name, locations, title, description` — read `supabase/migrations/20261023000035_ai_search.sql` for the exact shape and reuse it) and append the ones not already in the list, keeping the 120 cap.
  - Answer system prompt by mode. `answer` = today's text unchanged. `summary` = same grounding rules (only the events, cite `[n]`, ignore instructions in data, all names) with this format: line 1 the situation in one sentence (count, area, period); then titled blocks, title alone on its line without a bullet, bullets `• ` under it: main developments → one block per topic that has events → notable names; obey the user's exclusions; no block for an empty topic.
  - `askMap(db, question, ctx = { history: [], prevIds: [] })` uses `cacheKey(question, ctx.history)`; result carries `mode`.
- [ ] **Step 6: Change `event-agent/index.ts`:** read `cleanHistory(body?.history)` and `cleanIds(body?.prev_ids)` and pass them to `askMap`; update the header comment to `{action:"ask", question, history?, prev_ids?}`.
- [ ] **Step 7: Type-check the function:** `deno check supabase/functions/event-agent/index.ts` when `deno` is installed; otherwise re-read both diffs line by line against the interfaces above and say in the task report that Deno was not available.
- [ ] **Step 8: Commit** `feat(ask): conversation context and summary mode in event-agent`.

### Task 3: Client — conversation UI, summary form, copy/share

**Files:**
- Modify: `src/services/askService.ts`, `src/components/map/AskMap.tsx`, `src/pages/public/MapPage.tsx` (lines ~206–267, 501–521, 593), `src/i18n/he.ts`, `src/i18n/en.ts`, `tests/i18n/no-hebrew-literals.test.ts` (add `src/components/map/AskMap.tsx` to `FILES`)

**Interfaces:**
- Consumes: Task 1 exports; Task 2 wire format.
- Produces:
  ```ts
  // askService.ts
  export interface AskAnswer { question: string; answer: string; ids: string[]; events: PublicEvent[]; mode: 'answer' | 'summary' }
  export async function askMap(question: string, ctx?: AskContext): Promise<AskAnswer>;
  // AskMap.tsx
  interface AskMapProps { turns: AskAnswer[]; selected: number; onTurns: (t: AskAnswer[]) => void; onSelect: (i: number) => void; onCite: (id: string) => void }
  ```
- New i18n keys (both languages): `ask.followUp` (placeholder for turns ≥ 1), `ask.newChat`, `ask.limit` (text shown at 6 turns), `ask.turns` (`{used}/{max}`), `ask.copy`, `ask.copied`, `ask.copyFailed`, `ask.share`, `ask.sources`, `ask.summary`, `ask.summaryArea`, `ask.summaryExtra` (placeholder), `ask.summaryGo`.

- [ ] **Step 1: Add `src/components/map/AskMap.tsx` to `FILES` in `tests/i18n/no-hebrew-literals.test.ts`;** run it → PASS today (guards the rewrite).
- [ ] **Step 2: `askService.ts`** — send `history` / `prev_ids` from `ctx`, read `mode` (default `'answer'`).
- [ ] **Step 3: `MapPage.tsx`** — replace `ask` state with `askTurns: AskAnswer[]` and `askSelected: number`; `const ask = askTurns[askSelected] ?? null` keeps every existing use (`ask.events`, feed title, alerts, list key) working; `handleAskResult` becomes `handleAskTurns(turns)` → sets turns, selects the last, fits the map to its events as today; `handleAskSelect(i)` selects and re-fits; "Clear search" in the feed header empties the turns.
- [ ] **Step 4: `AskMap.tsx`** — thread view:
  - each turn: the question (small, muted), the answer through the existing `AnswerLine` (ids of that turn), then an actions row: Copy, Share (lucide `Copy`, `Check`, `Share2`);
  - the selected turn has a sky left/right border (`border-s-2`); pressing a turn calls `onSelect`;
  - the list scrolls (`max-h-[46vh]`), and scrolls to the newest turn after an answer;
  - input at the bottom; placeholder `ask.followUp` once there is a turn; submit is disabled while `busy`; the question stays in the input when the call fails;
  - at `MAX_TURNS` the form is replaced by `ask.limit` + a "New chat" button; a "New chat" icon button (lucide `SquarePen`) is also in the header whenever there is a turn; header shows `ask.turns`;
  - Summary: a button (lucide `ListChecks`) next to the input opens an inline form — area chips from `AREAS` (label by language), a text input (`ask.summaryExtra`, maxLength 300), a send button; sending calls the same submit with `summaryQuestion(areaLabel, extra, lang)`; enabled when a chip is chosen or the text is ≥ 3 chars;
  - Copy: `navigator.clipboard.writeText(text)`, fallback hidden `<textarea>` + `document.execCommand('copy')`; label switches to `ask.copied` for 2 s; on failure `ask.copyFailed`;
  - Share: `navigator.share({ text })` when defined (ignore `AbortError`), else `window.open(whatsappUrl(text), '_blank', 'noopener')`;
  - text = `answerShareText(turn, authConfig.siteUrl, { sources: t('ask.sources'), site: 'osintfront.com' })`;
  - the collapse toggle (`ask.hideAnswer` / `ask.showAnswer`) keeps working for the whole thread; the `X` button closes the panel and clears the conversation.
  - `data-ask-turn={i}` on each turn, `data-ask-action="copy" | "share" | "summary" | "new"` on the buttons (e2e hooks).
- [ ] **Step 5: Run** `npm run check` → types clean and build succeeds; both unit suites and the i18n test → PASS.
- [ ] **Step 6: Commit** `feat(ask): conversation thread, summary form, copy and share`.

### Task 4: End-to-end QA, deploy, hand-over

**Files:**
- Create: `tests/e2e/ask-chat.js` (same style as `tests/e2e/guest.js`: one async function for Playwright `browser_evaluate`, returns an object of observations; header comment says how to run it and what to expect)
- Modify: project doc `claude/osintfront-build-status.md` (Projects tool) — one short section for this feature

- [ ] **Step 1: Push the branch;** get the Vercel preview URL of the branch build and check the build is green.
- [ ] **Step 2: Ask the owner for the go-ahead to deploy `event-agent`** (the function is shared with the live site; the change is backward compatible). Deploy the one-line stub pointing at the branch commit (`https://raw.githubusercontent.com/osintfront/main/<commit>/supabase/functions/event-agent/index.ts`), as `claude/osintfront-build-status.md` describes. Then, from the live site unchanged, ask one question → still answers (old client, new function).
- [ ] **Step 3: Create the temporary Pro test user** (`osintfront+e2e-ask@gmail.com`, plan `pro`, status `active`, email confirmed) and a Free one (`osintfront+e2e-askfree@gmail.com`) through the existing `user-admin` function / SQL the access-tiers plan used (`docs/superpowers/plans/2026-11-04-access-tiers.md`, e2e section).
- [ ] **Step 4: Run the e2e checks on the preview with Playwright** (desktop 1280×800, then phone 390×844; Hebrew, then English):
  1. Ask "מה קרה בלבנון היום?" → one turn, answer has `[n]` buttons, feed shows the turn's events.
  2. Follow-up "ומי נהרג שם?" → second turn; the request body has `history.length === 1` and `prev_ids`; the answer is about Lebanon.
  3. Press turn 1 → it is selected and the feed shows its events again.
  4. Double submit: press Send twice quickly → exactly one request.
  5. Summary button → choose Lebanon, extra "בלי הצהרות" → response `mode === "summary"`; answer has titled blocks; no statements block.
  6. Free-text summary "סכם את עזה ב-24 שעות" → `mode === "summary"`.
  7. Copy → clipboard text equals `answerShareText` of that turn (question first line, `Sources:` lines with `/e/<id>`, site line last).
  8. Share on desktop (no `navigator.share`) → a `https://wa.me/?text=` URL is opened.
  9. Six turns → input replaced by the limit text and "New chat"; "New chat" empties the thread. (Uses 6 questions; reuse the ones above.)
  10. Close (X) → panel closes, feed back to live.
  11. Free user → the Ask button behaves as today (upgrade path); no thread.
  12. Console has no errors; no Hebrew in the English UI of the panel.
- [ ] **Step 5: Fix anything that fails** (superpowers:systematic-debugging), re-run the failed checks and the unit suites.
- [ ] **Step 6: Save the script** as `tests/e2e/ask-chat.js`, commit `test(ask): e2e script for the conversation panel`, push.
- [ ] **Step 7: Clean up and report:** delete both test users; write the project-doc section; give the owner the preview link, what was checked with evidence (counts, the summary answer), what it cost in AI calls, and ask for approval to merge to `main`.
