// Run: node --experimental-strip-types --test tests/categories/rules.test.ts
//
// The editor knows the Killed / Wounded rules and returns secondary types; every writer stores them
// (and leaves hand-set ones alone). Text checks: these files run on Deno with remote imports.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p: string) => readFileSync(`supabase/functions/${p}`, 'utf8');

test('category rules hold the casualty and secondary rules', () => {
  const s = read('_shared/categoryRules.ts');
  for (const w of ['killed', 'wounded', 'assassination', 'Secondary types']) assert.ok(s.includes(w), w);
});

test('the editor tool returns up to two secondary types', () => {
  const s = read('_shared/editor.ts');
  assert.ok(s.includes('secondary_category_slugs'));
  assert.ok(s.includes('maxItems: 2'));
});

test('every writer stores them and respects hand-set ones', () => {
  for (const f of ['whatsapp-ingest/index.ts', 'event-agent/index.ts', 'intel-crawler/index.ts']) {
    const s = read(f);
    assert.ok(s.includes('secondary_categories'), f);
    // event-agent obeys the hand-set flag through afterEdit (read fresh after the AI call).
    assert.ok(s.includes('manual_secondary') || (f === 'event-agent/index.ts' && s.includes('afterEdit(')), f);
  }
});

test('a party\'s claim adds statements; airstrike only when aircraft or drones struck', () => {
  const s = read('_shared/categoryRules.ts');
  assert.ok(s.includes('claim'));
  assert.ok(/airstrike only when/.test(s));
});

test('anyone dead → Killed is main or secondary, never Wounded alone', () => {
  const s = read('_shared/categoryRules.ts');
  assert.match(s, /anyone died[\s\S]{0,200}never Wounded alone/);
});
