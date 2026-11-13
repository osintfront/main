# Nested terms menu Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** a term link that holds other terms opens a menu to choose which entry to read.

**Architecture:** `linkSegments` records, on each link, the other event terms found whole-word inside
its text (`inner`). `TermText` opens a small fixed menu for such links. The editor's term rules ask
the AI to mark the inner name too.

**Tech Stack:** React 19 + TypeScript, node:test with `--experimental-strip-types`.

**Spec:** `docs/superpowers/specs/2026-11-13-nested-terms-design.md`

## Global Constraints
- UI text from `src/i18n/he.ts` / `en.ts` only (tests/i18n/no-hebrew-literals).
- Code, comments, commit messages in English.

## Review Focus
- Inner term equal to the outer one (same key, two surfaces) → not listed.
- Inner surface that is only part of a word (e.g. "מהפכה" in "המהפכני") → not listed.
- Inner term found with a Hebrew prefix letter ("ומשמרות המהפכה") → listed.
- Same inner term twice in the phrase → listed once.
- Escape in the menu closes the menu only, not the event window.

---

### Task 1: `inner` on link segments

**Files:** Modify `src/lib/deepTerms.ts`; Test `tests/deep/deepTerms.test.ts`

**Interfaces — Produces:** `Segment = string | { text: string; term: EventTerm; inner?: { text: string; term: EventTerm }[] }`

- [ ] Tests: `nested terms` — IRGC ground forces example lists `[{text:'משמרות המהפכה', term: irgc}]`, the outer link stays whole, irgc not added to `used`; plus each Review Focus input above (except Escape).
- [ ] Run `node --experimental-strip-types --test tests/deep/deepTerms.test.ts` → FAIL.
- [ ] Implement: after hits are chosen, for each hit scan all other terms' surfaces inside the hit text with the same whole-word rule; order by position; dedupe by key; omit `inner` when empty.
- [ ] Run → PASS. Commit.

### Task 2: the menu in `TermText`

**Files:** Modify `src/components/feed/TermText.tsx`, `src/i18n/he.ts`, `src/i18n/en.ts`

- [ ] Link with `inner` and the feature unlocked → click opens `role="menu"` (fixed, under the link, `z-[3050]`) with a heading `deep.pick` and items: outer then inner; each item calls `onTerm` and closes. Locked → `onTerm(outer)` (gate), as today.
- [ ] Close on outside pointerdown, scroll, Escape (document capture listener, stopPropagation).
- [ ] i18n `deep.pick`: he "על מה לקרוא?", en "Read about…".
- [ ] `npm run typecheck` and the i18n test pass. Commit.

### Task 3: editor marks both names

**Files:** Modify `supabase/functions/_shared/terms.ts`; Test `tests/deep/terms.test.ts`

- [ ] Test: `TERM_RULES` includes `mark both`.
- [ ] Add the rule sentence with the IRGC ground forces example. Test → PASS. Commit.
