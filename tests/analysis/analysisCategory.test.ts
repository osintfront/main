// Run: node --experimental-strip-types --test tests/analysis/analysisCategory.test.ts
// Category "Analyses & summaries" (analysis): analyses of military activity and summaries of
// earlier incidents. Feed only; the whole text translated (translations.<lang>.full); the
// database cuts it to the first paragraph for guest / Free (migration 129, analysis_gate).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fullTextPieces } from '../../supabase/functions/_shared/fullText.ts';

const ingest = readFileSync('supabase/functions/whatsapp-ingest/index.ts', 'utf8');
const rules = readFileSync('supabase/functions/_shared/categoryRules.ts', 'utf8');
const mig = readFileSync('supabase/migrations/20261114000129_analysis_category.sql', 'utf8');
const ui = readFileSync('src/components/feed/EventText.tsx', 'utf8');

test('no agent picks the category by itself: the ingest sets it from is_analysis / is_summary', () => {
  assert.match(rules, /AGENT_EXCLUDED_CATEGORIES = new Set\(\[[^\]]*"analysis"/);
  assert.match(ingest, /const analysisCat = summary \? cats\.find\(\(x\) => x\.slug === ANALYSIS_SLUG\)/);
  assert.match(ingest, /"uncategorized", ANALYSIS_SLUG\]\.includes\(c\.slug\)/); // not offered to the editor
});

test('the editor never takes an analysis out of its category, its kinds become topics', () => {
  assert.match(ingest, /const triageMain = isAnalysis \? null : rowSlug;\s+const picked = withEditorMain\(triageMain/);
  assert.match(ingest, /const newMain = !isAnalysis &&/);
});

test('the full text is translated and survives the editor writing its headline', () => {
  assert.match(ingest, /if \(analysisCat\) background\.push\(saveFullText\(ins!\.id, text\)\)/);
  assert.match(ingest, /if \(typeof v\?\.full === "string"\) tr\[l\] = \{ \.\.\.\(tr\[l\] \?\? \{\}\), full: v\.full \}/);
});

test('long texts are sent in at most 20 pieces, paragraphs kept apart', () => {
  const text = Array.from({ length: 45 }, (_, i) => `פסקה ${i}`).join('\n\n');
  const pieces = fullTextPieces(text);
  assert.ok(pieces.length <= 20);
  assert.equal(pieces.join('\n\n'), text);
  assert.deepEqual(fullTextPieces('א\n\n\n\nב'), ['א', 'ב']);
});

test('access: Pro / Max / Intel read all of it, Free and guest get the cut, in the database', () => {
  assert.match(mig, /p in \('pro', 'max', 'intel'\)/);
  assert.equal((mig.match(/public\.analysis_gate\(\s*(CASE|e\.translations)/g) ?? []).length, 2); // both views
  assert.match(mig, /'full_cut', true/);
});

test('the site shows the full text, and the upgrade button only when it was cut', () => {
  assert.match(ui, /analysis\.cut \? \(/);
  assert.match(ui, /openGate\(profile \? 'upgrade' : 'signup', 'analysis_full'\)/);
});

test('the full text is translated by Claude first, a half-translated chain result is dropped', () => {
  const tr = readFileSync('supabase/functions/_shared/translate.ts', 'utf8');
  assert.ok(tr.indexOf('await translateFull(text)') < tr.indexOf('chain(pieces, "he")'));
  assert.match(tr, /return foreignLetters\(out\.he\.replace/);
  assert.match(readFileSync('supabase/functions/_shared/editor.ts', 'utf8'), /المسيرات = כטב"מים/);
});
