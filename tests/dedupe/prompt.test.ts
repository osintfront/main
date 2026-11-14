// Run: node --experimental-strip-types --test tests/dedupe/prompt.test.ts
// 13 Nov: "Israeli forces build a road from the Sayhan post toward Wadi al-Ruqqad" (09:35) and,
// four hours later in another outlet, "digging, bulldozing and road widening in Wadi Sayhan"
// stayed two events: both models read the second as a new incident with new details. Works and
// a force's presence go on for hours; a re-report of them is the same event.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync('supabase/functions/_shared/dedupe.ts', 'utf8');
const system = src.slice(src.indexOf('const SYSTEM = `'), src.indexOf('`;', src.indexOf('const SYSTEM = `')));

test('the dedupe prompt treats a re-report of ongoing works or presence as the same event', () => {
  assert.match(system, /ongoing activity/i);
  for (const w of ['road', 'bulldoz', 'Sayhan', 'new place']) assert.ok(system.includes(w), w);
});

test('the rules that keep real incidents apart are still there', () => {
  for (const w of ['Two statements by different people', 'different statements by the same person', 'different times or places']) assert.ok(system.includes(w), w);
});

test('the prompt knows protests are ongoing activity and what "(same photo)" means', () => {
  assert.ok(system.includes('protest, sit-in or vigil'));
  assert.ok(system.includes('(same photo)'));
});
